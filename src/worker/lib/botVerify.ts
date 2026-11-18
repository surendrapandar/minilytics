import { verifySignature, webcrypto } from 'http-message-sig';
import { SIGNED_AGENTS, signerHost, type BotInfo, type IpListId } from '../../shared/bots';
import { inRanges, parseIp, parseRange, type IpRange } from './ip';

/**
 * Was a bot hit really sent by the bot's operator?
 * - verified: the address is in the operator's published list, or the request carries a valid Web Bot Auth signature
 * - spoofed:  it claims to be a bot whose operator publishes its addresses, but came from somewhere else
 * - unknown:  nothing to check against (no published list, no address, or the list couldn't be fetched)
 */
export type Verdict = 'verified' | 'spoofed' | 'unknown';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (url, init) => fetch(url, init);

const GOOGLE = 'https://developers.google.com/static/crawling/ipranges/';

/** Where each operator publishes the addresses its bots use (from each operator's crawler docs). */
export const IP_LISTS: Record<IpListId, string[]> = {
  'openai-gptbot': ['https://openai.com/gptbot.json'],
  'openai-searchbot': ['https://openai.com/searchbot.json'],
  'openai-chatgpt-user': ['https://openai.com/chatgpt-user.json'],
  'openai-adsbot': ['https://openai.com/adsbot.json'],
  anthropic: ['https://claude.com/crawling/bots.json'],
  'anthropic-agent': ['https://claude.com/.well-known/sail'],
  'perplexity-bot': ['https://www.perplexity.ai/perplexitybot.json'],
  'perplexity-user': ['https://www.perplexity.ai/perplexity-user.json'],
  'google-common': [GOOGLE + 'common-crawlers.json'],
  'google-special': [GOOGLE + 'special-crawlers.json'],
  'google-fetchers': [GOOGLE + 'user-triggered-fetchers.json', GOOGLE + 'user-triggered-fetchers-google.json'],
  'google-agents': [GOOGLE + 'user-triggered-agents.json'],
  apple: ['https://search.developer.apple.com/applebot.json'],
  bing: ['https://www.bing.com/toolbox/bingbot.json'],
  duckassist: ['https://duckduckgo.com/duckassistbot.json'],
  'mistral-user': ['https://mistral.ai/mistralai-user-ips.json'],
  'mistral-index': ['https://mistral.ai/mistralai-index-ips.json'],
  ccbot: ['https://index.commoncrawl.org/ccbot.json'],
};

/**
 * Ranges in a published list. Most operators use the same JSON shape ({ prefixes: [{ ipv4Prefix } | { ipv6Prefix }] });
 * Anthropic's agent list is a SAIL file (TOML), where every quoted address counts.
 */
export function parseIpList(text: string): IpRange[] {
  let found: unknown[];
  try {
    const json = JSON.parse(text) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string }[] };
    found = (json.prefixes ?? []).flatMap((p) => [p.ipv4Prefix, p.ipv6Prefix]);
  } catch {
    found = [...text.matchAll(/"([0-9a-f.:]+(?:\/\d{1,3})?)"/gi)].map((m) => m[1]);
  }
  return found.flatMap((p) => (typeof p === 'string' ? (parseRange(p) ?? []) : []));
}

// Lists change every few weeks; each isolate keeps them for a few hours (a failed download is retried sooner).
const LIST_TTL = 6 * 3_600_000;
const RETRY_TTL = 10 * 60_000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<any> }>();

function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry: { at: number; ttl: number; value: Promise<T | null> } = { at: Date.now(), ttl, value: Promise.resolve(null) };
  entry.value = load().then(
    (v) => {
      if (v === null) entry.ttl = RETRY_TTL;
      return v;
    },
    () => {
      entry.ttl = RETRY_TTL;
      return null;
    },
  );
  cache.set(key, entry);
  return entry.value;
}

/** Forget downloaded lists and keys (tests). */
export function resetBotVerification() {
  cache.clear();
}

