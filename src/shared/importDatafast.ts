import { classify } from './sources';
import { currencyDecimals } from './currency';

/** RFC 4180 compliant CSV parser. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM if present
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n
      }
      currentRow.push(currentField.trim());
      currentField = '';
      if (currentRow.some((f) => f.length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      lines.push(currentRow);
    }
  }

  if (lines.length === 0) return { headers: [], rows: [] };

  const rawHeaders = lines[0];
  const headers = rawHeaders.map((h) =>
    h
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^\w]/g, ''),
  );

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rowObj: Record<string, string> = {};
    const line = lines[i];
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = line[j] ?? '';
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}

export type FileType =
  | 'visitors'
  | 'sources'
  | 'pages'
  | 'entry_pages'
  | 'exit_pages'
  | 'countries'
  | 'devices'
  | 'browsers'
  | 'operating_systems'
  | 'custom_events'
  | 'payments'
  | 'unknown';

export function detectFileType(filename: string, headers: string[]): FileType {
  const fn = filename.toLowerCase();
  const hs = new Set(headers);

  if (fn.includes('entry') && (hs.has('entry_page') || hs.has('page'))) return 'entry_pages';
  if (fn.includes('exit') && (hs.has('exit_page') || hs.has('page'))) return 'exit_pages';
  if (fn.includes('page') || hs.has('page') || hs.has('path')) return 'pages';
  if (fn.includes('source') || fn.includes('referrer') || hs.has('source') || hs.has('referrer')) return 'sources';
  if (fn.includes('countr') || hs.has('country')) return 'countries';
  if (fn.includes('device') || hs.has('device')) return 'devices';
  if (fn.includes('browser') || hs.has('browser')) return 'browsers';
  if (fn.includes('os') || fn.includes('operat') || hs.has('operating_system') || hs.has('os')) return 'operating_systems';
  if (fn.includes('event') || fn.includes('goal') || hs.has('goal') || hs.has('event')) return 'custom_events';
  if (fn.includes('payment') || fn.includes('transaction') || fn.includes('revenue') || hs.has('amount')) return 'payments';
  if (fn.includes('visitor') || fn.includes('overview') || fn.includes('stat') || hs.has('visitors') || hs.has('sessions')) return 'visitors';

  return 'unknown';
}

function randHex(len: number): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export interface DayData {
  date: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  bounceRate: number;
  avgDuration: number;
  revenue: number; // in cents
  paymentsCount: number;
  sources: { source: string; referrer?: string; visitors: number; revenue?: number; payments?: number }[];
  pages: { page: string; visitors: number; pageviews?: number }[];
  entryPages: { page: string; visitors: number }[];
  exitPages: { page: string; visitors: number }[];
  countries: { country: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  browsers: { browser: string; visitors: number }[];
  operatingSystems: { os: string; visitors: number }[];
  goals: { name: string; visitors: number; events: number; revenue?: number }[];
  payments: { id?: string; amount: number; currency?: string; email?: string; name?: string; provider?: string }[];
}

export interface ImportPreviewSummary {
  dateRange: { from: string; to: string } | null;
  totalDays: number;
  totalVisitors: number;
  totalPageviews: number;
  totalRevenue: number;
  totalPayments: number;
  detectedFiles: { name: string; type: FileType; rowCount: number }[];
}

export interface GeneratedBatch {
  earliestTs: number;
  visitors: { site_id: string; id: string; first_seen: number; name?: string | null; email?: string | null }[];
  sessions: {
    site_id: string;
    id: string;
    visitor_id: string;
    started_at: number;
    last_seen_at: number;
    duration: number;
    pageviews: number;
    goals: number;
    hostname: string;
    entry_page: string;
    exit_page: string;
    referrer: string | null;
    referrer_domain: string | null;
    source: string;
    channel: string;
    country: string | null;
    city: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
  }[];
  events: {
    site_id: string;
    session_id: string;
    visitor_id: string;
    ts: number;
    type: 'pageview' | 'goal';
    name: string | null;
    path: string;
  }[];
  payments: {
    id: string;
    site_id: string;
    provider: string;
    ts: number;
    amount: number;
    kind: 'payment';
    currency: string;
    visitor_id: string | null;
    session_id: string | null;
    customer_id: string | null;
    email: string | null;
    name: string | null;
  }[];
}

/** Parses numeric string safely */
function toNum(v: string | undefined, defaultVal = 0): number {
  if (!v) return defaultVal;
  const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? defaultVal : n;
}

