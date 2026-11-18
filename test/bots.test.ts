import { createHash } from 'node:crypto';
import { createSignature, webcrypto } from 'http-message-sig';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_BOT_HINT, BOT_HINT, identifyBot, isAiCategory, signerHost } from '../src/shared/bots';
import { aggregateHits, directIp, hitTime, type BotHit } from '../src/worker/bots';
import { parseIpList, resetBotVerification, verifyAgentSignature, verifyBot, verifyIp } from '../src/worker/lib/botVerify';
import { inRanges, parseIp, parseRange } from '../src/worker/lib/ip';
import { isBot } from '../src/worker/lib/ua';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// [user agent, expected name, expected category]
const BOTS: [string, string, string][] = [
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'GPTBot', 'AI training'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot', 'OAI-SearchBot', 'AI search'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'ChatGPT-User', 'AI assistant'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot', 'AI training'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)', 'Claude-SearchBot', 'AI search'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'Claude-User', 'AI assistant'],
  [`${CHROME} Claude-Agent/1.0`, 'Claude-Agent', 'AI agent'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'PerplexityBot', 'AI search'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', 'Perplexity-User', 'AI assistant'],
  [`${CHROME} Google-Agent`, 'Google-Agent', 'AI agent'],
  ['Mozilla/5.0 (compatible; Google-NotebookLM)', 'Google NotebookLM', 'AI assistant'],
  ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'Meta-ExternalAgent', 'AI training'],
  ['meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)', 'Meta-ExternalFetcher', 'AI assistant'],
  ['Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', 'Bytespider', 'AI training'],
  ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'CCBot', 'AI training'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36', 'Amazonbot', 'AI training'],
  ['DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)', 'DuckAssistBot', 'AI search'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)', 'MistralAI-User', 'AI assistant'],
  ['Mozilla/5.0 (compatible; YouBot (+http://www.you.com))', 'YouBot', 'AI search'],
  ['Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0 Safari/537.36 (compatible; Diffbot/0.1; +http://www.diffbot.com)', 'Diffbot', 'AI training'],
  ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot', 'Search engine'],
  ['Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)', 'Google-InspectionTool', 'SEO'],
  ['AdsBot-Google (+http://www.google.com/adsbot.html)', 'Google AdsBot', 'Other'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36', 'Bingbot', 'Search engine'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)', 'Applebot', 'Search engine'],
  ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', 'YandexBot', 'Search engine'],
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'AhrefsBot', 'SEO'],
  ['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', 'SemrushBot', 'SEO'],
  ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Facebook preview', 'Social preview'],
  ['Twitterbot/1.0', 'Twitterbot', 'Social preview'],
  ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'LinkedInBot', 'Social preview'],
  ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Slackbot', 'Social preview'],
  ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'Discordbot', 'Social preview'],
  ['WhatsApp/2.23.20.0 A', 'WhatsApp', 'Social preview'],
  ['http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)', 'Mastodon', 'Social preview'],
  ['Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', 'UptimeRobot', 'Monitoring'],
  ['Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36 Chrome-Lighthouse', 'Lighthouse', 'Monitoring'],
  ['vercel-screenshot/1.0', 'Vercel', 'Monitoring'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36', 'Headless Chrome', 'Automation'],
  ['curl/8.4.0', 'curl', 'Automation'],
  ['Wget/1.21.4', 'Wget', 'Automation'],
  ['python-requests/2.31.0', 'Python script', 'Automation'],
  ['python-httpx/0.27.0', 'Python script', 'Automation'],
  ['Python/3.12 aiohttp/3.9.1', 'Python script', 'Automation'],
  ['node', 'Node.js script', 'Automation'],
  ['axios/1.6.2', 'Node.js script', 'Automation'],
  ['Go-http-client/2.0', 'Go program', 'Automation'],
  ['okhttp/4.12.0', 'Java program', 'Automation'],
  ['Scrapy/2.11.0 (+https://scrapy.org)', 'Scrapy', 'Automation'],
  ['PostmanRuntime/7.36.0', 'Postman', 'Automation'],
  ['Mozilla/5.0 (compatible; FooBot/1.0; +https://foo.example/bot)', 'FooBot', 'Other'],
  ['SuperCrawler/2.1', 'SuperCrawler', 'Other'],
];

const PEOPLE = [
  CHROME,
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 309.0.0.0.0 (iPhone14,2; iOS 17_0)',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.0]',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 [Pinterest/Android]',
  'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.36.140 Chrome/120.0 Electron/28.0.0 Safari/537.36 Sonic Slack_SSB/4.36.140',
];

