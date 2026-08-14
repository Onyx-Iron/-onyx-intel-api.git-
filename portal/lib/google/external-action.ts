export function requiresExplicitConfirmation(value: unknown): boolean {
  return value !== true;
}

export function hasHeaderInjection(value: string): boolean {
  return /[\r\n]/.test(value);
}

export function isValidEmailList(value: string): boolean {
  if (!value || value.length > 1000 || hasHeaderInjection(value)) return false;
  return value.split(",").every((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.trim()));
}
