export * from './graphics-eligibility.js';
/**
 * @borradh-workspace/features/monthly-content-plan
 *
 * The unified monthly topic planner + cross-modal dispatcher.
 *
 * Pipeline:
 *
 *   runMonthlyBatchesCron
 *       │
 *       ▼
 *   planMonthlyContent (one Claude call → MonthlyContentPlan)
 *       │   { 4 video + 4 carousel + 4 single items, each with
 *       │     targetServiceId + topicSummary + rationale }
 *       ▼
 *   dispatchMonthlyPlan
 *       ├── kind=video    → planVideoDetail  (videos feature)
 *       └── kind=carousel │
 *           kind=single   → planImageDetail (image-generation feature)
 *
 * See `docs/plans/image-generation-nano-banana.md` §"Unified topic planner
 * contract" / §"Cross-modal planner contract" for the design rationale.
 */

export * from './services/index.js';
