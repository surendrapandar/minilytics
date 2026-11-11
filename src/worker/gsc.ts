import type { Context } from 'hono';
import type { AppEnv } from './env';
import { PERIODS, resolveRange } from './lib/time';

type Dimension = 'query' | 'page' | 'country' | 'device';
const DIMS: Dimension[] = ['query', 'page', 'country', 'device'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
let tokenCache: { value: string; expires: number; fingerprint: string } | null = null;

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function utf8url(text: string): string { return b64url(new TextEncoder().encode(text)); }

interface ServiceKey { client_email: string; private_key: string; private_key_id?: string; type: string }
function keyFromEnv(raw?: string): ServiceKey {
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON is not configured');
  let key: ServiceKey;
  try { key = JSON.parse(raw) as ServiceKey; } catch { throw new Error('Invalid service-account secret'); }
  if (key.type !== 'service_account' || !key.client_email?.endsWith('.gserviceaccount.com') || !key.private_key?.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Invalid service-account credentials');
  }
  return key;
}
export async function googleToken(raw?: string): Promise<string> {
  const key = keyFromEnv(raw);
  const fingerprint = key.client_email + ':' + (key.private_key_id ?? '');
  if (tokenCache && tokenCache.fingerprint === fingerprint && Date.now() + 60_000 < tokenCache.expires) return tokenCache.value;
  const pem = key.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const secret = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey('pkcs8', secret, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const body = utf8url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const header = utf8url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id }));
  const unsigned = header + '.' + body;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned));
  const assertion = unsigned + '.' + b64url(new Uint8Array(signature));
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('Google token request failed (' + response.status + ')');
  const result = await response.json<{ access_token?: string; expires_in?: number }>();
  if (!result.access_token) throw new Error('Google did not return an access token');
  tokenCache = { value: result.access_token, fingerprint, expires: Date.now() + (result.expires_in ?? 3600) * 1000 };
  return result.access_token;
}
export function validGscProperty(value: string): boolean {
  if (value.startsWith('sc-domain:')) return /^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
async function allowedProperties(token: string): Promise<string[]> {
  const result = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: 'Bearer ' + token } });
  if (!result.ok) throw new Error('Could not list GSC properties (' + result.status + ')');
  const json = await result.json<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>();
  return (json.siteEntry ?? []).filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser').map((entry) => entry.siteUrl);
}
export async function gscProperties(c: Context<AppEnv>) {
  const user = c.get('user');
  if (c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && !user.admin) return c.json({ error: 'GSC service account is admin-only' }, 403);
  try {
    const token = await googleToken(c.env.GSC_SERVICE_ACCOUNT_JSON);
    return c.json({ properties: await allowedProperties(token) });
  } catch (error) { return c.json({ error: (error as Error).message }, 502); }
}
export async function configureGsc(c: Context<AppEnv>) {
  const user = c.get('user');
  if (c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && !user.admin) return c.json({ error: 'GSC service account is admin-only' }, 403);
  const json = await c.req.json<{ property?: string | null }>().catch(() => null);
  if (!json || (json.property !== null && typeof json.property !== 'string')) return c.json({ error: 'Invalid GSC property' }, 400);
  const property = json.property?.trim() || null;
  if (property && !validGscProperty(property)) return c.json({ error: 'Invalid property format' }, 400);
  if (property) {
    try {
      const token = await googleToken(c.env.GSC_SERVICE_ACCOUNT_JSON);
      if (!(await allowedProperties(token)).includes(property)) return c.json({ error: 'Service account cannot access this GSC property' }, 403);
    } catch (error) { return c.json({ error: (error as Error).message }, 502); }
  }
  await c.env.DB.prepare('UPDATE sites SET gsc_property = ? WHERE id = ?').bind(property, c.get('site').id).run();
  return c.json({ property });
}
const GSC_TZ = 'America/Los_Angeles';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function validGscDates(from: string, to: string, today = pacificDay(Date.now())): boolean {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  return valid(from) && valid(to) && from <= to && to <= today &&
    (Date.parse(to) - Date.parse(from)) / DAY_MS <= 365;
}

