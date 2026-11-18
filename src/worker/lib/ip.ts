/** IPv4 and IPv6 addresses and CIDR ranges as numbers, to check an address against a bot's published list. */

export interface IpRange {
  v6: boolean;
  start: bigint;
  end: bigint;
}

function parseV4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(p);
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let s = input.split('%')[0].toLowerCase();
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  if (s.includes('.')) {
    const at = s.lastIndexOf(':');
    const v4 = parseV4(s.slice(at + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, at + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const count = head.length + (tail?.length ?? 0);
  if (tail === null ? count !== 8 : count > 7) return null;
  const groups = tail === null ? head : [...head, ...Array<string>(8 - count).fill('0'), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

const MAPPED_V4 = 0xffffn << 32n;

/** An address as a number. IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as the IPv4 address. */
export function parseIp(ip: string): { v6: boolean; value: bigint } | null {
  const s = ip.trim();
  if (!s.includes(':')) {
    const v4 = parseV4(s);
    return v4 === null ? null : { v6: false, value: v4 };
  }
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { v6: false, value: v6 - MAPPED_V4 };
  return { v6: true, value: v6 };
}

/** "a.b.c.d/n", "x:y::/n" or a bare address (a range of one). */
export function parseRange(cidr: string): IpRange | null {
  const [addr, bits, extra] = cidr.trim().split('/');
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const width = ip.v6 ? 128 : 32;
  const prefix = bits === undefined ? width : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN;
  if (!(prefix >= 0 && prefix <= width)) return null;
  const hostBits = BigInt(width - prefix);
  const start = (ip.value >> hostBits) << hostBits;
  return { v6: ip.v6, start, end: start + (1n << hostBits) - 1n };
}

export function inRanges(ip: string, ranges: IpRange[]): boolean {
  const a = parseIp(ip);
  return !!a && ranges.some((r) => r.v6 === a.v6 && a.value >= r.start && a.value <= r.end);
}
