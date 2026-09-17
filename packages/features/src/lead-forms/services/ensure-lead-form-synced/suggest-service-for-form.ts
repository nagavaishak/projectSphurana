export interface ServiceCandidate {
  id: string;
  name: string;
}

export interface SuggestServiceResult {
  serviceId: string;
  score: number;
}

// Generic words common to form names/services that shouldn't drive a match.
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'your',
  'our',
  'with',
  'session',
  'sessions',
  'treatment',
  'treatments',
  'book',
  'booking',
  'new',
  'client',
  'clients',
  'form',
  'lead',
  'offer',
  'intro',
  'consultation',
  'appointment',
  'free',
  'min',
  'minute',
  'minutes',
]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Suggest the organization service a lead form is about, by comparing the
 * form's text (name + question labels/keys) against each service name.
 *
 * Confidence-gated so a generic form ("What's your main wellness goal?") with
 * no clear service reference returns null rather than a wrong guess.
 *
 * Scoring:
 *  - 1.0 when the full service name appears verbatim in the form text.
 *  - otherwise the fraction of the service-name's meaningful tokens present in
 *    the form text.
 */
export function suggestServiceForForm(
  formText: string,
  services: ServiceCandidate[],
  threshold = 0.6
): SuggestServiceResult | null {
  const formNorm = formText.toLowerCase();
  const formTokens = new Set(tokenize(formText));

  let best: SuggestServiceResult | null = null;

  for (const svc of services) {
    const nameNorm = svc.name.toLowerCase().trim();
    let score = 0;

    if (nameNorm.length >= 4 && formNorm.includes(nameNorm)) {
      score = 1;
    } else {
      const svcTokens = tokenize(svc.name);
      if (svcTokens.length === 0) continue;
      const matched = svcTokens.filter((t) => formTokens.has(t)).length;
      score = matched / svcTokens.length;
    }

    if (!best || score > best.score) {
      best = { serviceId: svc.id, score };
    }
  }

  if (!best || best.score < threshold) return null;
  return best;
}
