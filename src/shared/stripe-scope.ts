export interface StripeMetadataFilter {
  stripe_metadata_key: string | null;
  stripe_metadata_value: string | null;
}

/** Validate a complete rule without normalizing its case-sensitive metadata values. */
export function parseStripeMetadataFilter(key: unknown, value: unknown): StripeMetadataFilter | null {
  if ((key === null || key === '') && (value === null || value === '')) {
    return { stripe_metadata_key: null, stripe_metadata_value: null };
  }
  if (typeof key !== 'string' || typeof value !== 'string' ||
      !key.trim() || key.length > 40 || /[\[\]]/.test(key) || !value.trim() || value.length > 500) return null;
  return { stripe_metadata_key: key, stripe_metadata_value: value };
}

/** Revenue ownership needs explicit provider metadata, never inferred visitor identity. */
export function matchesStripeMetadata(metadata: unknown, key: string | null, value: string | null): boolean {
  if (key === null && value === null) return true;
  if (!key || value === null || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return Object.hasOwn(metadata, key) && Reflect.get(metadata, key) === value;
}
