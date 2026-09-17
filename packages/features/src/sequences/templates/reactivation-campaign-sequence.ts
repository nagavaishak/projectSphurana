/**
 * Reactivation Campaign Sequence Template
 *
 * This template defines a re-engagement flow for cold/inactive leads:
 * 1. Trigger: Manual (imported/tagged cold leads)
 * 2. SMS: Re-engagement message
 * 3. Wait 1 day
 * 4. Condition: Response received?
 * 5. If no → Voice Call: AI call with special offer
 * 6. Wait 2 days
 * 7. Condition: Appointment booked?
 * 8. If no → Email: Exclusive offer
 * 9. Wait 3 days
 * 10. If still no → SMS: Final limited-time reminder
 * 11. Mark as cold / end
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

export interface ReactivationCampaignTemplate {
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
      description: 'Import or tag cold/inactive leads to re-engage',
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
      metadata: { action: 'update_lead_status', status },
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
 * Create the reactivation campaign sequence template
 */
export function createReactivationCampaignSequenceTemplate(): ReactivationCampaignTemplate {
  const ids = {
    trigger: genId('trigger'),
    sms1: genId('sms'),
    wait1d: genId('wait'),
    checkResponse: genId('cond'),
    voiceCall: genId('call'),
    wait2d: genId('wait'),
    checkBooked: genId('cond'),
    email: genId('email'),
    wait3d: genId('wait'),
    checkBooked2: genId('cond'),
    sms2: genId('sms'),
    markCold: genId('webhook'),
  };

  const nodes: EditorNode[] = [
    createTriggerNode(ids.trigger, 0),

    createSmsNode(
      ids.sms1,
      100,
      'Re-engagement SMS',
      'Send initial re-engagement message',
      "Hi {{lead.firstName}}, it's been a while since we've seen you at {{organization.name}}! We have something special for you — reply YES to learn more."
    ),

    createWaitNode(ids.wait1d, 200, 1, 'days'),

    createConditionNode(
      ids.checkResponse,
      300,
      'Response Received?',
      'Check if the lead replied to the SMS',
      'lastMessage.replied',
      'equals',
      'true',
      'Yes',
      'No'
    ),

    createVoiceCallNode(
      ids.voiceCall,
      400,
      'AI Re-engagement Call',
      'AI call to re-engage with a special offer'
    ),

    createWaitNode(ids.wait2d, 500, 2, 'days'),

    createConditionNode(
      ids.checkBooked,
      600,
      'Appointment Booked?',
      'Check if the lead booked an appointment',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createEmailNode(
      ids.email,
      700,
      'Exclusive Offer Email',
      'Send an exclusive offer email',
      "We miss you! Here's a special offer - {{organization.name}}",
      "Hi {{lead.firstName}},\n\nWe miss having you at {{organization.name}}! As a valued past customer, we'd like to offer you something exclusive:\n\n{{organization.offerDetails}}\n\nThis offer is only available for a limited time. Book your appointment today!\n\nWarm regards,\n{{organization.name}}"
    ),

    createWaitNode(ids.wait3d, 800, 3, 'days'),

    createConditionNode(
      ids.checkBooked2,
      900,
      'Appointment Booked?',
      'Final check if the lead booked',
      'status',
      'equals',
      'booked',
      'Yes',
      'No'
    ),

    createSmsNode(
      ids.sms2,
      1000,
      'Final Reminder SMS',
      'Send final limited-time reminder',
      "Hi {{lead.firstName}}, last chance! Our special offer for you at {{organization.name}} expires soon. Don't miss out — book now: {{organization.bookingLink}}"
    ),

    createUpdateStatusNode(ids.markCold, 1100, 'lost', 'Mark as Lost'),
  ];

  const edges: EditorEdge[] = [
    createEdge(ids.trigger, ids.sms1),
    createEdge(ids.sms1, ids.wait1d),
    createEdge(ids.wait1d, ids.checkResponse),
    // Response received → END (lead is engaged, handled manually)
    createEdge(ids.checkResponse, ids.voiceCall, 'no', 'No'),
    createEdge(ids.voiceCall, ids.wait2d),
    createEdge(ids.wait2d, ids.checkBooked),
    // Booked → END
    createEdge(ids.checkBooked, ids.email, 'no', 'No'),
    createEdge(ids.email, ids.wait3d),
    createEdge(ids.wait3d, ids.checkBooked2),
    // Booked → END
    createEdge(ids.checkBooked2, ids.sms2, 'no', 'No'),
    createEdge(ids.sms2, ids.markCold),
  ];

  return {
    name: 'Reactivation Campaign',
    description:
      'Re-engage cold or inactive leads with a multi-channel campaign including SMS, AI voice calls, and email. Includes a special offer flow with escalating urgency over 6 days.',
    nodes,
    edges,
  };
}
