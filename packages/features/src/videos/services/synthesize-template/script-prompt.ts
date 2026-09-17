import { businessTypeLabels } from '@borradh-workspace/labels';
import {
  type OrgContext,
  buildOrgContextBlock,
} from '../../../shared/org-context.js';

export interface ScriptRoleRequirement {
  role: 'hook' | 'body' | 'cta' | 'disclaimer' | 'list';
  required: boolean;
  bodyCount?: [min: number, max: number];
  /** For role 'list': how many distinct lists the template declares. */
  listCount?: number;
}

type ScriptRole = 'hook' | 'body' | 'cta' | 'disclaimer' | 'list';

const ROLE_GUIDANCE: Record<ScriptRole, string> = {
  hook: 'One short opening line that pulls the viewer in (question or punchy statement). Under 10 words.',
  body: 'The middle on-screen lines that deliver the value. Each item is a separate text frame. Under 10 words per item. Third person — no "I", "we", or "our".',
  cta: 'One short call-to-action line. Under 8 words (e.g. "DM to learn more", "Book a consultation").',
  disclaimer:
    'One short disclaimer line if relevant (e.g. "Results vary", "Consultation required"). Under 10 words.',
  list: 'A list of short on-screen items. Each item under 8 words.',
};

// Per-template, per-list guidance for the generic 'list' role (templates with
// multiple lists, e.g. ins-outs). Indexed to match the `list` slot's index.
const TEMPLATE_LIST_GUIDANCE: Record<string, string[]> = {
  'ins-outs-1': [
    'The "INS" — 5-6 short items that are IN / trending / recommended this year. Each 1-4 words, title case, no punctuation.',
    'The "OUTS" — 5-6 short items that are OUT / outdated / to avoid. Each 1-4 words, title case, no punctuation.',
  ],
};

// Per-template role guidance. Some templates (the organic formats ported from
// the dedicated `generate-organic-copy` prompts) need bespoke copy that the
// generic guidance above doesn't produce — e.g. caption-tease's caption is a
// "read the caption" teaser, not a booking CTA, and its headline carries one
// bolded emphasis word. Keyed by templateId; overrides merge over ROLE_GUIDANCE.
// This is content guidance only — the renderer stays fully generic.
const TEMPLATE_ROLE_GUIDANCE: Record<
  string,
  Partial<Record<ScriptRole, string>>
