import { defineCoverage } from '../coverage.types.js';

/**
 * WEBSITE-ANALYSIS — 7 endpoints, 0 tools. Scrapes a business's own website
 * and extracts a first pass at its brand, tone and service list.
 *
 * There IS a capability hiding here, and it is an onboarding one. The single
 * hardest moment in setup is the blank service catalogue: an owner who has to
 * type twenty treatments and prices before the product does anything for them
 * frequently does not. This is the route that turns "what's your website?"
 * into a populated draft, and Claire now runs onboarding conversationally —
 * which is exactly where that question belongs. It is parked `undecided`
 * rather than exposed because the extraction is a suggestion, not a fact, and
 * exposing it needs a story about how she presents it for confirmation instead
 * of silently creating services from a scraper's guesses.
 *
 * The rest of the area is the async plumbing around that one act, plus two
 * routes that exist to dump the raw scrape for engineers tuning the extractor.
 */
export const websiteAnalysisCoverage = defineCoverage('website-analysis', {
  // ---- the onboarding capability, and its poll ---------------------------
  'POST /website-analysis/analyze/start': {
    undecided: 'ENG-CLAIRE-WEBSITE-ANALYSIS',
  },
  'GET /website-analysis/analyze/:jobId': {
    undecided: 'ENG-CLAIRE-WEBSITE-ANALYSIS',
  },

  // ---- reviewing and committing a scan (ENG-659) -------------------------
  // `preview` is the answer to the objection parked above: it diffs a finished
  // scan against the account and writes nothing, which is precisely the
  // "present it for confirmation" step the exposure story was missing. It is
  // undecided rather than exposed only because it is half of a pair, and
  // exposing the read without the write would let Claire describe a change she
  // cannot make.
  'POST /website-analysis/preview': {
    undecided: 'ENG-CLAIRE-WEBSITE-ANALYSIS',
  },

  'POST /website-analysis/apply': {
    notExposed:
      "Commits a scrape into the live catalogue — creating services and packages, repricing existing ones, rewriting the public booking-page description and opening hours, and in `replace` mode switching off everything the scan did not find. The inputs are a model's reading of a web page, so a misread price or a missed treatment lands directly on what customers are charged and what they can book. This is the one act in the area that needs a human looking at the diff and pressing the button, and that diff already exists as `preview`.",
  },

  'POST /website-analysis/analyze': {
    notExposed:
      'The synchronous variant, which holds the request open for the whole fetch-and-extract. A real site regularly takes long enough to hit the gateway timeout, so the start-plus-poll pair is the path any tool here should use — two routes to one act is how a model picks the one that times out.',
  },

  // ---- extractor debugging -----------------------------------------------
  'POST /website-analysis/debug-content': {
    notExposed:
      'Dumps the raw scraped page text without extraction, so an engineer can see what the model was actually given when a result looks wrong. It returns an entire website as a string — enormous, unstructured, and nothing an owner asked about.',
  },
  'GET /website-analysis/debug-content/:jobId': {
    notExposed:
      'Polls for that raw-content dump. Same payload problem, and it exists purely to shorten the loop when tuning the extraction prompt.',
  },
});
