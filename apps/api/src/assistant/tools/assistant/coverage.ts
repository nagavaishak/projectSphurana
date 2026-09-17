import { defineCoverage } from '../coverage.types.js';

/**
 * ASSISTANT — 25 endpoints, 2 tools. This is Claire's OWN control surface:
 * the streaming chat endpoint, her conversation records, her long-term memory
 * rows, her metering counters, her prompt-tuning inspectors and the WhatsApp
 * pairing that lets an owner talk to her off the web app.
 *
 * The coverage decision here is unusual, so it is worth stating once. For every
 * other area the question is "should Claire be able to do this to the
 * business?". Here the question is "should Claire be able to do this to
 * HERSELF?", and the answer is almost always no — not because the endpoint is
 * dangerous to the org, but because a tool pointed at Claire's own machinery is
 * a recursion rather than a capability:
 *
 *   - A tool for `POST /assistant/chat` has her call herself, inside a turn,
 *     with a fresh tool loop and a fresh budget.
 *   - A tool for the conversation records lets her edit or delete the transcript
 *     that is the audit trail of what she just did.
 *   - A tool for the memory rows lets her rewrite what she remembers about the
 *     owner without the owner ever seeing the edit.
 *   - A tool for the prompt inspectors lets her read and re-tune the prompt
 *     that is currently constraining her.
 *   - A tool for the usage counter lets her decide how much of her own quota
 *     the turn cost.
 *
 * Two endpoints are genuine capabilities and are exposed: reading the org
 * context she reasons from, and handing the owner off to a human.
 */
