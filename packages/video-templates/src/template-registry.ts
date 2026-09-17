// Organic templates (ported from v1 to the renderdoc method).
import { aestheticLine1 } from './aesthetic-line-1.js';
import { authority1 } from './authority-1.js';
import { authority2 } from './authority-2.js';
import { authority3 } from './authority-3.js';
import { beforeAfter1 } from './before-after-1.js';
import { beforeAfter2 } from './before-after-2.js';
import { beforeAfter3 } from './before-after-3.js';
import { captionTease1 } from './caption-tease-1.js';
import { curiosityHook1 } from './curiosity-hook-1.js';
import { educational1 } from './educational-1.js';
import { educational2 } from './educational-2.js';
import { educational3 } from './educational-3.js';
import { fadeBenefits1 } from './fade-benefits-1.js';
import { highlightCaption1 } from './highlight-caption-1.js';
import { improves1 } from './improves-1.js';
import { insOuts1 } from './ins-outs-1.js';
import { numberedList1 } from './numbered-list-1.js';
import { offerSquare1 } from './offer-square-1.js';
import { questionCta1 } from './question-cta-1.js';
import { stepTimer1 } from './step-timer-1.js';
import type { TemplateDoc } from './template-doc.js';
import { timeProgress1 } from './time-progress-1.js';

export const BUILT_IN_TEMPLATES: TemplateDoc[] = [
  educational1,
  educational2,
  educational3,
  authority1,
  authority2,
  authority3,
  beforeAfter1,
  beforeAfter2,
  beforeAfter3,
  offerSquare1,
  // Organic formats.
  captionTease1,
  fadeBenefits1,
  aestheticLine1,
  numberedList1,
  insOuts1,
  questionCta1,
  improves1,
  highlightCaption1,
  curiosityHook1,
  stepTimer1,
  timeProgress1,
];

const registry = new Map<string, TemplateDoc>(
  BUILT_IN_TEMPLATES.map((t) => [t.id, t])
);

export function getTemplateDocById(id: string): TemplateDoc | undefined {
  return registry.get(id);
}