describe('identifyBot', () => {
  it.each(BOTS)('%s → %s', (ua, name, category) => {
    expect(identifyBot(ua)).toMatchObject({ name, category });
  });

  it.each(PEOPLE)('people are not bots: %s', (ua) => {
    expect(identifyBot(ua)).toBeNull();
  });

  it('names the operator', () => {
    expect(identifyBot(BOTS[0][0])).toMatchObject({ operator: 'OpenAI', domain: 'openai.com', ips: 'openai-gptbot' });
    expect(identifyBot('curl/8.4.0')).toMatchObject({ operator: '' });
  });

  it('treats a missing user agent and automated browsers as bots', () => {
    expect(identifyBot('')).toMatchObject({ name: 'No user agent', category: 'Automation' });
    expect(identifyBot(CHROME, { automated: true })).toMatchObject({ name: 'Headless browser' });
  });

  it('recognises signed agents by their Signature-Agent, even with a script user agent', () => {
    expect(identifyBot(CHROME, { signatureAgent: '"https://chatgpt.com"' })).toMatchObject({ name: 'ChatGPT agent', category: 'AI agent' });
    expect(identifyBot('python-requests/2.31', { signatureAgent: 'sig1="https://chatgpt.com"' })).toMatchObject({ name: 'ChatGPT agent' });
    expect(identifyBot(CHROME, { signatureAgent: 'sig1="https://agents.example.com"' })).toMatchObject({ name: 'agents.example.com', category: 'AI agent' });
  });

  it('keeps the old isBot behaviour', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('')).toBe(true);
    expect(isBot(CHROME)).toBe(false);
  });

  it('parses both Signature-Agent forms', () => {
    expect(signerHost('"https://chatgpt.com"')).toBe('chatgpt.com');
    expect(signerHost('sig1="https://Agent.Bot.Goog"')).toBe('agent.bot.goog');
    expect(signerHost('nonsense')).toBeNull();
  });
});

describe('server snippet pre-filters', () => {
  it.each(BOTS)('BOT_HINT catches %s', (ua) => {
    expect(BOT_HINT.test(ua)).toBe(true);
  });
  it('AI_BOT_HINT catches every AI bot and nothing else in the list', () => {
    for (const [ua, , category] of BOTS) expect([ua, AI_BOT_HINT.test(ua)]).toEqual([ua, isAiCategory(category)]);
  });
});

describe('IP ranges', () => {
  it('parses IPv4, IPv6 and mapped addresses', () => {
    expect(parseIp('1.2.3.4')).toEqual({ v6: false, value: 0x01020304n });
    expect(parseIp('::ffff:1.2.3.4')).toEqual({ v6: false, value: 0x01020304n });
    expect(parseIp('2001:db8::1')?.v6).toBe(true);
    expect(parseIp('::')?.value).toBe(0n);
    for (const bad of ['1.2.3', '256.1.1.1', '1::2::3', 'nope', '']) expect(parseIp(bad)).toBeNull();
  });
  it('matches addresses against CIDR ranges', () => {
    const ranges = ['216.73.216.0/22', '2600:1f28:365:8000::/56', '34.31.25.14'].map((r) => parseRange(r)!);
    expect(inRanges('216.73.219.255', ranges)).toBe(true);
    expect(inRanges('216.73.220.0', ranges)).toBe(false);
    expect(inRanges('2600:1f28:365:80ff:abcd::1', ranges)).toBe(true);
    expect(inRanges('2600:1f28:365:8100::1', ranges)).toBe(false);
    expect(inRanges('34.31.25.14', ranges)).toBe(true);
    expect(inRanges('34.31.25.15', ranges)).toBe(false);
    expect(parseRange('10.0.0.0/33')).toBeNull();
  });
});

const GPTBOT_LIST = JSON.stringify({ creationTime: '2026-09-22', prefixes: [{ ipv4Prefix: '132.196.86.0/24' }, { ipv6Prefix: '2603:1030::/32' }] });
const SAIL = `schema = "draft-kelley-webbotauth-sail-00"
[[prefix_sets]]
name          = "agentic-browser-use"
ipv4_prefixes = [
  "136.71.21.147",
  "34.31.25.14",
]
ipv6_prefixes = []
[[services]]
name        = "Claude-Agent"
prefix_sets = ["agentic-browser-use"]`;

function fakeFetch(files: Record<string, string>) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return url in files ? new Response(files[url]) : new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

