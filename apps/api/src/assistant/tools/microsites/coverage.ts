import { defineCoverage } from '../coverage.types.js';

/**
 * MICROSITES — 12 endpoints, 0 Claire tools, deliberately.
 *
 * The website has its own editing agent (contract §2, implemented in
 * `packages/features/src/microsites/agent`): thirteen tools, a per-turn call
 * budget, one revision per turn, and an editor UI whose canvas shows the user
 * what each edit did as it happens. Claire is a different surface with none of
 * that context.
 *
 * Handing her a second route to the same writes would mean two agents editing
 * one document with no shared budget, no shared undo unit, and nobody watching
 * the canvas — so these stay `notExposed` and the answer to "change my website"
 * is to open the website editor, where the agent that owns the document lives.
 */
export const micrositesCoverage = defineCoverage('microsites', {
  'POST /microsites': {
    notExposed:
      "Creates the tenant's website from scratch — a model call to write its copy, then a published site on a public URL. That is a deliberate first step someone takes in the editor, where they can see what was made; a chat turn that quietly stands up a public page for a business is not something a person asked for by saying 'sort out my website'.",
  },
  'GET /microsites/mine': {
    notExposed:
      "The whole draft document — every page, block and prop of the tenant website. It is the editor canvas's payload, sized for a UI and not for a chat context, and the editing agent already loads it as its own turn context.",
  },
  'POST /microsites/:id/chat': {
    notExposed:
      'Streams a turn of the WEBSITE editing agent. Claire calling it would be one model driving another with no shared budget, and its reply becomes untrusted text laundered into her context. It is also SSE, which the tool transport cannot consume.',
  },
  'GET /microsites/:id/conversations/:conversationId': {
    notExposed:
      "The website editor's own chat transcript. It is another assistant's conversation history — reading it back into Claire's context mixes two agents' instructions and answers nothing a person would ask her.",
  },
  'GET /microsites/:id/revisions': {
    notExposed:
      "Version history for the website document, rendered as the editor's undo stack beside the canvas. The entries are only actionable through the restore control that sits next to them.",
  },
  'POST /microsites/:id/revisions/:revisionId/restore': {
    notExposed:
      'Undo/redo for the website. It rewrites every page from a snapshot, and it is only safe when the person can see the canvas change — which is the editor, not a chat thread where a wrong revision id silently reverts a day of work.',
  },
  'POST /microsites/:id/publish': {
    notExposed:
      'Makes the current draft the public website. The editing agent deliberately does NOT publish either: publishing is the one moment a human decides the site is ready, and it stays a button beside the preview.',
  },
  'POST /microsites/:id/domains': {
    notExposed:
      "Attaching a custom domain hands back DNS records the owner has to paste into their registrar, and the follow-up is a verification poll they watch. Claire cannot see the registrar screen, cannot confirm the records landed, and a domain typed into a chat thread is a hostname nobody re-read — it is the settings screen's job, next to the instructions.",
  },
  'GET /microsites/:id/domains': {
    notExposed:
      "The domain list with each row's verification state and outstanding DNS records. It is the settings screen's own payload; the states only mean anything beside the instructions and the Check now control that act on them.",
  },
  'GET /microsites/:id/domains/:domainId/status': {
    notExposed:
      'The "Check now" control — it triggers a live provider poll for the row the owner is looking at. Rate-shaped for a button beside a spinner, not for a chat turn that would poll on the tenant\'s behalf with nothing to show.',
  },
  'POST /microsites/:id/domains/:domainId/primary': {
    notExposed:
      'Changing the canonical host rewrites every live ad destination and requires the owner to redo Meta domain verification and AEM. It is a deliberate, consequential switch made beside the list of domains and their statuses, not something to trigger from a sentence.',
  },
  'DELETE /microsites/:id/domains/:domainId': {
    notExposed:
      "Detaching a domain takes the tenant's public website off their own address. There is no undo that restores the certificate instantly, and the confirmation belongs next to the row being removed.",
  },
  'PATCH /microsites/:id/pages/:pageId/blocks/:blockId': {
    notExposed:
      "The inspector's field edit and the canvas drag-reorder. It is a direct manipulation of the block the user has selected on screen — there is no selection in a chat thread, and the website agent has update_block and move_block for the conversational path.",
  },
});
