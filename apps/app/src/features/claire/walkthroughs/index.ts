/**
 * Tour definitions for Claire's in-product walkthroughs.
 *
 * The original `create_ad` / `create_video` / `create_offer` / `create_post`
 * tours were removed when chat became the only entry into creation flows —
 * Claire now drives those actions via tools (see `apps/api/src/assistant/
 * tools`) rather than walking the owner through a wizard.
 *
 * Future onboarding / discovery tours (e.g. settings tour, integrations tour)
 * should register here and in `ClaireWalkthroughProvider`'s handlers map.
 */
export {};
