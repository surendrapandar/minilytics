// Synthetic local bot traffic for the ShipKit demo. Apply with --local only.
import { mkdirSync, writeFileSync } from 'node:fs';
const now = Date.now();
const day = 86400000;
const bots = [
  ['ChatGPT-User', 'AI assistant', 15], ['Claude-User', 'AI assistant', 4],
  ['Perplexity-User', 'AI assistant', 2], ['Googlebot', 'Search engine', 12],
  ['OAI-SearchBot', 'AI search', 8], ['Claude-SearchBot', 'AI search', 3],
  ['GPTBot', 'AI training', 17], ['ClaudeBot', 'AI training', 6],
];
const paths = ['/', '/pricing', '/docs', '/blog/seo-for-saas'];
const sql = ["DELETE FROM bot_requests WHERE site_id = 'demo0001';"];
for (let d = 29; d >= 0; d--) {
  bots.forEach(([bot, category, base], b) => {
    const count = Math.max(0, Math.round(base * (0.5 + (Math.sin(d * 1.7 + b) + 1) / 2) + (d === 14 && b === 0 ? 24 : 0)));
    for (let i = 0; i < count; i++) {
      const ts = now - d * day - (i + 1) * 60000;
      sql.push(`INSERT INTO bot_requests (site_id, ts, bot, category, hostname, path) SELECT id, ${ts}, '${bot}', '${category}', 'shipkit.dev', '${paths[(i + b) % paths.length]}' FROM sites WHERE id = 'demo0001' AND domain = 'shipkit.dev';`);
    }
  });
}
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed-bots.sql', sql.join('\n'));
console.log(`Generated ${sql.length - 1} synthetic bot requests for local ShipKit demo.`);
