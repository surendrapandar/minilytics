import { describe, expect, it } from 'vitest';
import type { Site } from '../src/worker/env';
import { stripePaymentIsElsewhere } from '../src/worker/payments';

/** Just enough of D1 for the two lookups: visitors by id, Stripe payments by customer. */
function fakeDb(visitors: Record<string, string[]>, customers: Record<string, string[]>) {
  return {
    prepare(sql: string) {
      return {
        bind(id: string) {
          return {
            async all() {
              const sites = (sql.includes('FROM visitors') ? visitors[id] : customers[id]) ?? [];
              return { results: sites.map((site_id) => ({ site_id })) };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const site = { id: 'siteA' } as Site;

describe('Stripe payments shared by several sites', () => {
  const db = fakeDb({ vA: ['siteA'], vB: ['siteB'], vAB: ['siteA', 'siteB'] }, { cusA: ['siteA'], cusB: ['siteB'] });

  it('follows an explicit ml_site_id tag', async () => {
    expect(await stripePaymentIsElsewhere(db, site, { taggedSite: 'siteA', visitorId: 'vB' })).toBe(false);
    expect(await stripePaymentIsElsewhere(db, site, { taggedSite: 'siteB', visitorId: 'vA' })).toBe(true);
  });
  it("skips a buyer who was only seen on another site", async () => {
    expect(await stripePaymentIsElsewhere(db, site, { visitorId: 'vA' })).toBe(false);
    expect(await stripePaymentIsElsewhere(db, site, { visitorId: 'vB' })).toBe(true);
    expect(await stripePaymentIsElsewhere(db, site, { visitorId: 'vAB' })).toBe(false);
  });
  it('places renewals by where the customer paid before', async () => {
    expect(await stripePaymentIsElsewhere(db, site, { customerId: 'cusA' })).toBe(false);
    expect(await stripePaymentIsElsewhere(db, site, { customerId: 'cusB' })).toBe(true);
  });
  it('records the payment when nothing points elsewhere (single-site setups are unchanged)', async () => {
    expect(await stripePaymentIsElsewhere(db, site, {})).toBe(false);
    expect(await stripePaymentIsElsewhere(db, site, { visitorId: 'unknown', customerId: 'cusNew' })).toBe(false);
    expect(await stripePaymentIsElsewhere(db, site, { visitorId: 'unknown', customerId: 'cusB' })).toBe(true);
  });
});
