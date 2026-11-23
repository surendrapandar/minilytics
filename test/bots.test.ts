import { describe, it, expect } from 'vitest';
import { isBot } from '../src/worker/lib/ua';
import { classifyBot } from '../src/worker/bots';

describe('bot classification', () => {
  it.each([
    ['Mozilla/5.0 (compatible; GPTBot/1.0)', 'GPTBot', 'AI training'],
    ['ChatGPT-User/1.0', 'ChatGPT-User', 'AI assistant'],
    ['Claude-User/1.0', 'Claude-User', 'AI assistant'],
    ['OAI-SearchBot/1.0', 'OAI-SearchBot', 'AI search'],
    ['PerplexityBot/1.0', 'PerplexityBot', 'AI search'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Googlebot', 'Search engine'],
    ['bingbot/2.0', 'Bingbot', 'Search engine'],
    ['Slackbot-LinkExpanding 1.0', 'Link preview', 'Preview'],
    ['AhrefsBot/7.0', 'SEO crawler', 'SEO'],
    ['SomeNewCrawler/1.0', 'Other bot', 'Other'],
  ])('classifies %s', (ua, bot, category) => {
    expect(classifyBot(ua)).toEqual({ bot, category });
  });
  it('excludes the Claude user fetcher from human analytics', () => {
    expect(isBot('Claude-User/1.0')).toBe(true);
  });
  it('does not count ordinary browsers or missing user agents', () => {
    expect(classifyBot('Mozilla/5.0 Chrome/129.0 Safari/537.36')).toBeNull();
    expect(classifyBot('')).toBeNull();
  });
});
