export const POLAR_API_VERSION = '2026-10';

export function polarId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function polarCheckoutId(value: unknown): string | null {
  const id = polarId(value);
  return id && `polar:checkout:${id}`;
}
