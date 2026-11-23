/** Search is literal except for *, which matches any run of characters. */
export function matchesPageSearch(path: string, query: string): boolean {
  if (!query.trim()) return true;
  const escaped = query.trim().split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(query.includes('*') ? `^${escaped}$` : escaped, 'i').test(path);
}
