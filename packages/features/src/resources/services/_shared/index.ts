export {
  RESOURCE_CATEGORY_NAME_CONSTRAINT,
  isCategoryNameConflict,
  pluralize,
  resourceCapacitySchema,
  resourceColorSchema,
  resourceDescriptionSchema,
  resourceNameSchema,
  resourceSpecsSchema,
  resourceWorkingHoursSchema,
  sortOrderSchema,
  turnaroundMinutesSchema,
} from './resource-fields.js';

// Declared in `@borradh-workspace/labels` — a leaf package safe to bundle in
// the browser. See the note there.
export { MAX_RESOURCE_CATEGORIES } from '@borradh-workspace/labels';
