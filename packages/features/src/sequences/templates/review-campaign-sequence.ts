/**
 * Review Campaign Sequence Template
 *
 * This template defines a review solicitation flow for past customers:
 * 1. Trigger: Manual (user imports/selects leads)
 * 2. SMS: Ask for Google review
 * 3. Wait 2 days
 * 4. Condition: Review left?
 * 5. If no → Email: Reminder
 * 6. Wait 3 days
 * 7. If still no → SMS: Final reminder
 * 8. End
 */

import { randomUUID } from 'node:crypto';

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

export interface ReviewCampaignTemplate {
  name: string;
  description: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
}

function genId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function createTriggerNode(id: string, y: number): EditorNode {
  return {
    id,
    type: 'trigger',
    position: { x: 400, y },
    data: {
      title: 'Manual Trigger',
      description: 'Import or select past customers to request reviews',
      completed: false,
      current: true,
      type: 'trigger',
      metadata: { type: 'manual' },
    },
  };
}

function createSmsNode(
  id: string,
  y: number,
  title: string,
  description: string,
  message: string
): EditorNode {
  return {
    id,
    type: 'sms',
    position: { x: 400, y },
    data: {
      title,
      description,
      completed: false,
      current: false,
      type: 'sms',
      metadata: { message },
    },
  };
}

function createEmailNode(
  id: string,
  y: number,
  title: string,
  description: string,
  subject: string,
  body: string
): EditorNode {
  return {
    id,
    type: 'email',
    position: { x: 550, y },
    data: {
      title,
      description,
      completed: false,
      current: false,
      type: 'email',
      metadata: { subject, body },
    },
  };
}

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
      metadata: { duration, unit },
    },
  };
}

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
      metadata: { field, operator, value, trueBranchLabel, falseBranchLabel },
    },
  };
}

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
 * Create the review campaign sequence template
 */
export function createReviewCampaignSequenceTemplate(): ReviewCampaignTemplate {
  const ids = {
    trigger: genId('trigger'),
    sms1: genId('sms'),
    wait2d: genId('wait'),
    checkReview1: genId('cond'),
    email: genId('email'),
    wait3d: genId('wait'),
    checkReview2: genId('cond'),
    sms2: genId('sms'),
  };

  const nodes: EditorNode[] = [
    createTriggerNode(ids.trigger, 0),

    createSmsNode(
      ids.sms1,
      100,
      'Request Review SMS',
      'Send initial review request via SMS',
      "Hi {{lead.firstName}}, thanks for visiting {{organization.name}}! We'd love your feedback. Leave us a Google review: {{organization.reviewLink}}"
    ),

    createWaitNode(ids.wait2d, 200, 2, 'days'),

    createConditionNode(
      ids.checkReview1,
      300,
      'Review Left?',
      'Check if the customer has left a review',
      'reviewStatus',
      'equals',
      'completed',
      'Yes',
      'No'
    ),

    createEmailNode(
      ids.email,
      400,
      'Review Reminder Email',
      'Send email reminder to leave a review',
      'Your feedback means the world to us - {{organization.name}}',
      "Hi {{lead.firstName}},\n\nWe noticed you haven't had a chance to leave a review yet. Your feedback truly means the world to us and helps other customers find us.\n\nIt only takes a minute: {{organization.reviewLink}}\n\nThank you for your support!\n\nBest regards,\n{{organization.name}}"
    ),

    createWaitNode(ids.wait3d, 500, 3, 'days'),

    createConditionNode(
      ids.checkReview2,
      600,
      'Review Left?',
      'Final check if the customer has left a review',
      'reviewStatus',
      'equals',
      'completed',
      'Yes',
      'No'
    ),

    createSmsNode(
      ids.sms2,
      700,
      'Final Review Reminder',
      'Send final SMS reminder for review',
      "Hi {{lead.firstName}}, just a quick reminder — we'd really appreciate your feedback on {{organization.name}}. Leave a review here: {{organization.reviewLink}} Thank you!"
    ),
  ];

  const edges: EditorEdge[] = [
    createEdge(ids.trigger, ids.sms1),
    createEdge(ids.sms1, ids.wait2d),
    createEdge(ids.wait2d, ids.checkReview1),
    // Review left → END (no edge)
    createEdge(ids.checkReview1, ids.email, 'no', 'No'),
    createEdge(ids.email, ids.wait3d),
    createEdge(ids.wait3d, ids.checkReview2),
    // Review left → END (no edge)
    createEdge(ids.checkReview2, ids.sms2, 'no', 'No'),
    // After final SMS → END
  ];

  return {
    name: 'Review Campaign',
    description:
      'Automated sequence to request Google reviews from past customers via SMS and email. Includes smart follow-ups with a 2-day and 3-day wait between reminders.',
    nodes,
    edges,
  };
}