/** Converts revenue value to minor currency units (cents) */
function parseRevenueAmount(val: string | number | undefined, currency = 'USD'): number {
  if (val === undefined || val === '') return 0;
  const num = typeof val === 'number' ? val : toNum(val);
  const decimals = currencyDecimals(currency);
  return Math.round(num * Math.pow(10, decimals));
}

/** Parses date string into YYYY-MM-DD */
export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Build day-by-day aggregated map from multiple parsed CSV files */
export function aggregateDatafastFiles(
  parsedFiles: { filename: string; headers: string[]; rows: Record<string, string>[] }[],
  siteCurrency = 'USD',
): { days: Map<string, DayData>; summary: ImportPreviewSummary } {
  const days = new Map<string, DayData>();

  function getDay(dateStr: string): DayData {
    let day = days.get(dateStr);
    if (!day) {
      day = {
        date: dateStr,
        visitors: 0,
        sessions: 0,
        pageviews: 0,
        bounceRate: 0.6,
        avgDuration: 45000,
        revenue: 0,
        paymentsCount: 0,
        sources: [],
        pages: [],
        entryPages: [],
        exitPages: [],
        countries: [],
        devices: [],
        browsers: [],
        operatingSystems: [],
        goals: [],
        payments: [],
      };
      days.set(dateStr, day);
    }
    return day;
  }

  const detectedFiles: ImportPreviewSummary['detectedFiles'] = [];

  for (const { filename, headers, rows } of parsedFiles) {
    const type = detectFileType(filename, headers);
    detectedFiles.push({ name: filename, type, rowCount: rows.length });

    for (const row of rows) {
      const date = normalizeDate(row.date ?? row.timestamp ?? row.created_at ?? row.day);
      if (!date) continue;
      const day = getDay(date);

      switch (type) {
        case 'visitors': {
          const v = toNum(row.visitors ?? row.unique_visitors ?? row.users);
          const pv = toNum(row.pageviews ?? row.views);
          const sess = toNum(row.sessions, v);
          const br = toNum(row.bounce_rate);
          const dur = toNum(row.visit_duration ?? row.duration ?? row.avg_duration);
          const rev = parseRevenueAmount(row.revenue ?? row.amount, siteCurrency);
          const pay = toNum(row.payments ?? row.conversions);

          if (v > day.visitors) day.visitors = v;
          if (sess > day.sessions) day.sessions = sess;
          if (pv > day.pageviews) day.pageviews = pv;
          if (br > 0) day.bounceRate = br > 1 ? br / 100 : br;
          if (dur > 0) day.avgDuration = dur < 1000 ? dur * 1000 : dur;
          if (rev > 0) day.revenue = Math.max(day.revenue, rev);
          if (pay > 0) day.paymentsCount = Math.max(day.paymentsCount, pay);
          break;
        }

        case 'sources': {
          const srcName = row.source ?? row.referrer ?? row.name ?? 'Direct/None';
          const v = toNum(row.visitors ?? row.unique_visitors ?? row.visits, 1);
          const rev = parseRevenueAmount(row.revenue ?? row.amount, siteCurrency);
          const pay = toNum(row.payments, rev > 0 ? 1 : 0);
          day.sources.push({ source: srcName, referrer: row.referrer, visitors: v, revenue: rev, payments: pay });
          break;
        }

        case 'pages': {
          const p = row.page ?? row.path ?? row.url ?? '/';
          const v = toNum(row.visitors ?? row.unique_visitors, 1);
          const pv = toNum(row.pageviews ?? row.views, v);
          day.pages.push({ page: p.startsWith('/') ? p : '/' + p, visitors: v, pageviews: pv });
          break;
        }

        case 'entry_pages': {
          const p = row.entry_page ?? row.page ?? '/';
          const v = toNum(row.visitors, 1);
          day.entryPages.push({ page: p.startsWith('/') ? p : '/' + p, visitors: v });
          break;
        }

        case 'exit_pages': {
          const p = row.exit_page ?? row.page ?? '/';
          const v = toNum(row.visitors, 1);
          day.exitPages.push({ page: p.startsWith('/') ? p : '/' + p, visitors: v });
          break;
        }

        case 'countries': {
          const country = row.country ?? row.country_code ?? row.code ?? 'US';
          const v = toNum(row.visitors, 1);
          day.countries.push({ country, visitors: v });
          break;
        }

        case 'devices': {
          const device = row.device ?? 'Desktop';
          const v = toNum(row.visitors, 1);
          day.devices.push({ device, visitors: v });
          break;
        }

        case 'browsers': {
          const browser = row.browser ?? 'Chrome';
          const v = toNum(row.visitors, 1);
          day.browsers.push({ browser, visitors: v });
          break;
        }

        case 'operating_systems': {
          const os = row.operating_system ?? row.os ?? 'Mac OS';
          const v = toNum(row.visitors, 1);
          day.operatingSystems.push({ os, visitors: v });
          break;
        }

        case 'custom_events': {
          const goal = row.goal ?? row.event ?? row.name ?? 'goal';
          const v = toNum(row.visitors, 1);
          const events = toNum(row.events ?? row.conversions, v);
          const rev = parseRevenueAmount(row.revenue, siteCurrency);
          day.goals.push({ name: goal, visitors: v, events, revenue: rev });
          break;
        }

        case 'payments': {
          const amount = parseRevenueAmount(row.amount ?? row.revenue, row.currency ?? siteCurrency);
          day.payments.push({
            id: row.id || row.payment_id,
            amount,
            currency: row.currency || siteCurrency,
            email: row.email,
            name: row.name ?? row.customer_name,
            provider: row.provider || 'datafast',
          });
          break;
        }

        default:
          break;
      }
    }
  }

  // Calculate totals and ensure minimums
  const sortedDates = Array.from(days.keys()).sort();
  let totalVisitors = 0;
  let totalPageviews = 0;
  let totalRevenue = 0;
  let totalPayments = 0;

  for (const date of sortedDates) {
    const day = days.get(date)!;
    const sourcesTotal = day.sources.reduce((sum, s) => sum + s.visitors, 0);
    const pagesTotal = day.pages.reduce((sum, p) => sum + p.visitors, 0);

    // If day.visitors wasn't explicitly populated from visitors.csv, derive from sources or pages
    if (day.visitors === 0) {
      day.visitors = Math.max(sourcesTotal, pagesTotal, 1);
    }
    if (day.sessions === 0) {
      day.sessions = day.visitors;
    }
    if (day.pageviews === 0) {
      const pagePvTotal = day.pages.reduce((sum, p) => sum + (p.pageviews ?? p.visitors), 0);
      day.pageviews = Math.max(pagePvTotal, day.visitors);
    }

    // Revenue from payments or sources
    if (day.payments.length > 0) {
      const pSum = day.payments.reduce((sum, p) => sum + p.amount, 0);
      day.revenue = Math.max(day.revenue, pSum);
      day.paymentsCount = Math.max(day.paymentsCount, day.payments.length);
    } else if (day.sources.length > 0) {
      const srcRev = day.sources.reduce((sum, s) => sum + (s.revenue ?? 0), 0);
      const srcPay = day.sources.reduce((sum, s) => sum + (s.payments ?? 0), 0);
      if (srcRev > 0) day.revenue = Math.max(day.revenue, srcRev);
      if (srcPay > 0) day.paymentsCount = Math.max(day.paymentsCount, srcPay);
    }

    totalVisitors += day.visitors;
    totalPageviews += day.pageviews;
    totalRevenue += day.revenue;
    totalPayments += day.paymentsCount;
  }

  const summary: ImportPreviewSummary = {
    dateRange: sortedDates.length > 0 ? { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] } : null,
    totalDays: sortedDates.length,
    totalVisitors,
    totalPageviews,
    totalRevenue,
    totalPayments,
    detectedFiles,
  };

  return { days, summary };
}