/** Search Console uses Pacific calendar days and offset-bearing hourly buckets. */
export function resolveGscWindow(
  selection: { period?: string; from?: string; to?: string },
  siteCreatedAt: number,
  now = Date.now(),
) {
  const hourly = ['24h', '48h', 'today', 'yesterday'].includes(selection.period ?? '');
  const hours = selection.period === '48h' ? 48 : 24;
  const endMs = hourly ? Math.floor(now / HOUR_MS) * HOUR_MS : undefined;
  const startMs = hourly ? endMs! - hours * HOUR_MS : undefined;
  const range = hourly
    ? { from: startMs!, to: endMs! }
    : resolveRange(selection, GSC_TZ, siteCreatedAt, now);
  const requestedFrom = pacificDay(range.from);
  const requestedTo = pacificDay(range.to - 1);
  const oldest = utcDay(Date.parse(requestedTo + 'T00:00:00Z') - 365 * DAY_MS);
  const effectiveFrom = requestedFrom < oldest ? oldest : requestedFrom;
  return {
    from: effectiveFrom, to: requestedTo, requestedFrom, requestedTo,
    available: effectiveFrom <= requestedTo,
    truncated: requestedFrom < oldest,
    granularity: hourly ? 'hour' as const : 'day' as const,
    startMs, endMs, asOf: now,
  };
}

interface GscApiRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface GscApiResult { rows?: GscApiRow[]; metadata?: { first_incomplete_date?: string; first_incomplete_hour?: string } }
interface GscTotals { clicks: number; impressions: number; ctr: number; position: number }

const EMPTY_TOTALS: GscTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
function utcDay(timestamp: number): string { return new Date(timestamp).toISOString().slice(0, 10); }

/** Equal-length comparison immediately before the selected (inclusive) GSC date window. */
export function previousGscWindow(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  const span = end - start + DAY_MS;
  return { from: utcDay(start - span), to: utcDay(start - DAY_MS) };
}

/** A missing daily row means no recorded search activity on that date. */
export function gscDailySeries(from: string, to: string, rows: GscApiRow[]) {
  const byDate = new Map(rows.map((row) => [row.keys?.[0], row]));
  const series: Array<{ date: string } & GscTotals> = [];
  const end = Date.parse(to + 'T00:00:00Z');
  for (let day = Date.parse(from + 'T00:00:00Z'); day <= end; day += DAY_MS) {
    const date = utcDay(day);
    const row = byDate.get(date);
    series.push({ date, clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0,
      ctr: row?.ctr ?? 0, position: row?.position ?? 0 });
  }
  return series;
}

type GscDataState = 'all' | 'hourly_all';
async function searchAnalytics(
  token: string, property: string, from: string, to: string,
  dimensions: string[], rowLimit: number, dataState: GscDataState = 'all',
): Promise<GscApiResult> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(property) + '/searchAnalytics/query', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: from, endDate: to, dimensions, type: 'web', rowLimit, dataState }),
  });
  if (!response.ok) throw new Error('GSC query failed (' + response.status + '). Check property permissions.');
  return response.json<GscApiResult>();
}

