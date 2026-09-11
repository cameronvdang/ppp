/** Small field readers at the untrusted records boundary. Never copy raw objects. */
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
export function string(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value : null }
export function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
export function date(value: unknown): string | null {
  const s = string(value)
  return s && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) && Number.isFinite(Date.parse(s)) ? s : null
}
export function displayValue(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === 'number') return number(value)
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? null } catch { return null }
}
export function extraArrayItems(value: unknown): number {
  if (Array.isArray(value)) return value.length
  return Object.values(object(value)).reduce<number>((n, v) => n + extraArrayItems(v), 0)
}
