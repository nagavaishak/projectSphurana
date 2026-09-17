const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const REPLACEMENTS: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LS]: '\\u2028',
  [PS]: '\\u2029',
};

const PATTERN = new RegExp(`[<>&${LS}${PS}]`, 'g');

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value).replace(PATTERN, (ch) => REPLACEMENTS[ch] ?? ch);
}