/** Positions and CTR must be impression-weighted, not naively averaged. */
export function aggregateGscRows(rows: GscApiRow[]): GscTotals {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  return {
    clicks, impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0,
  };
}
function hourTimestamp(row: GscApiRow): number {
  const parsed = Date.parse(row.keys?.[0] ?? '');
  return Number.isFinite(parsed) ? parsed : -1;
}
export function gscHourlySeries(start: number, end: number, rows: GscApiRow[]) {
  const filtered = rows.filter((row) => hourTimestamp(row) >= start && hourTimestamp(row) < end);
  const byHour = new Map(filtered.map((row) => [hourTimestamp(row), row]));
  const series: Array<{ date: string } & GscTotals> = [];
  for (let hour = start; hour < end; hour += HOUR_MS) {
    const row = byHour.get(hour);
    series.push({ date: new Date(hour).toISOString(), ...(row ? aggregateGscRows([row]) : { ...EMPTY_TOTALS }) });
  }
  return series;
}
export function gscHourlyBreakdown(start: number, end: number, rows: GscApiRow[]) {
  const grouped = new Map<string, GscApiRow[]>();
  for (const row of rows) {
    if (hourTimestamp(row) < start || hourTimestamp(row) >= end) continue;
    const label = row.keys?.[1];
    if (!label) continue;
    const group = grouped.get(label) ?? [];
    group.push(row);
    grouped.set(label, group);
  }
  return [...grouped].map(([label, items]) => ({ label, ...aggregateGscRows(items) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 250);
}

function totalsFrom(rows: GscApiRow[]): GscTotals {
  const row = rows[0];
  return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : { ...EMPTY_TOTALS };
}

export async function gscSearch(c: Context<AppEnv>) {
  const user = c.get('user');
  const agentToken = c.get('agentToken');
  const admin = user ? user.admin : agentToken?.owner_admin === 1;
  if (c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && !admin) return c.json({ error: 'GSC service account is admin-only' }, 403);
  const property = c.get('site').gsc_property;
  if (!property) return c.json({ connected: false, rows: [], property: null });
  const dimension = c.req.query('dimension') ?? 'query';
  if (!DIMS.includes(dimension as Dimension)) return c.json({ error: 'Invalid dimension' }, 400);
  const view = c.req.query('view') ?? 'all';
  if (!['all', 'overview', 'breakdown'].includes(view)) return c.json({ error: 'Invalid GSC view' }, 400);
  const selectedPeriod = c.req.query('period') ?? (c.req.query('from') && c.req.query('to') ? 'custom' : '30d');
  if (!PERIODS.includes(selectedPeriod as (typeof PERIODS)[number])) {
    return c.json({ error: 'Invalid period' }, 400);
  }
  const selection = { period: selectedPeriod, from: c.req.query('from'), to: c.req.query('to') };
  const calendarDate = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  };
  if (selectedPeriod === 'custom' && (
    !calendarDate(selection.from) || !calendarDate(selection.to) ||
    (selection.from ?? '') > (selection.to ?? '')
  )) return c.json({ error: 'Invalid custom date range' }, 400);

  // Reuse an hourly snapshot on tab switches; reject old/future user-supplied clocks.
  const rawAsOf = c.req.query('asOf');
  const asOf = rawAsOf ? Number(rawAsOf) : Date.now();
  if (rawAsOf && (!Number.isSafeInteger(asOf) || asOf > Date.now() + 60_000 || asOf < Date.now() - 7 * DAY_MS)) {
    return c.json({ error: 'Invalid GSC snapshot timestamp' }, 400);
  }
  const window = resolveGscWindow(selection, c.get('site').created_at, asOf);
  const { from, to } = window;
  if (!window.available) {
    return c.json({ connected: true, property, dimension, ...window,
      ...(view === 'breakdown' ? {} : {
        totals: { ...EMPTY_TOTALS }, previous: { ...EMPTY_TOTALS }, series: [],
      }),
      ...(view === 'overview' ? {} : { rows: [] }),
    });
  }
  if (!validGscDates(from, to)) {
    return c.json({ error: 'Selected Search Console window is outside the supported 366-day range' }, 400);
  }
  try {
    const token = await googleToken(c.env.GSC_SERVICE_ACCOUNT_JSON);
    const getOverview = async () => {
      if (window.granularity === 'hour') {
        const start = window.startMs!, end = window.endMs!;
        const previousStart = start - (end - start);
        const response = await searchAnalytics(token, property, pacificDay(previousStart), to, ['hour'], 500, 'hourly_all');
        const rows = response.rows ?? [];
        const current = rows.filter((row) => hourTimestamp(row) >= start && hourTimestamp(row) < end);
        const previous = rows.filter((row) => hourTimestamp(row) >= previousStart && hourTimestamp(row) < start);
        const lastReportedHour = current.length
          ? new Date(Math.max(...current.map(hourTimestamp))).toISOString() : null;
        return {
          totals: aggregateGscRows(current), previous: aggregateGscRows(previous),
          series: gscHourlySeries(start, end, current),
          incompleteFrom: response.metadata?.first_incomplete_hour ?? null,
          lastReportedHour,
        };
      }
      const previousRange = previousGscWindow(from, to);
      const [daily, totals, previous] = await Promise.all([
        searchAnalytics(token, property, from, to, ['date'], 1000),
        searchAnalytics(token, property, from, to, [], 1),
        searchAnalytics(token, property, previousRange.from, previousRange.to, [], 1),
      ]);
      return {
        totals: totalsFrom(totals.rows ?? []), previous: totalsFrom(previous.rows ?? []),
        series: gscDailySeries(from, to, daily.rows ?? []),
        incompleteFrom: daily.metadata?.first_incomplete_date ?? null,
        lastReportedHour: null,
      };
    };
    const getBreakdown = async () => {
      if (window.granularity === 'hour') {
        const response = await searchAnalytics(token, property, from, to, ['hour', dimension], 25_000, 'hourly_all');
        return {
          rows: gscHourlyBreakdown(window.startMs!, window.endMs!, response.rows ?? []),
          truncatedRows: (response.rows?.length ?? 0) === 25_000,
        };
      }
      const response = await searchAnalytics(token, property, from, to, [dimension], 250);
      return {
        rows: (response.rows ?? []).map((row) => ({
          label: row.keys?.[0] ?? '', clicks: row.clicks, impressions: row.impressions,
          ctr: row.ctr, position: row.position,
        })),
        truncatedRows: false,
      };
    };
    const [overview, breakdown] = await Promise.all([
      view === 'breakdown' ? Promise.resolve(null) : getOverview(),
      view === 'overview' ? Promise.resolve(null) : getBreakdown(),
    ]);
    return c.json({
      connected: true, property, dimension, ...window,
      ...(overview ?? {}), ...(breakdown ?? {}),
    });
  } catch (error) { return c.json({ error: (error as Error).message }, 502); }
}

function pacificDay(time: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GSC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(time));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return value('year') + '-' + value('month') + '-' + value('day');
}