/**
 * Synthesizes visitors, sessions, events, and payments from the aggregated days.
 * Breaks them into chunked batches suitable for insertion into D1 via Worker batch calls.
 */
export function generateMinilyticsImport(
  days: Map<string, DayData>,
  siteId: string,
  siteDomain: string,
  siteCurrency = 'USD',
  batchSize = 100, // sessions per batch
): GeneratedBatch[] {
  const sortedDates = Array.from(days.keys()).sort();
  const batches: GeneratedBatch[] = [];

  let currentBatch: GeneratedBatch = {
    earliestTs: Date.now(),
    visitors: [],
    sessions: [],
    events: [],
    payments: [],
  };

  function flushBatch() {
    if (currentBatch.sessions.length > 0 || currentBatch.payments.length > 0) {
      batches.push(currentBatch);
      currentBatch = {
        earliestTs: Date.now(),
        visitors: [],
        sessions: [],
        events: [],
        payments: [],
      };
    }
  }

  for (const date of sortedDates) {
    const day = days.get(date)!;
    const [year, month, dayNum] = date.split('-').map(Number);
    const dayStart = Date.UTC(year, month - 1, dayNum, 0, 0, 0);

    if (dayStart < currentBatch.earliestTs) {
      currentBatch.earliestTs = dayStart;
    }

    // Build pools for round-robin / proportional distribution
    const sourcePool: { source: string; channel: string; referrer: string | null; domain: string | null; revenue?: number }[] = [];
    if (day.sources.length > 0) {
      for (const s of day.sources) {
        const c = classify({ referrerDomain: s.referrer ?? s.source, utmSource: s.source });
        for (let i = 0; i < s.visitors; i++) {
          sourcePool.push({
            source: c.source,
            channel: c.channel,
            referrer: s.referrer ?? (c.source === 'Direct/None' ? null : `https://${s.source}`),
            domain: c.source === 'Direct/None' ? null : s.source,
            revenue: i === 0 ? s.revenue : undefined,
          });
        }
      }
    }
    // Fill remainder with Direct
    while (sourcePool.length < day.sessions) {
      sourcePool.push({ source: 'Direct/None', channel: 'Direct', referrer: null, domain: null });
    }

    const pagesPool: string[] = [];
    if (day.pages.length > 0) {
      for (const p of day.pages) {
        for (let i = 0; i < p.visitors; i++) pagesPool.push(p.page);
      }
    }
    if (pagesPool.length === 0) pagesPool.push('/');

    const entryPool: string[] = [];
    if (day.entryPages.length > 0) {
      for (const ep of day.entryPages) {
        for (let i = 0; i < ep.visitors; i++) entryPool.push(ep.page);
      }
    }

    const countryPool: string[] = [];
    if (day.countries.length > 0) {
      for (const c of day.countries) {
        for (let i = 0; i < c.visitors; i++) countryPool.push(c.country);
      }
    }

    const devicePool: string[] = [];
    if (day.devices.length > 0) {
      for (const d of day.devices) {
        for (let i = 0; i < d.visitors; i++) devicePool.push(d.device);
      }
    }

    const browserPool: string[] = [];
    if (day.browsers.length > 0) {
      for (const b of day.browsers) {
        for (let i = 0; i < b.visitors; i++) browserPool.push(b.browser);
      }
    }

    const osPool: string[] = [];
    if (day.operatingSystems.length > 0) {
      for (const o of day.operatingSystems) {
        for (let i = 0; i < o.visitors; i++) osPool.push(o.os);
      }
    }

    const totalSessions = Math.max(day.sessions, day.visitors);
    let remainingPageviews = Math.max(day.pageviews, totalSessions);

    // Track which sessions receive payments
    const pendingPayments = [...day.payments];
    // If no explicit payment objects, but day.revenue > 0, generate payments
    if (pendingPayments.length === 0 && day.revenue > 0) {
      const count = Math.max(day.paymentsCount, 1);
      const perPayment = Math.floor(day.revenue / count);
      for (let i = 0; i < count; i++) {
        pendingPayments.push({
          amount: i === count - 1 ? day.revenue - perPayment * (count - 1) : perPayment,
          currency: siteCurrency,
          provider: 'datafast',
        });
      }
    }

    for (let i = 0; i < totalSessions; i++) {
      const sid = 's_df_' + randHex(12);
      const vid = 'v_df_' + randHex(12);

      // Spread sessions across active hours (06:00 to 22:00 UTC) with slight jitter
      const timeOffset = Math.floor(6 * 3600_000 + (i / Math.max(totalSessions, 1)) * 16 * 3600_000 + Math.random() * 300_000);
      const startedAt = dayStart + Math.min(timeOffset, 86_300_000);
      const duration = Math.max(10_000, Math.floor(day.avgDuration * (0.5 + Math.random())));
      const lastSeenAt = startedAt + duration;

      const src = sourcePool[i % sourcePool.length];
      const entryPage = entryPool.length > 0 ? entryPool[i % entryPool.length] : pagesPool[i % pagesPool.length];
      const exitPage = pagesPool[(i + 1) % pagesPool.length];
      const country = countryPool.length > 0 ? countryPool[i % countryPool.length] : 'US';
      const device = devicePool.length > 0 ? devicePool[i % devicePool.length] : 'Desktop';
      const browser = browserPool.length > 0 ? browserPool[i % browserPool.length] : 'Chrome';
      const os = osPool.length > 0 ? osPool[i % osPool.length] : 'Mac OS';

      // Pageviews for this session
      const sessPvs = i === totalSessions - 1 ? remainingPageviews : Math.max(1, Math.min(remainingPageviews - (totalSessions - i - 1), Math.random() < 0.7 ? 1 : 2));
      remainingPageviews -= sessPvs;

      // Check if session has a payment
      const paymentItem = pendingPayments.shift();

      currentBatch.visitors.push({
        site_id: siteId,
        id: vid,
        first_seen: startedAt,
        name: paymentItem?.name ?? null,
        email: paymentItem?.email ?? null,
      });

      currentBatch.sessions.push({
        site_id: siteId,
        id: sid,
        visitor_id: vid,
        started_at: startedAt,
        last_seen_at: lastSeenAt,
        duration,
        pageviews: sessPvs,
        goals: 0,
        hostname: siteDomain,
        entry_page: entryPage,
        exit_page: exitPage,
        referrer: src.referrer,
        referrer_domain: src.domain,
        source: src.source,
        channel: src.channel,
        country,
        city: null,
        browser,
        os,
        device,
      });

      // Events for session
      for (let p = 0; p < sessPvs; p++) {
        const page = p === 0 ? entryPage : pagesPool[(i + p) % pagesPool.length];
        const eventTs = startedAt + Math.floor((duration / Math.max(sessPvs, 1)) * p);
        currentBatch.events.push({
          site_id: siteId,
          session_id: sid,
          visitor_id: vid,
          ts: eventTs,
          type: 'pageview',
          name: null,
          path: page,
        });
      }

      // Add payment if assigned
      if (paymentItem) {
        currentBatch.payments.push({
          id: paymentItem.id ?? 'pay_df_' + randHex(12),
          site_id: siteId,
          provider: paymentItem.provider ?? 'datafast',
          ts: lastSeenAt,
          amount: paymentItem.amount,
          kind: 'payment',
          currency: paymentItem.currency ?? siteCurrency,
          visitor_id: vid,
          session_id: sid,
          customer_id: 'cus_df_' + randHex(8),
          email: paymentItem.email ?? null,
          name: paymentItem.name ?? null,
        });
      }

      if (currentBatch.sessions.length >= batchSize) {
        flushBatch();
      }
    }

    // Assign any custom events/goals to sessions on this day
    if (day.goals.length > 0 && currentBatch.sessions.length > 0) {
      for (const goal of day.goals) {
        for (let g = 0; g < Math.min(goal.events, currentBatch.sessions.length); g++) {
          const sess = currentBatch.sessions[g];
          sess.goals++;
          currentBatch.events.push({
            site_id: siteId,
            session_id: sess.id,
            visitor_id: sess.visitor_id,
            ts: sess.started_at + Math.floor(sess.duration * 0.8),
            type: 'goal',
            name: goal.name,
            path: sess.entry_page,
          });
        }
      }
    }
  }

  flushBatch();
  return batches;
}
