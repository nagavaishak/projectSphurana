/**
 * Default Follow-Up Sequence Template
 *
 * This template defines the complete follow-up flow for Facebook leads:
 * 1. Immediate AI call
 * 2. Check if booked → Exit
 * 3. Check negative sentiment → Human takeover
 * 4. Check callback requested → Schedule callback
 * 5. Send Email
 * 6. Day 0: Calls every 2 hours (attempts 2-4)
 * 7. Day 1: 2 call attempts
 * 8. Day 2: 2 call attempts
 * 9. Mark as cold if no response
 */

import { randomUUID } from 'node:crypto';

// Types matching the editor types (inline to avoid frontend dependency)
interface EditorNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    title: string;
    description: string;
    completed: boolean;
    current: boolean;
    type: string;
    metadata: Record<string, unknown>;
  };
}

interface EditorEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface DefaultSequenceTemplate {
  name: string;
  description: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
}

/**
 * Generate a short unique ID for nodes
 */
function genId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/**
 * Create a trigger node
 */
function createTriggerNode(id: string, y: number): EditorNode {
  return {
    id,
    type: 'trigger',
    position: { x: 400, y },
    data: {
      title: 'Facebook Lead Submitted',
      description: 'Triggers when a lead submits a Facebook form',
      completed: false,
      current: true,
      type: 'trigger',
      metadata: {
        type: 'facebook_lead',
      },
    },
  };
}

/**
 * Create a voice call node
 */
function createVoiceCallNode(
  id: string,
  y: number,
  title: string,
  description: string
): EditorNode {
  return {
    id,
    type: 'voice_call',
    position: { x: 400, y },
    data: {
      title,
      description,
      completed: false,
      current: false,
      type: 'voice_call',
      metadata: {
        useDefaultScript: true,
        maxDuration: 300,
        respectBusinessHours: true,
      },
    },
  };
}

/**
 * Create a condition node
 */
function createConditionNode(
  id: string,
  y: number,
  title: string,
  description: string,
  field: string,
  operator: string,
  value: string,
  trueBranchLabel: string,
  falseBranchLabel: string
): EditorNode {
  return {
    id,
    type: 'condition',
    position: { x: 400, y },
    data: {
      title,
      description,
      completed: false,
      current: false,
      type: 'condition',
      metadata: {
        field,
        operator,
        value,
        trueBranchLabel,
        falseBranchLabel,
      },
    },
  };
}

/**
 * Create a wait node
 */
function createWaitNode(
  id: string,
  y: number,
  duration: number,
  unit: 'minutes' | 'hours' | 'days',
  title?: string
): EditorNode {
  return {
    id,
    type: 'wait',
    position: { x: 400, y },
    data: {
      title: title || `Wait ${duration} ${unit}`,
      description: `Pause for ${duration} ${unit} before next action`,
      completed: false,
      current: false,
      type: 'wait',
      metadata: {
        duration,
        unit,
      },
    },
  };
}

/**
 * Create an email node
 */
function createEmailNode(id: string, y: number): EditorNode {
  return {
    id,
    type: 'email',
    position: { x: 550, y },
    data: {
      title: 'Send Follow-Up Email',
      description: 'Send follow-up email to the lead',
      completed: false,
      current: false,
      type: 'email',
      metadata: {
        subject: 'We tried to reach you - {{organization.name}}',
        body: "Hi {{lead.firstName}},\n\nWe tried to call you but couldn't reach you. We'd love to help you with your appointment.\n\nPlease call us back or reply to schedule a time that works for you.\n\nBest regards,\n{{organization.name}}",
      },
    },
  };
}

/**
 * Create a webhook node for updating lead status
 */
function createUpdateStatusNode(
  id: string,
  y: number,
  status: string,
  title: string
): EditorNode {
  return {
    id,
    type: 'webhook',
    position: { x: 400, y },
    data: {
      title,
      description: `Update lead status to ${status}`,
      completed: false,
      current: false,
      type: 'webhook',
      metadata: {
        action: 'update_lead_status',
        status,
      },
    },
  };
}

/**
 * Create an edge between nodes
 */
function createEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  label?: string
): EditorEdge {
  return {
    id: `edge_${randomUUID().slice(0, 8)}`,
    source,
    target,
    sourceHandle,
    label,
  };
}

/**
 * Create the default follow-up sequence template
 *
 * This generates a complete sequence with all nodes and edges
 * for the standard lead follow-up flow.
 */
export function createDefaultFollowUpSequenceTemplate(): DefaultSequenceTemplate {
  // Generate unique IDs for all nodes
  const ids = {
    trigger: genId('trigger'),
    call1: genId('call'),
    checkBooked1: genId('cond'),
    checkSentiment1: genId('cond'),
    checkCallback1: genId('cond'),
    humanTakeover: genId('webhook'),
    waitCallback: genId('wait'),
    callbackCall: genId('call'),
    email: genId('email'),
    wait2h1: genId('wait'),
    call2: genId('call'),
    checkBooked2: genId('cond'),
    wait2h2: genId('wait'),
    call3: genId('call'),
    checkBooked3: genId('cond'),
    wait2h3: genId('wait'),
    call4: genId('call'),
    checkBooked4: genId('cond'),
    waitDay1: genId('wait'),
    call5: genId('call'),
    checkBooked5: genId('cond'),
    wait4h1: genId('wait'),
    call6: genId('call'),
    checkBooked6: genId('cond'),
    waitDay2: genId('wait'),
    call7: genId('call'),
    checkBooked7: genId('cond'),
    wait4h2: genId('wait'),
    call8: genId('call'),
    checkBooked8: genId('cond'),
    markCold: genId('webhook'),
  };

  // Create nodes
  const nodes: EditorNode[] = [
    // Entry point
    createTriggerNode(ids.trigger, 0),

    // Call 1 - Immediate
    createVoiceCallNode(
      ids.call1,
      100,
      'Immediate AI Call',
      'Call lead immediately after form submission'
    ),
    createConditionNode(
      ids.checkBooked1,
      200,
      'Appointment Booked?',
      'Check if lead booked during call',
      'status',
      'equals',
      'booked',
      'Booked',
      'Not Booked'
    ),
    createConditionNode(
      ids.checkSentiment1,
      300,
      'Difficult Buyer?',
      'Check for negative sentiment',
      'lastCall.sentiment',
      'equals',
      'Negative',
      'Negative',
      'OK'
    ),
    createConditionNode(
      ids.checkCallback1,
      400,
      'Callback Requested?',
      'Check if lead requested callback',
      'lastCall.callbackRequested',
      'equals',
      'true',
      'Yes',
      'No'
    ),

    // Human takeover branch
    createUpdateStatusNode(
      ids.humanTakeover,
      350,
      'human_takeover',
      'Flag for Human Review'
    ),

    // Callback branch
    createWaitNode(ids.waitCallback, 450, 1, 'hours', 'Wait for Callback Time'),
    createVoiceCallNode(
      ids.callbackCall,
      550,
      'Callback Call',
      'Call lead at requested time'
    ),

    // Email follow-up
    createEmailNode(ids.email, 500),

    // Day 0: Calls 2-4
    createWaitNode(ids.wait2h1, 600, 2, 'hours'),
    createVoiceCallNode(
      ids.call2,
      700,
      'Call Attempt 2',
      'Second call attempt (Day 0)'
    ),
    createConditionNode(
      ids.checkBooked2,
      800,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createWaitNode(ids.wait2h2, 900, 2, 'hours'),
    createVoiceCallNode(
      ids.call3,
      1000,
      'Call Attempt 3',
      'Third call attempt (Day 0)'
    ),
    createConditionNode(
      ids.checkBooked3,
      1100,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createWaitNode(ids.wait2h3, 1200, 2, 'hours'),
    createVoiceCallNode(
      ids.call4,
      1300,
      'Call Attempt 4',
      'Fourth call attempt (Day 0)'
    ),
    createConditionNode(
      ids.checkBooked4,
      1400,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    // Day 1: Calls 5-6
    createWaitNode(ids.waitDay1, 1500, 1, 'days', 'Wait until Day 1'),
    createVoiceCallNode(
      ids.call5,
      1600,
      'Call Attempt 5',
      'Fifth call attempt (Day 1)'
    ),
    createConditionNode(
      ids.checkBooked5,
      1700,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createWaitNode(ids.wait4h1, 1800, 4, 'hours'),
    createVoiceCallNode(
      ids.call6,
      1900,
      'Call Attempt 6',
      'Sixth call attempt (Day 1)'
    ),
    createConditionNode(
      ids.checkBooked6,
      2000,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    // Day 2: Calls 7-8
    createWaitNode(ids.waitDay2, 2100, 1, 'days', 'Wait until Day 2'),
    createVoiceCallNode(
      ids.call7,
      2200,
      'Call Attempt 7',
      'Seventh call attempt (Day 2)'
    ),
    createConditionNode(
      ids.checkBooked7,
      2300,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createWaitNode(ids.wait4h2, 2400, 4, 'hours'),
    createVoiceCallNode(
      ids.call8,
      2500,
      'Call Attempt 8',
      'Final call attempt (Day 2)'
    ),
    createConditionNode(
      ids.checkBooked8,
      2600,
      'Booked?',
      'Check if appointment booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    // Mark as lost
    createUpdateStatusNode(ids.markCold, 2700, 'lost', 'Mark as Lost'),
  ];

  // Create edges (connections between nodes)
  const edges: EditorEdge[] = [
    // Main flow start
    createEdge(ids.trigger, ids.call1),
    createEdge(ids.call1, ids.checkBooked1),

    // After first call checks
    createEdge(ids.checkBooked1, ids.checkSentiment1, 'no', 'Not Booked'),
    // Booked → END (no edge needed, sequence complete)

    createEdge(ids.checkSentiment1, ids.humanTakeover, 'yes', 'Negative'),
    createEdge(ids.checkSentiment1, ids.checkCallback1, 'no', 'OK'),

    // Callback flow
    createEdge(ids.checkCallback1, ids.waitCallback, 'yes', 'Yes'),
    createEdge(ids.waitCallback, ids.callbackCall),
    createEdge(ids.callbackCall, ids.checkBooked1), // Loop back to check if booked

    // No callback → Email
    createEdge(ids.checkCallback1, ids.email, 'no', 'No'),

    // After email → Day 0 calls
    createEdge(ids.email, ids.wait2h1),

    // Day 0 call flow
    createEdge(ids.wait2h1, ids.call2),
    createEdge(ids.call2, ids.checkBooked2),
    createEdge(ids.checkBooked2, ids.wait2h2, 'no', 'No'),

    createEdge(ids.wait2h2, ids.call3),
    createEdge(ids.call3, ids.checkBooked3),
    createEdge(ids.checkBooked3, ids.wait2h3, 'no', 'No'),

    createEdge(ids.wait2h3, ids.call4),
    createEdge(ids.call4, ids.checkBooked4),
    createEdge(ids.checkBooked4, ids.waitDay1, 'no', 'No'),

    // Day 1 call flow
    createEdge(ids.waitDay1, ids.call5),
    createEdge(ids.call5, ids.checkBooked5),
    createEdge(ids.checkBooked5, ids.wait4h1, 'no', 'No'),

    createEdge(ids.wait4h1, ids.call6),
    createEdge(ids.call6, ids.checkBooked6),
    createEdge(ids.checkBooked6, ids.waitDay2, 'no', 'No'),

    // Day 2 call flow
    createEdge(ids.waitDay2, ids.call7),
    createEdge(ids.call7, ids.checkBooked7),
    createEdge(ids.checkBooked7, ids.wait4h2, 'no', 'No'),

    createEdge(ids.wait4h2, ids.call8),
    createEdge(ids.call8, ids.checkBooked8),
    createEdge(ids.checkBooked8, ids.markCold, 'no', 'No'),

    // Mark cold → END (no more edges)
  ];

  return {
    name: 'Default Follow-Up Sequence',
    description:
      'Automated lead follow-up sequence with AI calls and email. Calls are scheduled within your business hours. The sequence exits automatically when an appointment is booked.',
    nodes,
    edges,
  };
}

/**
 * Export node IDs for reference (useful for testing)
 */
export type DefaultSequenceNodeIds = ReturnType<
  typeof createDefaultFollowUpSequenceTemplate
>['nodes'][number]['id'];
