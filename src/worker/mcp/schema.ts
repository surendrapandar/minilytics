import { currencyDecimals } from '../../shared/currency';

/** The slice of JSON Schema the tool inputs use. Checked by `validate`, sent as-is in tools/list. */
export interface Schema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: readonly string[];
  pattern?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
}

/**
 * Check `value` against `schema`, returning the cleaned value or an error message the agent can act on.
 * Lenient where models commonly slip: numbers and booleans sent as strings are accepted.
 */
export function validate(schema: Schema, value: unknown, path = 'arguments'): { ok: true; value: unknown } | { ok: false; error: string } {
  const fail = (msg: string) => ({ ok: false as const, error: `${path} ${msg}` });
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return fail('must be a string');
      if (schema.enum && !schema.enum.includes(value)) return fail(`must be one of: ${schema.enum.join(', ')}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return fail(`must match ${schema.pattern}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return fail(`must be at most ${schema.maxLength} characters`);
      return { ok: true, value };
    case 'number':
    case 'integer': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail('must be a number');
      if (schema.type === 'integer' && !Number.isInteger(n)) return fail('must be a whole number');
      if (schema.minimum !== undefined && n < schema.minimum) return fail(`must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && n > schema.maximum) return fail(`must be at most ${schema.maximum}`);
      return { ok: true, value: n };
    }
    case 'boolean':
      if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
      if (typeof value !== 'boolean') return fail('must be true or false');
      return { ok: true, value };
    case 'array': {
      if (!Array.isArray(value)) return fail('must be an array');
      if (schema.minItems !== undefined && value.length < schema.minItems) return fail(`needs at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return fail(`allows at most ${schema.maxItems} items`);
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = schema.items ? validate(schema.items, value[i], `${path}[${i}]`) : { ok: true as const, value: value[i] };
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    }
    case 'object': {
      if (value === undefined || value === null) value = {};
      if (typeof value !== 'object' || Array.isArray(value)) return fail('must be an object');
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined || obj[key] === null) return fail(`is missing "${key}"`);
      }
      for (const [key, v] of Object.entries(obj)) {
        const prop = schema.properties?.[key];
        if (!prop) {
          if (schema.additionalProperties === false) {
            return fail(`has an unknown field "${key}"${schema.properties ? ` (allowed: ${Object.keys(schema.properties).join(', ')})` : ''}`);
          }
          out[key] = v;
          continue;
        }
        // Optional fields sent as null mean "not given".
        if (v === null && !schema.required?.includes(key)) continue;
        const r = validate(prop, v, `${path}.${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out };
    }
  }
}

const TIME_KEYS = new Set(['ts', 'started_at', 'last_seen_at', 'first_seen', 'last_seen', 'created_at', 'last_used_at', 'plan_until', 'from', 'to']);
const MONEY_KEYS = new Set(['revenue', 'amount', 'spent', 'revenuePerVisitor']);
const DURATION_KEYS: Record<string, string> = { duration: 'durationSeconds', avgDuration: 'avgDurationSeconds' };

/**
 * Make stored values readable for an agent: money from minor units (cents) to major units in the nearest
 * `currency`, ms timestamps to ISO 8601 (UTC), ms durations to seconds, and JSON props to objects.
 */
export function present(value: unknown, decimals = 2): unknown {
  if (Array.isArray(value)) return value.map((v) => present(v, decimals));
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const d = typeof obj.currency === 'string' && /^[A-Za-z]{3}$/.test(obj.currency) ? currencyDecimals(obj.currency) : decimals;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'decimals') continue;
    if (typeof v === 'number' && TIME_KEYS.has(k) && v > 1e11) out[k] = new Date(v).toISOString();
    else if (typeof v === 'number' && MONEY_KEYS.has(k)) out[k] = Number((v / 10 ** d).toFixed(k === 'revenuePerVisitor' ? d + 2 : d));
    else if (typeof v === 'number' && DURATION_KEYS[k]) out[DURATION_KEYS[k]] = Math.round(v / 1000);
    else if (k === 'props' && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else out[k] = present(v, d);
  }
  return out;
}
