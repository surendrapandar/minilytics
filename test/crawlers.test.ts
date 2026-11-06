import { describe, expect, it } from 'vitest';
import { classifyCrawler, CRAWLER_PREFILTER, CRAWLERS } from '../src/shared/crawlers';
import { crawlerPath } from '../src/worker/crawlers';

const UA = {
  chatgptUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  oaiSearch: 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  claudeUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  claudeSearch: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
  claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  perplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  duckAssist: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
  amazonbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
  applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('classifyCrawler', () => {
  it('splits one company across categories', () => {
    expect(classifyCrawler(UA.chatgptUser)).toMatchObject({ name: 'ChatGPT', category: 'answers' });
    expect(classifyCrawler(UA.oaiSearch)).toMatchObject({ name: 'OpenAI', category: 'indexing' });
    expect(classifyCrawler(UA.gptbot)).toMatchObject({ name: 'OpenAI', category: 'training' });
    expect(classifyCrawler(UA.claudeUser)).toMatchObject({ name: 'Claude', category: 'answers' });
    expect(classifyCrawler(UA.claudeSearch)).toMatchObject({ name: 'Anthropic', category: 'indexing' });
    expect(classifyCrawler(UA.claudebot)).toMatchObject({ name: 'Anthropic', category: 'training' });
  });
  it('recognises search and other crawlers', () => {
    expect(classifyCrawler(UA.googlebot)).toMatchObject({ name: 'Google', category: 'indexing' });
    expect(classifyCrawler(UA.bingbot)).toMatchObject({ name: 'Bing', category: 'indexing' });
    expect(classifyCrawler(UA.perplexityBot)).toMatchObject({ name: 'Perplexity', category: 'indexing' });
    expect(classifyCrawler(UA.duckAssist)).toMatchObject({ name: 'DuckDuckGo', category: 'answers' });
    expect(classifyCrawler(UA.amazonbot)).toMatchObject({ name: 'Amazon', category: 'training' });
    expect(classifyCrawler(UA.applebot)).toMatchObject({ name: 'Apple', category: 'indexing' });
  });
  it('ignores browsers', () => {
    expect(classifyCrawler(UA.chrome)).toBeNull();
    expect(classifyCrawler(UA.iphone)).toBeNull();
    expect(classifyCrawler('')).toBeNull();
  });
  it('prefilter passes every crawler and no browser', () => {
    for (const ua of Object.entries(UA)) {
      expect(CRAWLER_PREFILTER.test(ua[1]), ua[0]).toBe(classifyCrawler(ua[1]) !== null);
    }
    expect(CRAWLERS.length).toBeGreaterThan(10);
  });
});

describe('crawlerPath', () => {
  it('keeps the query but drops private params and the trailing slash', () => {
    expect(crawlerPath('/?via=app')).toBe('/?via=app');
    expect(crawlerPath('/pricing/?ref=x&email=a@b.com')).toBe('/pricing?ref=x');
    expect(crawlerPath('https://loraloop.com/blog/hello%20world')).toBe('/blog/hello world');
    expect(crawlerPath('')).toBe('/');
  });
});
