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
async function googleToken(raw?: string): Promise<string> {
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
function dayOffset(offset: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function validGscDates(from: string, to: string, today = dayOffset(0)): boolean {
  const valid = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  return valid(from) && valid(to) && from <= to && to < today &&
    (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 365;
}
const GSC_TZ = 'America/Los_Angeles';

/**
 * The same period selection drives every dashboard section. Search Console
 * reports calendar days in Pacific Time, so hourly periods are represented by
 * overlapping PT dates and the current incomplete PT day is excluded.
 */
export function resolveGscWindow(
  selection: { period?: string; from?: string; to?: string },
  siteCreatedAt: number,
  now = Date.now(),
) {
  const { from, to } = resolveRange(selection, GSC_TZ, siteCreatedAt, now);
  const ptDate = (time: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: GSC_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(time));
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return value('year') + '-' + value('month') + '-' + value('day');
  };
  const requestedFrom = ptDate(from);
  const requestedTo = ptDate(to - 1);
  const yesterday = new Date(Date.parse(ptDate(now) + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const effectiveTo = requestedTo < yesterday ? requestedTo : yesterday;
  const oldest = new Date(Date.parse(effectiveTo + 'T00:00:00Z') - 365 * 86_400_000).toISOString().slice(0, 10);
  const effectiveFrom = requestedFrom < oldest ? oldest : requestedFrom;
  return {
    from: effectiveFrom, to: effectiveTo, requestedFrom, requestedTo,
    available: effectiveFrom <= effectiveTo,
    truncated: requestedFrom < oldest,
  };
}

interface GscApiRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface GscApiResult { rows?: GscApiRow[] }
interface GscTotals { clicks: number; impressions: number; ctr: number; position: number }

const EMPTY_TOTALS: GscTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
const DAY_MS = 86_400_000;

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

async function searchAnalytics(
  token: string, property: string, from: string, to: string,
  dimensions: string[], rowLimit: number,
): Promise<GscApiRow[]> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(property) + '/searchAnalytics/query', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: from, endDate: to, dimensions, type: 'web', rowLimit }),
  });
  if (!response.ok) throw new Error('GSC query failed (' + response.status + '). Check property permissions.');
  const body = await response.json<GscApiResult>();
  return body.rows ?? [];
}

function totalsFrom(rows: GscApiRow[]): GscTotals {
  const row = rows[0];
  return row ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position } : { ...EMPTY_TOTALS };
}

export async function gscSearch(c: Context<AppEnv>) {
  const user = c.get('user');
  if (c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && !user.admin) return c.json({ error: 'GSC service account is admin-only' }, 403);
  const property = c.get('site').gsc_property;
  if (!property) return c.json({ connected: false, rows: [], property: null });
  const dimension = c.req.query('dimension') ?? 'query';
  if (!DIMS.includes(dimension as Dimension)) return c.json({ error: 'Invalid dimension' }, 400);
  const selectedPeriod = c.req.query('period') ?? (c.req.query('from') && c.req.query('to') ? 'custom' : '30d');
  if (!PERIODS.includes(selectedPeriod as (typeof PERIODS)[number])) {
    return c.json({ error: 'Invalid period' }, 400);
  }
  const selection = { period: selectedPeriod, from: c.req.query('from'), to: c.req.query('to') };
  // Preserve the dashboard's custom window even if it exceeds the GSC 366-day
  // query limit; resolveGscWindow caps the fetch and labels it as truncated.
  const calendarDate = (value: string | undefined) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  };
  if (selectedPeriod === 'custom' && (
    !calendarDate(selection.from) || !calendarDate(selection.to) ||
    (selection.from ?? '') > (selection.to ?? '')
  )) return c.json({ error: 'Invalid custom date range' }, 400);
  const window = resolveGscWindow(selection, c.get('site').created_at);
  const { from, to } = window;
  if (!window.available) {
    return c.json({ connected: true, property, dimension, ...window,
      totals: { ...EMPTY_TOTALS }, previous: { ...EMPTY_TOTALS }, series: [], rows: [] });
  }
  if (!validGscDates(from, to)) {
    return c.json({ error: 'Selected Search Console window is outside the supported 366-day range' }, 400);
  }
  try {
    const token = await googleToken(c.env.GSC_SERVICE_ACCOUNT_JSON);
    const previousRange = previousGscWindow(from, to);
    // Site-wide aggregates are independent of the dimension table, whose top rows
    // can exclude anonymized search queries. Do not sum top rows into KPI cards.
    const [rows, daily, totals, previous] = await Promise.all([
      searchAnalytics(token, property, from, to, [dimension], 250),
      searchAnalytics(token, property, from, to, ['date'], 1000),
      searchAnalytics(token, property, from, to, [], 1),
      searchAnalytics(token, property, previousRange.from, previousRange.to, [], 1),
    ]);
    return c.json({
      connected: true, property, dimension, ...window,
      totals: totalsFrom(totals), previous: totalsFrom(previous),
      series: gscDailySeries(from, to, daily),
      rows: rows.map((row) => ({
        label: row.keys?.[0] ?? '', clicks: row.clicks, impressions: row.impressions,
        ctr: row.ctr, position: row.position,
      })),
    });
  } catch (error) { return c.json({ error: (error as Error).message }, 502); }
}