export const assistantCoverage = defineCoverage('assistant', {
  // ---- exposed -----------------------------------------------------------
  'GET /assistant/context': { exposed: 'context_getOrganizationContext' },

  // Escalating to a person is the one write on this controller that is a
  // capability rather than self-administration: Claire recognising she is the
  // wrong responder is exactly the behaviour we want, and the endpoint is
  // idempotent (re-calling returns the existing Intercom conversation).
  'POST /assistant/conversations/:id/handoff': {
    exposed: 'support_requestSupportChat',
    confirm: false,
  },

  // ---- her own conversation records --------------------------------------
  'GET /assistant/conversations': {
    notExposed:
      "Lists the caller's other Claire threads. Claire is already inside one; letting her enumerate the siblings pulls unrelated private conversations into the current context for no gain, and every one of them is a transcript of a different session.",
  },
  'GET /assistant/conversations/:id': {
    notExposed:
      'Returns a full Claire transcript including tool call payloads. Feeding her own prior output back in as tool RESULT text is a prompt-injection surface — anything a previous turn echoed becomes indistinguishable from ground truth.',
  },
  'POST /assistant/conversations': {
    notExposed:
      'Creates a new Claire thread. A turn already runs inside a conversation; spawning a second one detaches the work from the record the owner is reading and produces threads nobody opened.',
  },
  'PATCH /assistant/conversations/:id': {
    notExposed:
      'Renames or archives the thread the owner is currently looking at. Cosmetic for the model, disorienting for the human, and titles are already generated automatically after the first turn.',
  },
  'DELETE /assistant/conversations/:id': {
    notExposed:
      "Destroys the transcript of Claire's own actions. The conversation record is the audit trail for every confirmed write she made in it, so a tool that deletes it is a tool that erases the evidence of what she did.",
  },
  'POST /assistant/conversations/:id/escalate': {
    notExposed:
      'Sets the local escalated flag without opening a support channel. Superseded by the handoff endpoint, which does the same status flip AND creates the Intercom thread — two tools flipping one status column is how a model picks the useless one.',
  },
  'POST /assistant/conversations/:id/generate-title': {
    notExposed:
      'Post-turn housekeeping the chat pipeline already runs itself once a conversation has enough content. Nothing for the model to decide, and a mid-turn call would rename the thread under the owner as they read it.',
  },

  // ---- her own memory ----------------------------------------------------
  'GET /assistant/memories': {
    undecided: 'ENG-CLAIRE-ASSISTANT',
  },
  'PATCH /assistant/memories/:id': {
    notExposed:
      'Edits a stored preference and re-embeds it. `meta_remember` already lets Claire ADD what she learned, which the owner can review; silently rewriting an existing memory changes what she believes about them with no visible turn to point at.',
  },
  'DELETE /assistant/memories/:id': {
    notExposed:
      'Deletes a preference the owner set in the Claire settings page, and drops the backing knowledge entry with it. Self-directed forgetting is not a capability — the owner curates this list, in a UI built for it.',
  },

  // ---- standing content rules (the same memory store, narrowed) ----------
  'GET /assistant/content-rules': {
    notExposed:
      'The rules are already injected into every copy-generation prompt Claire runs, so a tool here would let her recite them without changing anything she does. The owner reads and edits them as chips in the content review workspace and rows in the memories settings page.',
  },
  'POST /assistant/content-rules': {
    notExposed:
      "Saves an org-wide rule that silently shapes every future post for everyone in the business. It is deliberately only reachable by tapping a suggestion in the review workspace, where the owner has just seen the change applied to a real post and can judge whether they want it everywhere. `meta_remember` already covers 'remember this about us' from chat; a second write path would let a passing remark mid-conversation become a standing rule nobody else agreed to.",
  },

  // ---- the chat endpoint itself ------------------------------------------
  'POST /assistant/chat': {
    notExposed:
      'This IS Claire. A tool that posts here makes her invoke herself mid-turn with a nested tool loop, a second set of confirmations and no shared budget or cancellation. The recursion is unbounded and every safety check would have to hold twice.',
  },

  // ---- prompt tuning / dev inspectors ------------------------------------
  'POST /assistant/prompt-preview': {
    notExposed:
      'Dev prompt inspector — renders the assembled system prompt for a hypothetical turn. Handing Claire her own prompt makes the constraints she is operating under readable and therefore negotiable in-conversation.',
  },
  'POST /assistant/prompt-config': {
    notExposed:
      'Dev prompt-tuning surface for the local inspector. A model that can read and adjust its own prompt configuration is re-tuning the thing that governs it; that decision belongs to whoever ships the prompt.',
  },

  // ---- metering ----------------------------------------------------------
  'GET /assistant/usage': {
    notExposed:
      'Her own message quota counters, rendered as a plan-usage widget in settings. Self-referential mid-turn (the number is stale the moment the turn completes) and it invites bargaining about how much work is left in the allowance.',
  },
  'GET /assistant/usage/history': {
    notExposed:
      'Daily and monthly usage series built to draw the settings chart. Dozens of datapoints of Claire metering herself — no business signal, and nothing she could act on if she read it.',
  },
  'POST /assistant/usage/increment': {
    notExposed:
      'Bumps the metering counter, and the chat pipeline already calls it once per turn. Exposing it would let the model decide how much of the plan its own turn consumed — including deciding not to.',
  },

  // ---- v3 flag, uploads, WhatsApp pairing --------------------------------
  'GET /assistant/v3-status': {
    notExposed:
      'A feature-flag probe the frontend uses to choose which chat UI to mount. Not a capability — it describes which Claire is running, which the running Claire cannot usefully act on.',
  },
  'POST /assistant/uploads/sign': {
    notExposed:
      'Signs a short-lived S3 PUT URL so the browser file picker can upload an image directly. Claire holds no file bytes and cannot perform the upload leg, so a signed URL is a dead end in her hands.',
  },
  'POST /assistant/whatsapp-link/start': {
    notExposed:
      'Starts owner WhatsApp pairing by minting a code the owner must send from their handset. The out-of-band step is the whole security property; Claire initiating it cannot complete it and only produces live codes nobody asked for.',
  },
  'POST /assistant/whatsapp-link/verify': {
    notExposed:
      'Consumes a pairing code plus a phone number and binds that handset to the account. A model able to call this with attacker-supplied numbers is the direct path to hijacking the channel Claire speaks on.',
  },
  'GET /assistant/whatsapp-link/status': {
    notExposed:
      'Pairing state for the settings toggle. It describes the transport Claire may literally be talking over, and knowing it changes nothing about the answer she gives.',
  },
  'DELETE /assistant/whatsapp-link/:id': {
    notExposed:
      'Revokes a paired handset. If the turn arrived over WhatsApp this severs the connection mid-conversation, and re-pairing needs physical access to the phone.',
  },

  // ---- knowledge ---------------------------------------------------------
  'POST /assistant/knowledge/query': {
    notExposed:
      'RAG search over the org knowledge base — already run by the chat pipeline before the model sees the turn, with the results injected as context. A tool would re-fetch what she was just handed.',
  },
});