describe('published IP lists', () => {
  beforeEach(resetBotVerification);

  it('reads the JSON lists and Anthropic’s SAIL file', () => {
    expect(parseIpList(GPTBOT_LIST)).toHaveLength(2);
    expect(parseIpList(SAIL).map((r) => r.start)).toEqual([parseIp('136.71.21.147')!.value, parseIp('34.31.25.14')!.value]);
  });

  it('verifies an address, flags a fake and caches the list', async () => {
    const { fetcher, calls } = fakeFetch({ 'https://openai.com/gptbot.json': GPTBOT_LIST });
    expect(await verifyIp('openai-gptbot', '132.196.86.12', fetcher)).toBe('verified');
    expect(await verifyIp('openai-gptbot', '2603:1030:1::5', fetcher)).toBe('verified');
    expect(await verifyIp('openai-gptbot', '8.8.8.8', fetcher)).toBe('spoofed');
    expect(calls).toHaveLength(1);
  });

  it('says unknown when it cannot check', async () => {
    const { fetcher } = fakeFetch({});
    expect(await verifyIp('openai-gptbot', '132.196.86.12', fetcher)).toBe('unknown');
    expect(await verifyIp('openai-gptbot', null, fetcher)).toBe('unknown');
    expect(await verifyIp('openai-gptbot', 'not-an-ip', fetcher)).toBe('unknown');
    expect(await verifyBot(identifyBot('Bytespider')!, '1.2.3.4', null, fetcher)).toBe('unknown');
  });
});

describe('Web Bot Auth signatures', () => {
  beforeEach(resetBotVerification);

  async function agentKey() {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
    const keyid = createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x })).digest('base64url');
    const { fetcher } = fakeFetch({ 'https://chatgpt.com/.well-known/http-message-signatures-directory': JSON.stringify({ keys: [jwk] }) });
    return { privateKey: pair.privateKey, keyid, fetcher };
  }

  async function signedRequest(privateKey: CryptoKey, keyid: string, url = 'https://example.com/pricing') {
    const unsigned = new Request(url, { headers: { 'signature-agent': '"https://chatgpt.com"' } });
    const now = Math.floor(Date.now() / 1000);
    const fields = await createSignature(unsigned, {
      label: 'sig1',
      components: ['@authority', 'signature-agent'],
      parameters: { created: now, expires: now + 60, keyid, tag: 'web-bot-auth' },
      signer: webcrypto.signer(privateKey),
    });
    return (target = url) =>
      new Request(target, {
        headers: { 'signature-agent': '"https://chatgpt.com"', signature: fields.signature, 'signature-input': fields.signatureInput },
      });
  }

  it('accepts a request signed with a key from the agent’s directory', async () => {
    const { privateKey, keyid, fetcher } = await agentKey();
    const req = (await signedRequest(privateKey, keyid))();
    expect(await verifyAgentSignature(req, fetcher)).toBe(true);
    expect(await verifyBot(identifyBot(CHROME, { signatureAgent: '"https://chatgpt.com"' })!, null, req, fetcher)).toBe('verified');
  });

  it('rejects a signature replayed against another site, or from an unknown key', async () => {
    const { privateKey, keyid, fetcher } = await agentKey();
    const make = await signedRequest(privateKey, keyid);
    expect(await verifyAgentSignature(make('https://other.example/pricing'), fetcher)).toBe(false);
    resetBotVerification(); // the directory is cached per host; now it holds a different key
    const other = await agentKey();
    expect(await verifyAgentSignature(make(), other.fetcher)).toBe(false);
  });
});

describe('storing hits', () => {
  const gpt = identifyBot('GPTBot/1.2')!;
  const claude = identifyBot('ClaudeBot/1.0')!;
  const hour = Date.UTC(2026, 10, 12, 10);
  const hit = (bot = gpt, path = '/', ts = hour + 60_000, verdict: BotHit['verdict'] = 'verified', error = false, blocked = false): BotHit => ({ bot, path, ts, verdict, error, blocked });

  it('folds hits into one row per hour, bot and page', () => {
    const rows = aggregateHits([hit(), hit(gpt, '/', hour + 120_000, 'spoofed', true, true), hit(claude), hit(gpt, '/llms.txt'), hit(gpt, '/', hour + 3_600_000)]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ hour, bot: 'GPTBot', operator: 'OpenAI', category: 'AI training', path: '/', hits: 2, verified: 1, spoofed: 1, errors: 1, blocked: 1, last_seen: hour + 120_000 });
  });

  it('accepts log timestamps up to a week old', () => {
    const now = Date.UTC(2026, 10, 12);
    expect(hitTime(now - 3_600_000, now)).toBe(now - 3_600_000);
    expect(hitTime((now - 3_600_000) / 1000, now)).toBe(now - 3_600_000);
    expect(hitTime('2026-11-11T10:00:00Z', now)).toBe(Date.UTC(2026, 10, 11, 10));
    expect(hitTime(now - 30 * 86_400_000, now)).toBe(now);
    expect(hitTime('garbage', now)).toBe(now);
  });

  it('only trusts the client address when no proxy is involved', () => {
    expect(directIp(new Headers({ 'cf-connecting-ip': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(directIp(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
    expect(directIp(new Headers({ 'cf-connecting-ip': '76.76.21.1', 'x-forwarded-for': '9.9.9.9, 76.76.21.1' }))).toBeNull();
    expect(directIp(new Headers({ 'cf-connecting-ip': '76.76.21.1', 'x-vercel-ip-country': 'US' }))).toBeNull();
  });
});
