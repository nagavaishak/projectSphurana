// @borradh-workspace/features
// Domain business logic organized by feature

// Re-export shared utilities
export * from './shared/index.js';

// Re-export all features
// Note: Each feature should also be importable via its own entry point:
// - @borradh-workspace/features/users
// - @borradh-workspace/features/auth
// - @borradh-workspace/features/payments
// - @borradh-workspace/features/organizations
// - @borradh-workspace/features/training-hub
// - @borradh-workspace/features/integrations
// - @borradh-workspace/features/content-styles

// Content styles (brand templates for videos/graphics)
export * from './content-styles/index.js';

// Social posts (content calendar and social media publishing)
export * from './social-posts/index.js';

// Content batches (monthly bulk organic graphics + videos with review flow)
export * from './content-items/index.js';
export * from './content-batches/index.js';
export * from './content-provenance/index.js';

// Recommendations (AI recommendations for Meta Ads)
export * from './recommendations/index.js';

// Claire — vertical config registry + recommendation engine
export * from './claire/index.js';
export * from './onboarding/index.js';
