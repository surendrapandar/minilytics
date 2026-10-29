// Fills the LOCAL database with 30 days of fake traffic so you can see the dashboard.
// Usage: node scripts/seed-demo.mjs && npx wrangler d1 execute minilytics --local --file .wrangler/seed.sql
import { mkdirSync, writeFileSync } from 'node:fs';

const DAY = 86_400_000;
const now = Date.now();
const siteId = 'demo0001';
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, () => Math.floor(rand() * 16).toString(16));

const SOURCES = [
  [{ source: 'X', channel: 'Organic Social', referrer: 't.co', domain: 't.co' }, 28],
  [{ source: 'Direct/None', channel: 'Direct', referrer: null, domain: null }, 22],
  [{ source: 'Google', channel: 'Organic Search', referrer: 'www.google.com', domain: 'google.com' }, 14],
  [{ source: 'Indie Hackers', channel: 'Referral', referrer: 'www.indiehackers.com', domain: 'indiehackers.com' }, 9],
  [{ source: 'Reddit', channel: 'Organic Social', referrer: 'www.reddit.com/r/SaaS', domain: 'reddit.com' }, 6],
  [{ source: 'YouTube', channel: 'Organic Social', referrer: 'www.youtube.com', domain: 'youtube.com' }, 4],
  [{ source: 'ChatGPT', channel: 'AI', referrer: 'chatgpt.com', domain: 'chatgpt.com' }, 4],
  [{ source: 'LinkedIn', channel: 'Organic Social', referrer: 'www.linkedin.com', domain: 'linkedin.com' }, 3],
  [{ source: 'Medium', channel: 'Referral', referrer: 'medium.com/@you/how-i-built', domain: 'medium.com' }, 3],
  [{ source: 'Product Hunt', channel: 'Referral', referrer: 'www.producthunt.com', domain: 'producthunt.com' }, 3],
  [{ source: 'Threads', channel: 'Organic Social', referrer: 'www.threads.net', domain: 'threads.net' }, 2],
  [{ source: 'Perplexity', channel: 'AI', referrer: 'www.perplexity.ai', domain: 'perplexity.ai' }, 1],
];
const CAMPAIGNS = { X: ['launch-tweet', 'build-in-public-thread', 'revenue-screenshot'], Medium: ['how-i-built-article'], LinkedIn: ['founder-post'] };
const PAGES = ['/', '/', '/', '/pricing', '/blog/seo-for-saas', '/blog/how-to-get-first-customers', '/features', '/docs', '/changelog', '/about'];
const COUNTRIES = [['US', 'California', 'San Francisco'], ['US', 'New York', 'New York'], ['GB', 'England', 'London'], ['IN', 'Karnataka', 'Bengaluru'], ['IN', 'Maharashtra', 'Mumbai'], ['DE', 'Berlin', 'Berlin'], ['FR', 'Île-de-France', 'Paris'], ['CA', 'Ontario', 'Toronto'], ['SG', 'Singapore', 'Singapore'], ['ES', 'Madrid', 'Madrid'], ['BR', 'São Paulo', 'São Paulo'], ['NL', 'North Holland', 'Amsterdam']];
const DEVICES = [[['Chrome', 'Mac OS', 'Desktop'], 40], [['Safari', 'Mac OS', 'Desktop'], 12], [['Mobile Safari', 'iOS', 'Mobile'], 18], [['Chrome', 'Windows', 'Desktop'], 14], [['Chrome', 'Android', 'Mobile'], 8], [['Firefox', 'Linux', 'Desktop'], 4], [['Edge', 'Windows', 'Desktop'], 3], [['Twitter', 'iOS', 'Mobile'], 3]];
const NAMES = ['Vlad Petrov', 'Jordan Lee', 'Ricardo Alves', 'Mia Schmidt', 'Jack Turner', 'Aisha Khan', 'Lucas Martin', 'Priya Sharma', 'Noah Kim', 'Emma Rossi', 'Ravi Patel', 'Sofia Garcia', 'Liam Chen', 'Chloe Dubois'];

