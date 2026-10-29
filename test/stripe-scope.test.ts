import { describe, expect, it } from 'vitest';
import { matchesStripeMetadata, parseStripeMetadataFilter } from '../src/shared/stripe-scope';

describe('Stripe metadata revenue filter', () => {
  it('requires both filter fields and preserves exact values', () => {
    expect(parseStripeMetadataFilter(null, null)).toEqual({ stripe_metadata_key: null, stripe_metadata_value: null });
    expect(parseStripeMetadataFilter('', '')).toEqual({ stripe_metadata_key: null, stripe_metadata_value: null });
    expect(parseStripeMetadataFilter('product', '')).toBeNull();
    expect(parseStripeMetadataFilter(undefined, 'alpha')).toBeNull();
    expect(parseStripeMetadataFilter('product', ' Alpha ')).toEqual({ stripe_metadata_key: 'product', stripe_metadata_value: ' Alpha ' });
  });

  it('enforces Stripe metadata limits and rejects nonstrings', () => {
    expect(parseStripeMetadataFilter('x'.repeat(40), 'y'.repeat(500))).not.toBeNull();
    for (const [key, value] of [['x'.repeat(41), 'ok'], ['key', 'y'.repeat(501)], ['nested[key]', 'ok'], [' ', 'ok'], ['key', ' '], ['key', 1], [{}, 'value']]) {
      expect(parseStripeMetadataFilter(key, value)).toBeNull();
    }
  });

  it('does not infer ownership from identity or coerce case and value types', () => {
    expect(matchesStripeMetadata({ product: 'alpha', ml_visitor_id: 'visitor' }, 'product', 'alpha')).toBe(true);
    for (const metadata of [undefined, null, [], { product: 'Alpha' }, { product: 1 }, { ml_visitor_id: 'visitor' }, Object.create({ product: 'alpha' })]) {
      expect(matchesStripeMetadata(metadata, 'product', 'alpha')).toBe(false);
    }
    expect(matchesStripeMetadata({ product: 'alpha' }, 'Product', 'alpha')).toBe(false);
    expect(matchesStripeMetadata({}, 'product', null)).toBe(false);
    expect(matchesStripeMetadata({}, null, 'alpha')).toBe(false);
    expect(matchesStripeMetadata(undefined, null, null)).toBe(true);
  });
});
