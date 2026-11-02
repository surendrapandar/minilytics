export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth')) {
    window.dispatchEvent(new Event('ml:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  timezone: string;
  currency: string;
  api_key: string;
  dodo_webhook_secret: string | null;
  dodo_product_ids?: string | null;
  stripe_webhook_secret?: string | null;
  created_at: number;
  visitors24h?: number;
  online?: number;
}

export interface SiteSpark {
  id: string;
  visitors: number;
  revenue: number;
  online: number;
  series: { visitors: number; revenue: number }[];
}

export interface Kpis {
  visitors: number;
  sessions: number;
  pageviews: number;
  bounceRate: number;
  avgDuration: number;
  revenue: number;
  payments: number;
  customers: number;
  conversionRate: number;
  revenuePerVisitor: number;
}

export interface Overview {
  range: { from: number; to: number; granularity: 'hour' | 'day' | 'week' | 'month' };
  currency: string;
  decimals: number;
  current: Kpis;
  previous: Kpis;
  online: number;
  series: { bucket: string; visitors: number; pageviews: number; revenue: number; payments: number }[];
}

export interface BreakdownRow {
  label: string | null;
  visitors: number;
  pageviews?: number;
  revenue: number;
  customers: number;
  extra?: string | null;
}

export type Filters = Record<string, string>;

export interface Query {
  period: string;
  from?: string;
  to?: string;
  granularity?: string;
  filters: Filters;
}

export function qs(q: Query, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  p.set('period', q.period);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.granularity) p.set('granularity', q.granularity);
  if (Object.keys(q.filters).length) p.set('filters', JSON.stringify(q.filters));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export interface Me {
  loggedIn: boolean;
  hosted: boolean;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    avatar: string | null;
    admin: boolean;
    paid: boolean;
    plan_status: string;
    plan_until: number | null;
    plan: string | null;
  } | null;
}

export interface PlanInfo {
  hosted: boolean;
  price: string;
  interval: string;
  spots: number;
  spotsLeft: number | null;
  nextPrice: string | null;
  /** Earlier prices whose spots are all sold, oldest first. */
  soldOut?: { price: string; spots: number }[];
  checkout: boolean;
  supportEmail: string | null;
  /** Monthly subscription offered next to the main plan, when configured. */
  monthly?: { price: string } | null;
}