async function download(url: string, fetcher: Fetcher): Promise<string> {
  // Cloudflare's cache shares one download between isolates.
  const res = await fetcher(url, { cf: { cacheTtl: LIST_TTL / 1000, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

function ipList(id: IpListId, fetcher: Fetcher) {
  return cached(`ips:${id}`, LIST_TTL, async () => {
    const ranges = (await Promise.all(IP_LISTS[id].map((u) => download(u, fetcher)))).flatMap(parseIpList);
    return ranges.length ? ranges : null;
  });
}

export async function verifyIp(id: IpListId, ip: string | null, fetcher: Fetcher = defaultFetch): Promise<Verdict> {
  if (!ip || !parseIp(ip)) return 'unknown';
  const ranges = await ipList(id, fetcher);
  if (!ranges) return 'unknown';
  return inRanges(ip, ranges) ? 'verified' : 'spoofed';
}

interface Key {
  thumbprint: string;
  kid?: string;
  verifier: ReturnType<typeof webcrypto.verifier>;
}

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 7638 thumbprint of an Ed25519 key: what Web Bot Auth uses as the keyid. */
async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

/** Signing keys of a known agent. Only directories in SIGNED_AGENTS are ever fetched. */
function agentKeys(host: string, fetcher: Fetcher) {
  return cached(`keys:${host}`, 3_600_000, async () => {
    const dir = JSON.parse(await download(`https://${host}/.well-known/http-message-signatures-directory`, fetcher)) as { keys?: JsonWebKey[] };
    const keys: Key[] = [];
    for (const jwk of dir.keys ?? []) {
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
      try {
        const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, { name: 'Ed25519' }, false, ['verify']);
        keys.push({ thumbprint: await thumbprint(jwk), kid: (jwk as { kid?: string }).kid, verifier: webcrypto.verifier(key) });
      } catch {
        // A key this runtime can't import is skipped.
      }
    }
    return keys.length ? keys : null;
  });
}

/**
 * Web Bot Auth (RFC 9421 HTTP Message Signatures + draft-ietf-webbotauth-httpsig-protocol): the request is signed
 * by a key from the agent's published directory, and the signature covers the Signature-Agent header that names it.
 */
export async function verifyAgentSignature(req: Request, fetcher: Fetcher = defaultFetch): Promise<boolean> {
  const agentHeader = req.headers.get('signature-agent');
  const host = signerHost(agentHeader);
  if (!host || !SIGNED_AGENTS[host] || !req.headers.has('signature') || !req.headers.has('signature-input')) return false;
  const keys = await agentKeys(host, fetcher);
  if (!keys) return false;
  // Current form: sig1="https://…" names the signature's label; the legacy form is a bare string.
  const label = /^\s*([a-z][\w*-]*)\s*=/i.exec(agentHeader!)?.[1];
  try {
    await verifySignature(req, {
      label,
      policy: {
        algorithms: ['ed25519'],
        requiredComponents: [],
        requiredParameters: ['created', 'expires', 'keyid', 'tag'],
        maxAge: 86_400,
        clockSkew: 60,
      },
      resolveVerifier(candidate) {
        const names = candidate.components.map((c) => c.name);
        if (candidate.parameters.tag !== 'web-bot-auth') throw new Error('not a Web Bot Auth signature');
        if (!names.includes('signature-agent')) throw new Error('Signature-Agent is not signed');
        if (!names.includes('@authority') && !names.includes('@target-uri')) throw new Error('no target signed');
        const key = keys.find((k) => k.thumbprint === candidate.parameters.keyid || k.kid === candidate.parameters.keyid);
        if (!key) throw new Error('unknown key');
        return key.verifier;
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * How sure we are that a hit came from `bot`. `ip` is null when it can't be trusted (e.g. it is a proxy's);
 * `req` carries the request's signature headers, when there are any.
 */
export async function verifyBot(bot: BotInfo, ip: string | null, req: Request | null, fetcher: Fetcher = defaultFetch): Promise<Verdict> {
  if (req?.headers.has('signature') && (await verifyAgentSignature(req, fetcher))) return 'verified';
  return bot.ips ? verifyIp(bot.ips, ip, fetcher) : 'unknown';
}
