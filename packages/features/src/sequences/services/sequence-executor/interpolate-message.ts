import type { LeadData } from './types.js';

/**
 * Interpolate template variables in a message
 * Supports: {{firstName}}, {{lastName}}, {{email}}, {{phone}}, and any lead field
 */
export function interpolateMessage(
  template: string,
  leadData: LeadData
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = leadData[key];
    return value !== undefined && value !== null ? String(value) : '';
  });
}
