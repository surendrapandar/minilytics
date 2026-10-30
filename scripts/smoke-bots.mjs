// Local-only integration test. Requires wrangler dev and migration 0008.
import assert from 'node:assert/strict';
const base = process.env.BASE ?? 'http://localhost:8787';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Use a local test server');
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD ?? 'change-me' }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(res.status, 200, path);
  return res.json();
};
const site = await call('/api/sites', 'POST', { domain: 'bot-smoke.example', name: 'Bot smoke' });
const other = await call('/api/sites', 'POST', { domain: 'other-smoke.example', name: 'Other smoke' });
const report = (body, key = site.api_key) => fetch(base + '/api/v1/bots', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  assert.equal((await fetch(base + '/api/sites/' + site.id + '/bots')).status, 401);
  assert.equal((await report({ url: 'https://bot-smoke.example/', user_agent: 'GPTBot' }, 'bad')).status, 401);
  assert.equal((await report(null)).status, 400);
  assert.equal((await report({ url: 'https://notbot-smoke.example/', user_agent: 'GPTBot' })).status, 403);
  assert.equal((await report({ url: 'ftp://bot-smoke.example/', user_agent: 'GPTBot' })).status, 403);
  assert.equal((await report({ url: 'https://bot-smoke.example/', user_agent: 'x'.repeat(5000) })).status, 413);
  for (const user_agent of ['GPTBot/1.0', 'GPTBot/1.0', 'Googlebot/2.1', 'ChatGPT-User/1.0']) {
    assert.equal((await report({ url: 'https://bot-smoke.example/pricing/?email=private@example.com', user_agent })).status, 202);
  }
  assert.equal((await report({ url: 'https://bot-smoke.example/', user_agent: 'Mozilla/5.0 Chrome/129.0 Safari/537.36' })).status, 202);
  const stats = await call(`/api/sites/${site.id}/bots?period=today`);
  assert.equal(stats.total.requests, 4);
  assert.equal(stats.total.bots, 3);
  assert.deepEqual(stats.pages, [{ path: '/pricing', requests: 4 }]);
  assert.equal(stats.bots.find(x => x.bot === 'GPTBot').requests, 2);
  assert.equal(stats.recent.length, 4);
  assert.equal(stats.traffic.reduce((n, r) => n + r.requests, 0), 4);
  assert.equal(stats.pageBots.reduce((n, r) => n + r.requests, 0), 4);
  assert.ok(stats.traffic.every(r => stats.labels.includes(r.bucket)));
  assert.ok(stats.labels.includes(new Date(Date.now()).toISOString().slice(0, 13) + ':00'));
  assert.equal(stats.traffic.find(r => r.bot === 'GPTBot').requests, 2);
  assert.equal((await call(`/api/sites/${other.id}/bots?period=today`)).total.requests, 0);
  assert.equal((await call(`/api/sites/${site.id}/bots?period=yesterday`)).total.requests, 0);
  assert.equal(stats.pageTraffic.reduce((n, r) => n + r.requests, 0), 4);
  const filtered = await call(`/api/sites/${site.id}/bots?period=today&bot_names=${encodeURIComponent(JSON.stringify(['GPTBot']))}&page_paths=${encodeURIComponent(JSON.stringify(['/pricing']))}&bot_group=training`);
  assert.equal(filtered.total.requests, 2);
  assert.equal(filtered.traffic.length, 1);
  assert.equal(filtered.pageTraffic[0].requests, 2);
  const none = await call(`/api/sites/${site.id}/bots?period=today&bot_names=[]`);
  assert.equal(none.total.requests, 0);
  const answers = await call(`/api/sites/${site.id}/bots?period=today&bot_group=answers`);
  assert.equal(answers.total.requests, 1);
  const missingPath = await call(`/api/sites/${site.id}/bots?period=today&page_paths=${encodeURIComponent(JSON.stringify(['/no-such-page']))}`);
  assert.equal(missingPath.total.requests, 0);
  assert.equal((await fetch(base + `/api/sites/${site.id}/bots?bot_names=broken`, { headers: { cookie } })).status, 400);
  assert.equal((await fetch(base + `/api/sites/${site.id}/bots?bot_group=constructor`, { headers: { cookie } })).status, 400);
  assert.equal((await fetch(base + `/api/sites/${site.id}/bots?page_paths={}`, { headers: { cookie } })).status, 400);
  const largeFilters = await call(`/api/sites/${site.id}/bots?period=today&bot_names=${encodeURIComponent(JSON.stringify(['GPTBot', ...Array.from({ length: 99 }, (_, i) => 'bot' + i)]))}&page_paths=${encodeURIComponent(JSON.stringify(['/pricing', ...Array.from({ length: 99 }, (_, i) => '/page' + i)]))}`);
  assert.equal(largeFilters.total.requests, 2);
  assert.equal((await report({ url: 'https://app.bot-smoke.example/pricing', user_agent: 'GPTBot/1.0' })).status, 202);
  const crossHost = await call(`/api/sites/${site.id}/bots?period=today`);
  assert.deepEqual(crossHost.pages, [{ path: '/pricing', requests: 5 }]);
  assert.equal(crossHost.pageTraffic.reduce((n, r) => n + r.requests, 0), 5);
  const humanBot = await fetch(base + '/api/event', { method: 'POST', headers: { 'user-agent': 'Claude-User/1.0' }, body: JSON.stringify({ w: site.id, u: 'https://bot-smoke.example/', t: 'pageview', vid: 'claude-visitor', sid: 'claude-session' }) });
  assert.equal(humanBot.status, 202);
  const human = await call(`/api/sites/${site.id}/overview?period=today`);
  assert.equal(human.current.visitors, 0);
  assert.equal(human.current.pageviews, 0);
  assert.equal(human.current.revenue, 0);
  await call(`/api/sites/${site.id}/rotate-key`, 'POST');
  assert.equal((await report({ url: 'https://bot-smoke.example/', user_agent: 'GPTBot' })).status, 401);
  console.log('Bot smoke passed: auth, validation, rotation, date ranges, aggregation, site isolation, privacy and human-metric separation.');
} finally {
  await call(`/api/sites/${site.id}`, 'DELETE');
  await call(`/api/sites/${other.id}`, 'DELETE');
}
