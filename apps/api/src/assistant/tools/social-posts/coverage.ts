import { defineCoverage } from '../coverage.types.js';

/**
 * SOCIAL-POSTS — 9 endpoints, 8 tools. Organic posts to the org's connected
 * Facebook and Instagram pages. The most fully covered area Claire has, because
 * the whole lifecycle is genuinely hers: draft it, write the caption, pick a
 * time, publish it.
 *
 * The line here is PUBLICATION, not persistence. A draft costs nothing and can
 * be edited or thrown away; the moment it reaches Meta it is visible to the
 * owner's customers and cannot be taken back cleanly. So the three tools that
 * cross that line — `publishPostNow`, `schedulePost`, and
 * `deleteSocialPostDraft` — are all `destructive: true` and ask first, while
 * drafting and editing do not.
 *
 * `social_posts_schedulePost` and `social_posts_publishPostNow` both drive
 * `POST /social-posts/:id/publish` (scheduling is a publish with a future
 * `scheduledFor`); the endpoint is declared once, under the immediate one.
 * `social_posts_generatePostCaption` belongs to this feature but calls
 * `ai-content/generate`, which lives in another area's ledger.
 */
export const socialPostsCoverage = defineCoverage('social-posts', {
  // ---- reads -------------------------------------------------------------
  'GET /social-posts': { exposed: 'social_posts_listRecentPosts' },
  'GET /social-posts/suggest-timing': {
    exposed: 'social_posts_suggestPostingTime',
  },

  'GET /social-posts/:id': {
    notExposed:
      'No single-post read tool exists. social_posts_listRecentPosts returns the full row, so Claire reaches a post by listing it; the publish and schedule tools re-read one by id internally to check its state before acting, which is a precondition of those writes rather than a capability of its own.',
  },
  'GET /social-posts/:id/engagement': {
    undecided: 'ENG-CLAIRE-SOCIAL-POSTS',
  },

  // ---- writes: drafting (nothing is public yet) --------------------------
  'POST /social-posts': {
    exposed: 'social_posts_createSocialPostDraft',
    confirm: false,
  },
  'PUT /social-posts/:id': {
    exposed: 'social_posts_updateSocialPostDraft',
    confirm: false,
  },

  // ---- writes: publication ------------------------------------------------
  'POST /social-posts/:id/publish': {
    exposed: 'social_posts_publishPostNow',
    confirm: true,
  },
  'DELETE /social-posts/:id': {
    exposed: 'social_posts_deleteSocialPostDraft',
    confirm: true,
  },

  'POST /social-posts/sync': {
    notExposed:
      "Pulls the org's post history back from the Meta Graph API and reconciles it against local rows. A long, rate-limited backfill whose only visible output is that a list looks different afterwards — and Meta's per-page limits mean a model triggering it opportunistically can starve the scheduled sync that actually matters.",
  },
});