> = {
  'caption-tease-1': {
    hook: 'A short serif headline (≤8 words) stating the key hook or benefit. Wrap exactly ONE high-impact word in **double asterisks** to bold it — a number or a punchy word like ONE / FREE / NEW works best.',
    cta: 'A 2–4 word downward nudge that tells the viewer to read the post caption. Examples: "Check the caption", "Full story below", "Read this". NOT a booking link, DM, or phone number.',
  },
  'question-cta-1': {
    hook: 'A short, punchy, relatable question that names a pain point or desire the viewer feels — the kind that makes them stop scrolling. Keep it ≤6 words. E.g. "Struggling with stubborn acne?", "Tired of dull skin?", "Still fighting breakouts?". The answer lives in the post caption.',
    cta: 'A very short "read the caption" nudge — 2-4 words ending with a down-arrow ⬇. E.g. "Read caption ⬇", "Full story below ⬇", "Answer below ⬇".',
  },
  'fade-benefits-1': {
    hook: 'JUST the name of the focus treatment/procedure/service this video is about — the bare name only, ≤4 words, Title Case. No verb, no benefit, no punctuation. It opens the video on its own line.',
    body: 'Short benefit STATEMENTS that build on each other (benefit → outcome → soft nudge). Each ≤8 words, sentence case, no trailing punctuation. Concrete to the focus service; calm, premium tone.',
  },
  'highlight-caption-1': {
    hook: 'A punchy, scroll-stopping opening line ≤7 words that names a feeling or pain point — the kind that reads well on a bold highlight bar. Sentence case, no trailing punctuation. E.g. "Your skin, but make it glow".',
    body: 'Short caption STATEMENTS that build the story (hook → insight → payoff → soft nudge). 3-5 of them, each ≤7 words so it fits one highlight block, sentence case, no trailing punctuation. Concrete to the focus service; confident, relatable tone.',
  },
  'curiosity-hook-1': {
    hook: 'A bold, surprising CLAIM (not a literal question), 5-10 words, that opens a curiosity gap and makes the viewer keep watching. E.g. "You\'ve been treating dull skin backwards". No question mark, no greeting.',
    cta: 'A short "keep watching" nudge, 2-5 words. E.g. "Watch till the end", "Here\'s why", "Wait for it".',
  },
  'step-timer-1': {
    hook: 'A bold uppercase title naming the routine and step count, ≤8 words. E.g. "YOUR 4-STEP GLOW ROUTINE". The count must match the number of body steps.',
    body: 'Numbered timed STEPS, 3-5 of them. Each names an action AND its duration in the form "Action — duration", ≤6 words. E.g. "Cleanse — 60 sec", "Mask — 10 min". Do NOT prefix with numbers; the template draws the badge.',
  },
  'time-progress-1': {
    hook: 'A timestamp PROGRESSION as the hero, in the form "start → end", ≤5 words. Match the realistic timeframe of the focus treatment. E.g. "Day 1 → Day 30", "0h → 4 hrs", "Week 1 → Week 6".',
    cta: 'A short caption naming the visible change over that time, ≤7 words. E.g. "Redness fading, skin calming", "Fuller, more even lips".',
  },
  'numbered-list-1': {
    hook: 'A bold title that references the NUMBER of tips, ~5-8 words, e.g. "4 WAYS TO MAXIMIZE YOUR ACNE TREATMENT". The count must match the number of body items.',
    body: 'Short, practical tips — 3-6 of them, each 2-6 words, imperative voice (start with a verb), e.g. "Cleanse gently daily". Do NOT prefix items with numbers, digits, or bullets — the template draws the numbered badge automatically.',
  },
  'improves-1': {
    hook: 'JUST the name of the focus treatment/procedure/service — the bare name only, ≤4 words, Title Case. No verb, no punctuation. It opens the video.',
    body: 'Short benefit OUTCOMES, 3-6 of them, that each complete the phrase "IMPROVES: ___". Each 1-3 words, Title Case, no punctuation. E.g. "Clear Skin", "Natural Radiance", "Skin Texture".',
    cta: 'One short closing call-to-action. Under 6 words, e.g. "Book your consultation".',
  },
  'ins-outs-1': {
    hook: 'A short bold title for an "ins and outs" trends video that references the year or the theme, e.g. "2026 ACNE TREATMENT TRENDS". 3-6 words, no punctuation.',
  },
  'aesthetic-line-1': {
    // A single understated, relatable line — a mood, not a sell. MUST follow the
    // v1 "this & <personal fantasy>" shape, all lowercase. NOT a clinical benefit.
    hook: 'A single lowercase line that MUST start with "this & " then a SHORT personal ending (≤3 words) — keep the WHOLE line ~28 characters or fewer. The ending is a personal fantasy / feeling / identity (usually first person "my …"), e.g. "this & my dream skin", "this & thinking about nothing", "this & protecting my peace". NEVER clinical or feature phrasing (bad: "this & smoother skin", "this & less fat"). Lowercase, no trailing punctuation, no emojis, no CTA.',
  },
};

export interface BuildScriptPromptInput {
  orgContext: OrgContext;
  templateId: string;
  templateDescription?: string;
  scriptTemplate?: string;
  roles: ScriptRoleRequirement[];
}

