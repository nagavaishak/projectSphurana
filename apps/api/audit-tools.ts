import { adsTools } from './src/assistant/tools/ads/index.js';
import { appointmentsTools } from './src/assistant/tools/appointments/index.js';
import { contextTools } from './src/assistant/tools/context/index.js';
import { customerConversationsTools } from './src/assistant/tools/customer-conversations/index.js';
import { leadsTools } from './src/assistant/tools/leads/index.js';
import { metaTools } from './src/assistant/tools/meta/index.js';
import { offersTools } from './src/assistant/tools/offers/index.js';
import { orgDefaultsTools } from './src/assistant/tools/org-defaults/index.js';
import { videosTools } from './src/assistant/tools/videos/index.js';

const all = [
  ...adsTools,
  ...videosTools,
  ...contextTools,
  ...leadsTools,
  ...appointmentsTools,
  ...offersTools,
  ...customerConversationsTools,
  ...orgDefaultsTools,
  ...metaTools,
];

let bad = 0;
for (const tool of all) {
  const def = tool.toAnthropicDefinition();
  const schema = def.input_schema as Record<string, unknown>;
  // Anthropic requires type:object at the top + no top-level oneOf/anyOf/allOf
  const hasTopLevelUnion =
    'oneOf' in schema || 'anyOf' in schema || 'allOf' in schema;
  if (schema.type !== 'object' || hasTopLevelUnion) {
    bad++;
    console.log(
      `❌ ${def.name}: type=${schema.type} topLevelUnion=${hasTopLevelUnion}`
    );
  }
}
console.log(
  bad === 0
    ? `✓ All ${all.length} tools have Anthropic-acceptable input_schema (type:object, no top-level oneOf/anyOf/allOf)`
    : `❌ ${bad} bad tool(s)`
);
