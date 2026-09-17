import {
  creditBalances,
  sequence,
  sequenceStep,
} from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { SequenceErrorCodes } from '../../models/sequence-error.types.js';
import {
  type ActivateSequenceInput,
  activateSequenceSchema,
} from './activate-sequence.schema.js';

/** Minimum credits required to publish a sequence (10 credits in precision units) */
const MIN_CREDITS_TO_PUBLISH = 1000;

const logger = createLogger('ActivateSequence');

/**
 * Node structure from the editor
 */
interface EditorNode {
  id: string;
  type: string;
  data: {
    metadata: Record<string, unknown>;
  };
}

interface EditorEdge {
  source: string;
  target: string;
  sourceHandle?: string; // 'true' or 'false' for condition branches
}

type StepType =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'voice_call'
  | 'wait'
  | 'condition'
  | 'webhook';

interface StepData {
  sequenceId: string;
  nodeId: string;
  type: StepType;
  config: Record<string, unknown>;
  order: number;
}

/**
 * Convert nodes JSON to ordered sequence steps using edges for ordering
 * Handles condition branching by storing true/false branch node IDs in config
 */
function nodesToSteps(
  nodes: EditorNode[],
  edges: EditorEdge[],
  sequenceId: string
): StepData[] {
  // Build adjacency maps:
  // - defaultEdgeMap: source -> target (for non-condition nodes and default paths)
  // - conditionEdgeMap: source -> { true: targetId, false: targetId } (for conditions)
  const defaultEdgeMap = new Map<string, string>();
  const conditionEdgeMap = new Map<string, { true?: string; false?: string }>();

  for (const edge of edges) {
    if (edge.sourceHandle === 'true' || edge.sourceHandle === 'false') {
      // This is a condition branch edge
      const existing = conditionEdgeMap.get(edge.source) ?? {};
      existing[edge.sourceHandle] = edge.target;
      conditionEdgeMap.set(edge.source, existing);
    } else {
      // Regular edge (default flow)
      defaultEdgeMap.set(edge.source, edge.target);
    }
  }

  // Find the trigger node (starting point)
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  if (!triggerNode) {
    logger.warn('No trigger node found in sequence');
    return [];
  }

  // Build node map for quick lookup
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Walk the graph from trigger, collecting all action nodes
  // Use BFS to handle branching properly
  const steps: StepData[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  // Start from the node connected to trigger
  const firstNodeId =
    defaultEdgeMap.get(triggerNode.id) ||
    conditionEdgeMap.get(triggerNode.id)?.true;
  if (firstNodeId) {
    queue.push(firstNodeId);
  }

  let order = 0;

  while (queue.length > 0) {
    const currentNodeId = queue.shift() as string;

    // Skip if already visited
    if (visited.has(currentNodeId)) continue;
    visited.add(currentNodeId);

    const node = nodeMap.get(currentNodeId);
    if (!node) continue;

    // Skip trigger nodes, only add action nodes
    if (node.type !== 'trigger') {
      const stepType = node.type as StepType;
      const config: Record<string, unknown> = {
        ...(node.data?.metadata ?? {}),
      };

      // For condition nodes, add the branch target node IDs
      if (node.type === 'condition') {
        const branches = conditionEdgeMap.get(currentNodeId);
        if (branches) {
          config.trueBranchNodeId = branches.true ?? null;
          config.falseBranchNodeId = branches.false ?? null;
        }
      }

      steps.push({
        sequenceId,
        nodeId: node.id,
        type: stepType,
        config,
        order,
      });
      order++;
    }

    // Add next nodes to queue
    // For conditions, add both branches
    if (node.type === 'condition') {
      const branches = conditionEdgeMap.get(currentNodeId);
      if (branches?.true && !visited.has(branches.true)) {
        queue.push(branches.true);
      }
      if (branches?.false && !visited.has(branches.false)) {
        queue.push(branches.false);
      }
    } else {
      // Regular node - follow default edge
      const nextNodeId = defaultEdgeMap.get(currentNodeId);
      if (nextNodeId && !visited.has(nextNodeId)) {
        queue.push(nextNodeId);
      }
    }
  }

  return steps;
}

/**
 * Check required integrations before activation
 * Returns list of missing integrations if any
 */
interface MissingIntegration {
  type: 'voice_script' | 'meta_ads' | 'business_hours';
  message: string;
}

async function checkRequiredIntegrations(
  db: DbConnection,
  organizationId: string,
  nodes: EditorNode[]
): Promise<MissingIntegration[]> {
  const missing: MissingIntegration[] = [];

  // Check if sequence has voice_call steps
  const hasVoiceCalls = nodes.some((n) => n.type === 'voice_call');

  // Check if sequence has facebook_lead trigger
  const hasFacebookTrigger = nodes.some(
    (n) =>
      n.type === 'trigger' && n.data?.metadata?.triggerType === 'facebook_lead'
  );

  if (hasVoiceCalls) {
    // Check that at least one voice script exists for this organization
    const script = await db.query.voiceScript.findFirst({
      where: (vs, { eq }) => eq(vs.organizationId, organizationId),
    });

    if (!script) {
      missing.push({
        type: 'voice_script',
        message: 'A voice script is required for voice calls',
      });
    }

    // Check business hours are configured
    const org = await db.query.organization.findFirst({
      where: (o, { and, eq, isNull }) =>
        and(eq(o.id, organizationId), isNull(o.deletedAt)),
    });

    if (!org?.businessHours) {
      missing.push({
        type: 'business_hours',
        message: 'Business hours must be configured for voice calls',
      });
    }
  }

  if (hasFacebookTrigger) {
    // Check Meta Ads integration is connected and active
    const metaIntegration = await db.query.metaAdsIntegration.findFirst({
      where: (mai, { eq, and }) =>
        and(eq(mai.organizationId, organizationId), eq(mai.isActive, true)),
    });

    if (!metaIntegration) {
      missing.push({
        type: 'meta_ads',
        message:
          'Meta Ads integration must be connected for Facebook lead triggers',
      });
    }
  }

  return missing;
}

const activateSequenceImpl = async (
  db: DbConnection,
  input: ActivateSequenceInput
): Promise<Result<typeof result>> => {
  const parsed = activateSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const existing = await db.query.sequence.findFirst({
    where: (sequence, { eq, and, isNull }) =>
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        isNull(sequence.deletedAt)
      ),
  });

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  if (existing.isActive) {
    return err(
      new FeatureError(ErrorCodes.INVALID_STATE, 'Sequence is already active', {
        id: parsed.data.id,
      })
    );
  }

  // Check credit balance before allowing activation
  const creditBalance = await db.query.creditBalances.findFirst({
    where: eq(creditBalances.organizationId, parsed.data.organizationId),
  });

  // If no credit balance record exists or insufficient credits (and auto-refill is off)
  if (creditBalance) {
    const hasInsufficientCredits =
      creditBalance.balance < MIN_CREDITS_TO_PUBLISH;
    const autoRefillDisabled = !creditBalance.autoRefillEnabled;

    if (hasInsufficientCredits && autoRefillDisabled) {
      return err(
        new FeatureError(
          SequenceErrorCodes.INSUFFICIENT_CREDITS_TO_PUBLISH,
          'Insufficient credits to publish sequence. Please purchase credits to continue.',
          {
            available: creditBalance.balance / 100,
            required: MIN_CREDITS_TO_PUBLISH / 100,
            autoRefillEnabled: false,
          }
        )
      );
    }
  }

  // Parse nodes and edges from JSON
  const nodes = (existing.nodes as EditorNode[] | null) ?? [];
  const edges = (existing.edges as EditorEdge[] | null) ?? [];

  if (nodes.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Cannot activate sequence without any nodes',
        { id: parsed.data.id }
      )
    );
  }

  // Check required integrations before activation
  const missingIntegrations = await checkRequiredIntegrations(
    db,
    parsed.data.organizationId,
    nodes
  );

  if (missingIntegrations.length > 0) {
    const messages = missingIntegrations.map((m) => m.message);
    return err(
      new FeatureError(
        SequenceErrorCodes.MISSING_INTEGRATIONS,
        `Cannot activate sequence: ${messages.join('. ')}`,
        {
          missingIntegrations,
          messages,
        }
      )
    );
  }

  // Convert nodes to sequence steps
  const steps = nodesToSteps(nodes, edges, parsed.data.id);

  if (steps.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Cannot activate sequence without any action steps (only trigger found)',
        { id: parsed.data.id }
      )
    );
  }

  logger.info(`Syncing ${steps.length} steps for sequence ${parsed.data.id}`);

  // Delete existing steps and insert new ones (in a transaction-like manner)
  await db
    .delete(sequenceStep)
    .where(eq(sequenceStep.sequenceId, parsed.data.id));

  // Insert new steps
  await db.insert(sequenceStep).values(steps);

  // Activate the sequence
  const [result] = await db
    .update(sequence)
    .set({ isActive: true })
    .where(
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        notDeleted(sequence)
      )
    )
    .returning();

  logger.info(
    `Sequence ${parsed.data.id} activated with ${steps.length} steps`
  );

  return ok(result);
};

export const activateSequence = (
  db: DbConnection,
  input: ActivateSequenceInput
) =>
  trackedResult(
    'sequences.activateSequence',
    () => activateSequenceImpl(db, input),
    {
      properties: { sequenceId: input.id },
    }
  );

export type ActivateSequenceResult = Awaited<
  ReturnType<typeof activateSequence>
>;
