// WS-11 — Claire-on-WhatsApp proactive nudges (plan §2 P5 / §4 WS-11).
export {
  CLAIRE_NUDGE_TEMPLATES,
  CLAIRE_NUDGE_TEMPLATE_LANGUAGE,
  submitClaireNudgeTemplates,
  type ClaireNudgeTemplateName,
  type ClaireNudgeTemplateDef,
  type SubmitClaireNudgeTemplatesResult,
} from './templates.js';
export {
  DEFAULT_NUDGE_POLICY,
  decideNudge,
  isWithinQuietHours,
  type NudgeCandidate,
  type NudgeDecision,
  type NudgeOwnerSignals,
  type NudgePolicy,
  type NudgeSkipReason,
} from './nudge-conditions.js';
export {
  isOptedOut,
  parseOptOutPhones,
  type NudgeOptOutConfig,
} from './opt-out.js';
export {
  sendClaireNudge,
  renderTemplateBody,
  type SendClaireNudgeInput,
  type SendClaireNudgeResult,
} from './send-nudge.service.js';
export {
  runClaireWhatsappNudges,
  defaultResolveCandidate,
  type NudgeRunOutcome,
  type RunNudgesDeps,
} from './run-nudges.js';