export function buildScriptPrompt(input: BuildScriptPromptInput): {
  systemMessage: string;
  userMessage: string;
} {
  const { orgContext, templateId, templateDescription, scriptTemplate, roles } =
    input;
  const businessType =
    businessTypeLabels[orgContext.businessType] || orgContext.businessType;

  const bodyReq = roles.find((r) => r.role === 'body');
  const bodyCount = bodyReq?.bodyCount;

  const templateGuidance = TEMPLATE_ROLE_GUIDANCE[templateId] ?? {};
  const listGuidance = TEMPLATE_LIST_GUIDANCE[templateId];
  const roleLines = roles.map((r) => {
    // The generic 'list' role expands to per-list guidance: "lists" is an array
    // of lists; each entry gets its own line so the model knows what each holds.
    if (r.role === 'list') {
      const count = r.listCount ?? 1;
      const perList = Array.from({ length: count }, (_, i) => {
        const g = listGuidance?.[i] ?? ROLE_GUIDANCE.list;
        return `    • lists[${i}]: ${g}`;
      }).join('\n');
      return `- "lists": an array of ${count} lists (each a list of short strings):\n${perList}`;
    }
    const guidance = templateGuidance[r.role] ?? ROLE_GUIDANCE[r.role];
    const base = `- "${r.role}": ${guidance}`;
    if (r.role === 'body' && bodyCount) {
      return `${base} Produce between ${bodyCount[0]} and ${bodyCount[1]} items.`;
    }
    if (!r.required) {
      return `${base} Optional — omit the field if it doesn't fit naturally.`;
    }
    return base;
  });

  const schemaShape = buildSchemaShape(roles);

  const systemMessage = `You are an expert short-form video scriptwriter for a ${businessType}.

${buildOrgContextBlock(orgContext)}

You are writing a script for the video template "${templateId}"${templateDescription ? ` (${templateDescription})` : ''}.

The script is split into roles. Each role lands in a different on-screen slot of the template:

${roleLines.join('\n')}

Voice rules:
- Write in third person — no "I", "we", "our", "me", or "my" — UNLESS a role above explicitly asks for first-person phrasing (then follow that role's instruction exactly).
- No greetings ("Hi", "Hello") — jump straight into the content.
- Match the brand voice described above.
- Use real, specific content based on the business context — no UPPER CASE placeholders.
- Reference actual services offered by the business where appropriate.
- No hashtags, no emojis, no social media formatting — EXCEPT markers a role above explicitly asks for (e.g. \`**word**\` bold emphasis, or a trailing ⬇ down-arrow on a "read the caption" CTA).${
    scriptTemplate
      ? `

Template fidelity (CRITICAL):
- The template below is the EXACT line structure to follow — not loose inspiration. It defines how many lines there are and what each line says.
- Personalize the template LINE BY LINE: keep each line's meaning, order, and format (arrows like "→", disclaimer phrasing like "Results vary • Consultation required", the closing call-to-action), and replace every [PLACEHOLDER] with real, specific content from the business context.
- Do NOT invent extra value/benefit lines, and do NOT drop lines. The number of "body" items must equal the number of middle lines in the template (every line that is not the opening hook, not a closing call-to-action, and not the closing disclaimer).
- Map the lines to roles: the first line is the "hook"; a closing "DM / book / contact" line is the "cta"; a "results vary / consultation required"-style line is the "disclaimer"; every other line, in order, is a "body" item.`
      : ''
  }

Respond with valid JSON only.`;

  const templateHint = scriptTemplate
    ? `\n\nThe template to personalize line by line (follow its structure exactly):\n"""\n${scriptTemplate}\n"""`
    : '';

  const userMessage = `Write the script for the "${templateId}" template.${templateHint}

Return JSON matching this exact shape:
${schemaShape}`;

  return { systemMessage, userMessage };
}

export function buildRepairMessage(
  rawAttempt: string,
  parseError: string
): {
  systemMessage: string;
  userMessage: string;
} {
  return {
    systemMessage:
      'You are repairing a malformed JSON response. Output ONLY valid JSON matching the schema in the user message. No explanation, no markdown, no code fences.',
    userMessage: `Your previous response did not match the required schema.

Error: ${parseError}

Previous response:
"""
${rawAttempt}
"""

The required schema is:
{
  "hook": string,
  "body": string[],
  "cta": string (optional),
  "disclaimer": string (optional)
}

Return ONLY the corrected JSON object.`,
  };
}

function buildSchemaShape(roles: ScriptRoleRequirement[]): string {
  const lines: string[] = ['{'];
  for (const r of roles) {
    const optional = r.required ? '' : ' (optional)';
    if (r.role === 'body') {
      const range = r.bodyCount
        ? `array of ${r.bodyCount[0]}-${r.bodyCount[1]} strings`
        : 'array of strings';
      lines.push(`  "body": ${range}${optional},`);
    } else if (r.role === 'list') {
      const count = r.listCount ?? 1;
      lines.push(`  "lists": array of ${count} arrays-of-strings${optional},`);
    } else {
      lines.push(`  "${r.role}": string${optional},`);
    }
  }
  const last = lines.pop();
  if (last) lines.push(last.replace(/,$/, ''));
  lines.push('}');
  return lines.join('\n');
}
