/**
 * AI / search crawlers, by user agent. Order matters: the first match wins, so
 * specific agents (Claude-SearchBot, Applebot-Extended…) come before broad ones.
 *
 * Categories:
 *   answers  - fetched live because a person asked an AI a question (ChatGPT-User…)
 *   indexing - building a search index that AI answers draw on (OAI-SearchBot, Googlebot…)
 *   training - collecting data to train models (GPTBot, ClaudeBot…)
 */
export type CrawlerCategory = 'answers' | 'indexing' | 'training';

export const CRAWLER_CATEGORIES: CrawlerCategory[] = ['answers', 'indexing', 'training'];

export interface CrawlerDef {
  /** Shown in the dashboard: the product for answers, the company otherwise. */
  name: string;
  /** For the favicon. */
  domain: string;
  category: CrawlerCategory;
  match: RegExp;
}

export const CRAWLERS: CrawlerDef[] = [
  // ---- AI answers (user-triggered fetches)
  { name: 'ChatGPT', domain: 'chatgpt.com', category: 'answers', match: /ChatGPT-User/i },
  { name: 'Claude', domain: 'claude.ai', category: 'answers', match: /Claude-User|Claude-Web/i },
  { name: 'Perplexity', domain: 'perplexity.ai', category: 'answers', match: /Perplexity-User/i },
  { name: 'Gemini', domain: 'gemini.google.com', category: 'answers', match: /Gemini-Deep-Research|GoogleAgent-|Google-NotebookLM/i },
  { name: 'DuckDuckGo', domain: 'duckduckgo.com', category: 'answers', match: /DuckAssistBot/i },
  { name: 'Mistral', domain: 'mistral.ai', category: 'answers', match: /MistralAI-User/i },
  { name: 'Meta AI', domain: 'meta.ai', category: 'answers', match: /Meta-ExternalFetcher/i },
  { name: 'Amazon', domain: 'amazon.com', category: 'answers', match: /Amzn-User/i },

  // ---- Indexing (search crawlers)
  { name: 'OpenAI', domain: 'openai.com', category: 'indexing', match: /OAI-SearchBot/i },
  { name: 'Anthropic', domain: 'anthropic.com', category: 'indexing', match: /Claude-SearchBot/i },
  { name: 'Perplexity', domain: 'perplexity.ai', category: 'indexing', match: /PerplexityBot/i },
  { name: 'Amazon', domain: 'amazon.com', category: 'indexing', match: /Amzn-SearchBot/i },
  { name: 'Apple', domain: 'apple.com', category: 'training', match: /Applebot-Extended/i },
  { name: 'Apple', domain: 'apple.com', category: 'indexing', match: /Applebot/i },
  { name: 'Google', domain: 'google.com', category: 'training', match: /GoogleOther|Google-Extended/i },
  { name: 'Google', domain: 'google.com', category: 'indexing', match: /Googlebot|Google-InspectionTool/i },
  { name: 'Bing', domain: 'bing.com', category: 'indexing', match: /bingbot/i },
  { name: 'DuckDuckGo', domain: 'duckduckgo.com', category: 'indexing', match: /DuckDuckBot/i },

  // ---- Training
  { name: 'OpenAI', domain: 'openai.com', category: 'training', match: /GPTBot/i },
  { name: 'Anthropic', domain: 'anthropic.com', category: 'training', match: /ClaudeBot|anthropic-ai/i },
  { name: 'Amazon', domain: 'amazon.com', category: 'training', match: /Amazonbot/i },
  { name: 'Meta', domain: 'meta.com', category: 'training', match: /Meta-ExternalAgent|FacebookBot/i },
  { name: 'Common Crawl', domain: 'commoncrawl.org', category: 'training', match: /CCBot/i },
  { name: 'ByteDance', domain: 'bytedance.com', category: 'training', match: /Bytespider/i },
  { name: 'Cohere', domain: 'cohere.com', category: 'training', match: /cohere-ai|cohere-training-data-crawler/i },
  { name: 'Mistral', domain: 'mistral.ai', category: 'training', match: /MistralAI/i },
];

export function classifyCrawler(ua: string | null | undefined): CrawlerDef | null {
  if (!ua) return null;
  return CRAWLERS.find((c) => c.match.test(ua)) ?? null;
}

/** Favicon domain for a crawler name (names are shared across categories). */
export function crawlerDomain(name: string): string | null {
  return CRAWLERS.find((c) => c.name === name)?.domain ?? null;
}

/**
 * Cheap pre-check for the site's middleware, so it only calls Minilytics for
 * likely crawlers (every agent above matches it; browsers don't).
 */
export const CRAWLER_PREFILTER = /bot\b|bot\/|spider|crawl|-User\b|-ai\b|GoogleOther|Google-Extended|GoogleAgent|Gemini|NotebookLM|ExternalFetcher|ExternalAgent|cohere/i;