/** Include provisional days up to today instead of hiding them. */
export function trendGscWindow(from: number, to: number, now = Date.now()) {
  // Multi-site charts use UTC calendar buckets. Keep the same date labels,
  // while Google reports each matching date in Pacific Time.
  const requestedFrom = utcDay(from);
  const requestedTo = utcDay(to - 1);
  const today = pacificDay(now);
  const oldest = utcDay(Date.parse(today + 'T00:00:00Z') - 365 * DAY_MS);
  const start = requestedFrom < oldest ? oldest : requestedFrom;
  const end = requestedTo < today ? requestedTo : today;
  return { from: start, to: end, available: start <= end, truncated: requestedFrom < oldest };
}

/** The GSC hourly API supports up to the most recent ten days. */
export function trendGscHourlyWindow(from: number, to: number, now = Date.now()) {
  return {
    from: pacificDay(from), to: pacificDay(to - 1),
    available: from < to && from >= now - 10 * DAY_MS && to <= now + HOUR_MS,
  };
}
export interface GscDayImpressions {
  date: string;
  impressions: number;
}
export interface GscHourImpressions {
  hour: string; // UTC YYYY-MM-DDTHH:mm, matching overview buckets
  impressions: number;
}

/** The default cache namespace is not part of the installed CacheStorage typing. */
function trendCache(): Cache | null {
  return (caches as unknown as { default?: Cache }).default ?? null;
}

/** Fresh GSC data stays provisional; use a short cache and a new namespace. */
export async function gscDailyImpressions(
  token: string, property: string, from: string, to: string,
): Promise<GscDayImpressions[]> {
  const key = new Request('https://gsc-trend-cache.internal/v2/daily/' +
    encodeURIComponent(property) + '/' + from + '/' + to);
  const cache = trendCache();
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return await hit.json<GscDayImpressions[]>();
    } catch { /* Not available outside Workers. */ }
  }
  const response = await searchAnalytics(token, property, from, to, ['date'], 1000);
  const daily = (response.rows ?? []).flatMap((row) => row.keys?.[0]
    ? [{ date: row.keys[0], impressions: row.impressions }]
    : []);
  if (cache) {
    try {
      await cache.put(key, new Response(JSON.stringify(daily), {
        headers: { 'content-type': 'application/json', 'Cache-Control': 'max-age=180' },
      }));
    } catch { /* Cache failures are nonfatal. */ }
  }
  return daily;
}

/** Cache the GSC hourly response by PT date, then filter to the precise UTC window. */
export async function gscHourlyImpressions(
  token: string, property: string, fromMs: number, toMs: number,
): Promise<GscHourImpressions[]> {
  const from = pacificDay(fromMs), to = pacificDay(toMs - 1);
  const key = new Request('https://gsc-trend-cache.internal/v2/hourly/' +
    encodeURIComponent(property) + '/' + from + '/' + to);
  const cache = trendCache();
  let hourly: GscHourImpressions[] | null = null;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) hourly = await hit.json<GscHourImpressions[]>();
    } catch { /* Not available outside Workers. */ }
  }
  if (!hourly) {
    const response = await searchAnalytics(token, property, from, to, ['hour'], 500, 'hourly_all');
    hourly = (response.rows ?? []).flatMap((row) => {
      const timestamp = hourTimestamp(row);
      return timestamp >= 0 ? [{ hour: new Date(timestamp).toISOString().slice(0, 16), impressions: row.impressions }] : [];
    });
    if (cache) {
      try {
        await cache.put(key, new Response(JSON.stringify(hourly), {
          headers: { 'content-type': 'application/json', 'Cache-Control': 'max-age=180' },
        }));
      } catch { /* Nonfatal. */ }
    }
  }
  return hourly.filter((row) => {
    const hour = Date.parse(row.hour + ':00Z');
    return hour >= Math.floor(fromMs / HOUR_MS) * HOUR_MS && hour < toMs;
  });
}
