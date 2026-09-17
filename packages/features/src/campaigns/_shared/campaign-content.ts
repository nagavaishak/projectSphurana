/**
 * Campaign content kit — the ONE definition of "what actually sends", shared by
 * the server sender AND the browser preview so the two can never drift.
 *
 * PURE MODULE — no node-only deps, no I/O, no imports from `@borradh-workspace/
 * database`, `env`, `ai`, etc. This is what lets the frontend value-import it
 * (via `@borradh-workspace/features/campaigns/content`, re-exported by
 * `@borradh-workspace/api-client`) without dragging the node-heavy campaigns
 * barrel into the browser bundle.
 */

/**
 * The mandatory opt-out line that every WhatsApp campaign must carry. It is
 * part of the canonical template body below, and shown in the preview — it is a
 * hard compliance gate, never editable away.
 */
export const WHATSAPP_STOP_LINE = 'Reply STOP to unsubscribe.';

/**
 * The single WhatsApp template the everyday campaign flow standardises on.
 *
 *   Hi {{1}},          ← {{1}} auto-binds to the recipient's first name
 *
 *   {{2}}              ← {{2}} is the user-authored message body
 *
 *   Reply STOP to unsubscribe.   ← the hard-gated opt-out line
 *
 * Shared by the auto-provision step (`ensureCampaignWhatsappTemplate`) and the
 * composer so the name, language, category and STOP line have ONE source.
 */
export const CANONICAL_WHATSAPP_TEMPLATE = {
  name: 'borradh_campaign_message',
  languageCode: 'en_US',
  category: 'MARKETING',
  body: `Hi {{1}},\n\n{{2}}\n\n${WHATSAPP_STOP_LINE}`,
} as const;

/** Escape the HTML-significant characters so authored text can't inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface RenderCampaignEmailHtmlOptions {
  /**
   * When set, the compliant one-click-unsubscribe footer is appended. Its
   * presence is what makes the email opt-out; a campaign email is never sent
   * without it (the sender always passes it — see `build-channel-senders`).
   */
  unsubscribeUrl?: string;
}

/**
 * Convert a PLAIN-TEXT campaign email body (authored in a textarea) into the
 * exact HTML the email carries. Blank-line-separated blocks become `<p>`s;
 * single newlines become `<br/>`; markup is escaped. When `unsubscribeUrl` is
 * provided, the exact `<hr>` + "Don't want these emails? Unsubscribe" footer
 * the sender injects is appended.
 *
 * This is the ONE converter both the sender and the preview import, so the
 * preview is byte-for-byte what gets delivered.
 */
export function renderCampaignEmailHtml(
  body: string,
  opts?: RenderCampaignEmailHtmlOptions
): string {
  const blocks = body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(block).replace(
          /\n/g,
          '<br/>'
        )}</p>`
    );
  // A body with no text still needs a container so the footer renders cleanly.
  const bodyHtml = blocks.join('') || '<p style="margin:0"></p>';

  if (!opts?.unsubscribeUrl) return bodyHtml;

  return `${bodyHtml}<hr style="margin-top:32px;border:none;border-top:1px solid #eee"/><p style="font-size:12px;color:#888;text-align:center">Don't want these emails? <a href="${opts.unsubscribeUrl}" style="color:#888">Unsubscribe</a></p>`;
}

/** The minimal WhatsApp-template shape the resolver needs (a subset of the row). */
export interface CampaignWhatsappTemplateAtom {
  id: string;
  name: string;
  languageCode: string;
  status: string;
  body: string;
}

export interface ResolvedCampaignWhatsappTemplate {
  /** The chosen template (canonical by name, else first approved). */
  template: CampaignWhatsappTemplateAtom;
  /** `{{1}}` — the first-name auto-param; null when the body has no `{{1}}`. */
  firstNameParamIndex: number | null;
  /** The user-fillable params — everything except `{{1}}`, ascending. */
  editableParamIndices: number[];
}

/** Extract the unique, ascending `{{n}}` positional-param indices from a body. */
function extractParamIndices(body: string): number[] {
  const indices = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let match: RegExpExecArray | null = re.exec(body);
  while (match !== null) {
    indices.add(Number(match[1]));
    match = re.exec(body);
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Pick the campaign WhatsApp template and split its params into the auto-bound
 * first-name param (`{{1}}`) and the user-fillable rest (`{{2}}..{{n}}`).
 *
 * Preference: the canonical `borradh_campaign_message` by name; failing that,
 * the first approved template. Returns null when neither exists.
 */
export function resolveCampaignWhatsappTemplate(
  templates: CampaignWhatsappTemplateAtom[]
): ResolvedCampaignWhatsappTemplate | null {
  const canonical = templates.find(
    (t) => t.name === CANONICAL_WHATSAPP_TEMPLATE.name
  );
  const chosen =
    canonical ?? templates.find((t) => t.status === 'approved') ?? null;
  if (!chosen) return null;

  const paramIndices = extractParamIndices(chosen.body);
  const firstNameParamIndex = paramIndices.includes(1) ? 1 : null;
  const editableParamIndices = paramIndices.filter((i) => i !== 1);

  return { template: chosen, firstNameParamIndex, editableParamIndices };
}

/**
 * Fill a template body's `{{n}}` params from an index-keyed record. Params with
 * no supplied value keep their `{{n}}` token (so the preview shows what's still
 * unfilled). Literal text — including the STOP line — is left untouched.
 */
export function fillWhatsappTemplate(
  body: string,
  valuesByParamIndex: Record<number, string>
): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (token, digits: string) => {
    const index = Number(digits);
    return index in valuesByParamIndex ? valuesByParamIndex[index] : token;
  });
}
