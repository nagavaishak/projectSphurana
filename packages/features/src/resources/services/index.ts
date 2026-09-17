// The category cap — public so the UI can stop offering an action the API
// will refuse. The rest of `_shared` stays internal.
export { MAX_RESOURCE_CATEGORIES } from './_shared/index.js';
export * from './create-resource-category/index.js';
export * from './update-resource-category/index.js';
export * from './delete-resource-category/index.js';
export * from './list-resource-categories/index.js';
export * from './create-resource/index.js';
export * from './update-resource/index.js';
export * from './delete-resource/index.js';
export * from './list-resources/index.js';
export * from './reorder-resources/index.js';
export * from './get-service-resource-requirements/index.js';
export * from './set-service-resource-requirements/index.js';
export * from './seed-default-resource-categories/index.js';
export * from './list-appointment-resources/index.js';
export * from './get-resource-utilisation/index.js';
export * from './reassign-appointment-resource/index.js';