const out = [];
out.push(`DELETE FROM events WHERE site_id = '${siteId}';`, `DELETE FROM sessions WHERE site_id = '${siteId}';`, `DELETE FROM visitors WHERE site_id = '${siteId}';`, `DELETE FROM payments WHERE site_id = '${siteId}';`, `DELETE FROM funnels WHERE site_id = '${siteId}';`, `DELETE FROM sites WHERE id = '${siteId}';`);
out.push(`INSERT INTO sites (id, name, domain, timezone, currency, api_key, created_at) VALUES ('${siteId}', 'ShipKit', 'shipkit.dev', 'UTC', 'USD', 'ml_demo_key', ${now - 60 * DAY});`);
out.push(`INSERT INTO funnels (id, site_id, name, steps, created_at) VALUES ('fun00001', '${siteId}', 'Landing → Checkout', ${q(JSON.stringify([{ type: 'page', value: '/' }, { type: 'page', value: '/pricing' }, { type: 'goal', value: 'checkout_click' }]))}, ${now});`);

let payN = 0;
for (let d = 34; d >= 0; d--) {
  const spike = d === 9 ? 3.2 : d === 24 ? 1.8 : 1;
  const sessionsToday = Math.round((120 + rand() * 90 + Math.sin(d / 2) * 40) * spike);
  for (let i = 0; i < sessionsToday; i++) {
    const start = now - d * DAY - Math.floor(rand() * DAY);
    if (start > now) continue;
    const src = weighted(SOURCES);
    const s = d === 9 && rand() < 0.6 ? SOURCES[0][0] : src;
    const vid = uuid(), sid = uuid();
    const [country, region, city] = pick(COUNTRIES);
    const [browser, os, device] = weighted(DEVICES);
    const camp = CAMPAIGNS[s.source] && rand() < 0.7 ? pick(CAMPAIGNS[s.source]) : null;
    const entry = s.source === 'Google' ? pick(['/blog/seo-for-saas', '/blog/how-to-get-first-customers', '/']) : s.source === 'Medium' ? '/blog/how-to-get-first-customers' : pick(PAGES.slice(0, 5));
    const bounce = rand() < 0.62;
    const pages = [entry];
    if (!bounce) for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) pages.push(pick(PAGES));
    const wantsToBuy = !bounce && rand() < (s.channel === 'Direct' ? 0.05 : s.source === 'X' ? 0.045 : 0.03);
    if (wantsToBuy && !pages.includes('/pricing')) pages.push('/pricing');
    const duration = bounce ? Math.floor(rand() * 25_000) : Math.floor(20_000 + rand() * 300_000);
    let t = start;
    const events = pages.map((p) => {
      const e = [t, 'pageview', null, p];
      t += Math.floor(duration / pages.length);
      return e;
    });
    if (!bounce && rand() < 0.25) events.push([t, 'goal', 'signup_click', pages.at(-1)]);
    if (wantsToBuy) events.push([t + 1000, 'goal', 'checkout_click', '/pricing'], [t + 2000, 'outbound', 'https://checkout.dodopayments.com/buy/pdt_pro', '/pricing']);
    else if (!bounce && rand() < 0.1) events.push([t, 'outbound', pick(['https://github.com/shipkit', 'https://x.com/shipkit', 'https://discord.gg/shipkit']), pages.at(-1)]);
    const goals = events.filter((e) => e[1] === 'goal').length;
    const last = Math.min(now, events.at(-1)[0] + 5000);

    const paid = wantsToBuy && rand() < 0.75;
    const name = paid ? pick(NAMES) : null;
    out.push(`INSERT INTO visitors (site_id, id, first_seen, name, email) VALUES ('${siteId}', '${vid}', ${start - (paid && rand() < 0.5 ? Math.floor(rand() * 10 * DAY) : 0)}, ${q(name)}, ${q(name ? name.toLowerCase().replace(' ', '.') + '@example.com' : null)});`);
    out.push(
      `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals, hostname, entry_page, exit_page, referrer, referrer_domain, source, channel, utm_source, utm_medium, utm_campaign, utm_term, utm_content, ref, country, region, city, browser, os, device) VALUES ('${siteId}', '${sid}', '${vid}', ${start}, ${last}, ${duration}, ${pages.length}, ${goals}, 'shipkit.dev', ${q(entry)}, ${q(pages.at(-1))}, ${q(s.referrer)}, ${q(s.domain)}, ${q(s.source)}, ${q(s.channel)}, ${q(camp ? s.source.toLowerCase() : null)}, ${q(camp ? 'social' : null)}, ${q(camp)}, NULL, NULL, NULL, '${country}', ${q(region)}, ${q(city)}, '${browser}', '${os}', '${device}');`,
    );
    for (const [ts, type, n, p] of events) out.push(`INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES ('${siteId}', '${sid}', '${vid}', ${ts}, '${type}', ${q(n)}, ${q(p)});`);
    if (paid) {
      const amount = pick([4900, 9900, 9900, 16900, 29900]);
      out.push(`INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name) VALUES ('pay_demo_${++payN}', '${siteId}', 'dodo', ${t + 60_000 > now ? now - 1000 : t + 60_000}, ${amount}, 'payment', 'USD', '${vid}', '${sid}', 'cus_${payN}', ${q(name.toLowerCase().replace(' ', '.') + '@example.com')}, ${q(name)});`);
    }
  }
}
// A few people online right now, with locations for the live globe
const LIVE = [
  ['US', 'San Francisco', 37.77, -122.42, 'X', 't.co', 'Organic Social', '/pricing'],
  ['US', 'New York', 40.71, -74.01, 'Google', 'google.com', 'Organic Search', '/blog/seo-for-saas'],
  ['GB', 'London', 51.51, -0.13, 'ChatGPT', 'chatgpt.com', 'AI', '/'],
  ['IN', 'Bengaluru', 12.97, 77.59, 'Direct/None', null, 'Direct', '/features'],
  ['NL', 'Amsterdam', 52.37, 4.9, 'Reddit', 'reddit.com', 'Organic Social', '/'],
];
LIVE.forEach(([cc, city, lat, lon, source, domain, channel, page], i) => {
  const vid = uuid(), sid = uuid();
  const start = now - (i + 1) * 70_000;
  out.push(`INSERT INTO visitors (site_id, id, first_seen) VALUES ('${siteId}', '${vid}', ${start});`);
  out.push(`INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals, hostname, entry_page, exit_page, referrer_domain, source, channel, country, city, browser, os, device, lat, lon) VALUES ('${siteId}', '${sid}', '${vid}', ${start}, ${now - 15_000}, 60000, 2, ${i === 0 ? 1 : 0}, 'shipkit.dev', '/', ${q(page)}, ${q(domain)}, ${q(source)}, ${q(channel)}, '${cc}', ${q(city)}, 'Chrome', 'Mac OS', '${i === 3 ? 'Mobile' : 'Desktop'}', ${lat}, ${lon});`);
  out.push(`INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES ('${siteId}', '${sid}', '${vid}', ${start}, 'pageview', NULL, '/');`);
  out.push(`INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES ('${siteId}', '${sid}', '${vid}', ${start + 30_000}, 'pageview', NULL, ${q(page)});`);
  if (i === 0) {
    out.push(`INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES ('${siteId}', '${sid}', '${vid}', ${start + 50_000}, 'goal', 'checkout_click', '/pricing');`);
    out.push(`INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name) VALUES ('pay_demo_live', '${siteId}', 'dodo', ${start + 60_000}, 9900, 'payment', 'USD', '${vid}', '${sid}', 'cus_live', 'socianova@example.com', 'SociaNova');`);
  }
});

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed.sql', out.join('\n'));
console.log(`Wrote .wrangler/seed.sql (${out.length} statements, ${payN} payments)`);
