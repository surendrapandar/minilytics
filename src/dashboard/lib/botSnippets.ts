import { AI_BOT_HINT, BOT_HINT } from '../../shared/bots';

// Copy-paste code for the site's own server: it reports bots to Minilytics (people are left to the tracking
// script) and answers "429 Too Many Requests" to any one bot that floods the site.

export type BotPlatform = 'nextjs' | 'worker' | 'express' | 'api';

export interface SnippetOptions {
  origin: string;
  /** Report only AI crawlers, assistants and agents (fewer requests). */
  aiOnly: boolean;
  /** Requests a minute one bot (same IP and user agent) may make before it gets a 429; null never blocks. */
  limit: number | null;
}

const ASSET = String.raw`/\.(?:css|js|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?)$/i`;

function header(o: SnippetOptions) {
  return `const BOT = /${(o.aiOnly ? AI_BOT_HINT : BOT_HINT).source}/i;`;
}

function limiter(o: SnippetOptions, ts: boolean) {
  if (!o.limit) return `const overLimit = (key${ts ? ': string' : ''}, now${ts ? ': number' : ''}) => 0; // flood protection is off`;
  return `// A bot sending more than LIMIT requests a minute gets "429 Too Many Requests" until the minute is over.
const LIMIT = ${o.limit};
const recent = new Map${ts ? '<string, { since: number; count: number }>' : ''}();
/** How far over the limit this client is this minute: 0 is fine, 1 is its first blocked request. */
function overLimit(key${ts ? ': string' : ''}, now${ts ? ': number' : ''}) {
  let r = recent.get(key);
  if (!r || now - r.since > 60_000) {
    if (recent.size > 10_000) recent.clear();
    r = { since: now, count: 0 };
    recent.set(key, r);
  }
  return Math.max(0, ++r.count - LIMIT);
}`;
}

function nextjs(o: SnippetOptions) {
  return `// middleware.ts in your project root (Next.js 16+: name it proxy.ts and rename the function to \`proxy\`)
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

${header(o)}

${limiter(o, true)}

export function middleware(req: NextRequest, event: NextFetchEvent) {
  const h = req.headers;
  const ua = h.get('user-agent') ?? '';
  if (ua && !BOT.test(ua) && !h.has('signature-agent')) return NextResponse.next(); // a person

  const ip = h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim() ?? '';
  const over = overLimit(ip + ua, Date.now());
  if (over <= 1) {
    // Fire and forget: never slows the page down. A flood is reported once, not per request.
    event.waitUntil(
      fetch('${o.origin}/api/v1/hits', {
        method: 'POST',
        headers: { Authorization: \`Bearer \${process.env.MINILYTICS_API_KEY}\`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: req.url,
          ua,
          ip,
          blocked: over === 1,
          signature: h.get('signature'),
          signature_input: h.get('signature-input'),
          signature_agent: h.get('signature-agent'),
        }),
      }).catch(() => {}),
    );
  }
  if (over) return new NextResponse('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
  return NextResponse.next();
}

export const config = {
  // Pages plus robots.txt, sitemap.xml and llms.txt. Skips build files and images.
  matcher: ['/((?!_next/static|_next/image|.*\\\\.(?:css|js|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?)$).*)'],
};`;
}

function worker(o: SnippetOptions) {
  return `// A Cloudflare Worker on your site's route (e.g. example.com/*). Add MINILYTICS_API_KEY as a secret.
${header(o)}
const ASSET = ${ASSET};

${limiter(o, false)}

export default {
  async fetch(request, env, ctx) {
    const h = request.headers;
    const ua = h.get('user-agent') ?? '';
    const isPerson = ua && !BOT.test(ua) && !h.has('signature-agent');
    if (isPerson || ASSET.test(new URL(request.url).pathname)) return fetch(request);

    const ip = h.get('cf-connecting-ip') ?? '';
    const over = overLimit(ip + ua, Date.now());
    const response = over
      ? new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } })
      : await fetch(request);
    if (over <= 1) {
      ctx.waitUntil(
        fetch('${o.origin}/api/v1/hits', {
          method: 'POST',
          headers: { Authorization: \`Bearer \${env.MINILYTICS_API_KEY}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: request.url,
            ua,
            ip,
            status: response.status,
            blocked: over === 1,
            signature: h.get('signature'),
            signature_input: h.get('signature-input'),
            signature_agent: h.get('signature-agent'),
          }),
        }).catch(() => {}),
      );
    }
    return response;
  },
};`;
}

function express(o: SnippetOptions) {
  return `// Express: add before your routes (Node 18+). Behind a proxy or CDN, also set app.set('trust proxy', true).
${header(o)}
const ASSET = ${ASSET};

${limiter(o, false)}

app.use((req, res, next) => {
  const ua = req.get('user-agent') ?? '';
  const isPerson = ua && !BOT.test(ua) && !req.get('signature-agent');
  if (isPerson || ASSET.test(req.path)) return next();

  const over = overLimit(req.ip + ua, Date.now());
  if (over <= 1) {
    res.on('finish', () => {
      fetch('${o.origin}/api/v1/hits', {
        method: 'POST',
        headers: { Authorization: \`Bearer \${process.env.MINILYTICS_API_KEY}\`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: \`\${req.protocol}://\${req.get('host')}\${req.originalUrl}\`,
          ua,
          ip: req.ip,
          status: res.statusCode,
          blocked: over === 1,
          signature: req.get('signature'),
          signature_input: req.get('signature-input'),
          signature_agent: req.get('signature-agent'),
        }),
      }).catch(() => {});
    });
  }
  if (over) return res.status(429).set('Retry-After', '60').send('Too many requests');
  next();
});`;
}

function api(o: SnippetOptions) {
  return `# One request
curl -X POST ${o.origin}/api/v1/hits \\
  -H "Authorization: Bearer $MINILYTICS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/pricing", "ua": "<user agent>", "ip": "<client ip>", "status": 200}'

# A batch from your logs (up to 500 per request; "ts" in ms, seconds or ISO, up to 7 days old)
curl -X POST ${o.origin}/api/v1/hits \\
  -H "Authorization: Bearer $MINILYTICS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"hits": [{"url": "/llms.txt", "ua": "...", "ip": "...", "status": 200, "ts": "2026-11-18T09:30:00Z"}]}'

# Optional fields: "signature", "signature_input", "signature_agent" (the request's Web Bot Auth headers),
# "blocked": true (you answered 429 because the bot sent too many requests).
# Requests from people are skipped, so sending all of them is harmless, just more requests.`;
}

export function botSnippet(platform: BotPlatform, o: SnippetOptions): string {
  return { nextjs, worker, express, api }[platform](o);
}

export const SNIPPET_LABELS: Record<BotPlatform, { label: string; file: string }> = {
  nextjs: { label: 'Next.js', file: 'middleware.ts' },
  worker: { label: 'Cloudflare Worker', file: 'worker.js' },
  express: { label: 'Express / Node', file: 'server.js' },
  api: { label: 'Other / logs', file: 'POST /api/v1/hits' },
};
