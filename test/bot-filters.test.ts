import { expect, it } from 'vitest';
import { matchesPageSearch } from '../src/dashboard/lib/botFilters';
it('supports wildcard page searches and literal special characters', () => {
  expect(matchesPageSearch('/blog/intro', '/blog/*')).toBe(true);
  expect(matchesPageSearch('/docs/intro', '/blog/*')).toBe(false);
  expect(matchesPageSearch('/docs/blog/intro', '/blog/*')).toBe(false);
  expect(matchesPageSearch('/llms.txt', 'llms.txt')).toBe(true);
  expect(matchesPageSearch('/llmsXtxt', 'llms.txt')).toBe(false);
  expect(matchesPageSearch('/?ref=foo', '?ref=')).toBe(true);
  expect(matchesPageSearch('/docs', '[')).toBe(false);
  expect(matchesPageSearch('/docs', '')).toBe(true);
});
