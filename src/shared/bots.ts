// Shared by the worker (to recognise bots) and the dashboard (to describe them).
// AI entries follow each operator's own crawler documentation.

export type BotCategory =
  | 'AI training'
  | 'AI search'
  | 'AI assistant'
  | 'AI agent'
  | 'Search engine'
  | 'SEO'
  | 'Social preview'
  | 'Monitoring'
  | 'Automation'
  | 'Other';

/** What each kind of bot does, in one line (shown in the dashboard). */
export const CATEGORY_INFO: Record<BotCategory, string> = {
  'AI training': 'Collects pages to train AI models',
  'AI search': 'Indexes pages so AI answers can cite them',
  'AI assistant': 'Opens a page because someone asked an AI about it',
  'AI agent': 'A browser an AI drives to do tasks for someone',
  'Search engine': 'Indexes pages for search results',
  SEO: 'SEO tools auditing or tracking the site',
  'Social preview': 'Builds a link preview when the site is shared',
  Monitoring: 'Uptime and speed checks',
  Automation: 'Scripts, scrapers and headless browsers',
  Other: 'Other bots',
};

export const isAiCategory = (category: string | null | undefined) => !!category?.startsWith('AI ');

/** Published address lists a bot's IP can be checked against (URLs in worker/lib/botVerify.ts). */
export type IpListId =
  | 'openai-gptbot'
  | 'openai-searchbot'
  | 'openai-chatgpt-user'
  | 'openai-adsbot'
  | 'anthropic'
  | 'anthropic-agent'
  | 'perplexity-bot'
  | 'perplexity-user'
  | 'google-common'
  | 'google-special'
  | 'google-fetchers'
  | 'google-agents'
  | 'apple'
  | 'bing'
  | 'duckassist'
  | 'mistral-user'
  | 'mistral-index'
  | 'ccbot';

export interface BotInfo {
  name: string;
  /** Company behind it, '' for scripts and unknown bots. */
  operator: string;
  /** The operator's site, for the favicon. */
  domain: string;
  category: BotCategory;
  about: string;
  ips?: IpListId;
}

interface BotDef extends BotInfo {
  match: RegExp;
}

const OPENAI = { operator: 'OpenAI', domain: 'openai.com' };
const ANTHROPIC = { operator: 'Anthropic', domain: 'anthropic.com' };
const PERPLEXITY = { operator: 'Perplexity', domain: 'perplexity.ai' };
const GOOGLE = { operator: 'Google', domain: 'google.com' };
const META = { operator: 'Meta', domain: 'meta.com' };
const AMAZON = { operator: 'Amazon', domain: 'amazon.com' };
const MICROSOFT = { operator: 'Microsoft', domain: 'bing.com' };
const MISTRAL = { operator: 'Mistral AI', domain: 'mistral.ai' };
const SCRIPT = { operator: '', domain: '' };

/**
 * Known bots, matched against the user agent. First match wins, so more specific names come first
 * (an AI agent adds its token to a normal browser user agent, so AI entries are checked before anything else).
 */
const BOTS: BotDef[] = [
  // ---- AI: OpenAI
  { ...OPENAI, name: 'GPTBot', category: 'AI training', match: /GPTBot/i, ips: 'openai-gptbot', about: "Collects pages to train OpenAI's models" },
  { ...OPENAI, name: 'OAI-SearchBot', category: 'AI search', match: /OAI-SearchBot/i, ips: 'openai-searchbot', about: 'Indexes pages for ChatGPT search' },
  { ...OPENAI, name: 'ChatGPT-User', category: 'AI assistant', match: /ChatGPT-User/i, ips: 'openai-chatgpt-user', about: 'Opens a page when someone asks ChatGPT about it' },
  { ...OPENAI, name: 'OAI-AdsBot', category: 'Other', match: /OAI-AdsBot/i, ips: 'openai-adsbot', about: 'Checks the landing pages of ads shown in ChatGPT' },
  // ---- AI: Anthropic
  { ...ANTHROPIC, name: 'ClaudeBot', category: 'AI training', match: /ClaudeBot/i, ips: 'anthropic', about: "Collects pages to train Anthropic's Claude models" },
  { ...ANTHROPIC, name: 'Claude-SearchBot', category: 'AI search', match: /Claude-SearchBot/i, ips: 'anthropic', about: 'Indexes pages so Claude can cite them in answers' },
  { ...ANTHROPIC, name: 'Claude-User', category: 'AI assistant', match: /Claude-User/i, ips: 'anthropic', about: 'Opens a page when someone asks Claude about it' },
  { ...ANTHROPIC, name: 'Claude-Agent', category: 'AI agent', match: /Claude-Agent/i, ips: 'anthropic-agent', about: 'A browser Claude drives to do tasks for someone' },
  { ...ANTHROPIC, name: 'anthropic-ai', category: 'AI training', match: /anthropic-ai|claude-web/i, about: 'An older Anthropic crawler name (now ClaudeBot)' },
  // ---- AI: Perplexity
  { ...PERPLEXITY, name: 'PerplexityBot', category: 'AI search', match: /PerplexityBot/i, ips: 'perplexity-bot', about: 'Indexes pages for Perplexity answers' },
  { ...PERPLEXITY, name: 'Perplexity-User', category: 'AI assistant', match: /Perplexity-User/i, ips: 'perplexity-user', about: 'Opens a page when someone asks Perplexity about it' },
  // ---- AI: Google (Gemini and AI Overviews read the Googlebot index, see Search engines)
  { ...GOOGLE, name: 'Google-Agent', category: 'AI agent', match: /Google-Agent/i, ips: 'google-agents', about: "A browser Google's AI agents drive for someone" },
  { ...GOOGLE, name: 'Google NotebookLM', category: 'AI assistant', match: /Google-(?:NotebookLM|GeminiNotebook)/i, ips: 'google-fetchers', about: 'Reads a page someone added as a NotebookLM source' },
  { ...GOOGLE, name: 'Gemini Deep Research', category: 'AI assistant', match: /Gemini-Deep-Research/i, about: 'Reads pages for a Gemini Deep Research report' },
  { ...GOOGLE, name: 'Google-CloudVertexBot', category: 'AI search', match: /Google-CloudVertexBot/i, ips: 'google-common', about: 'Crawls sites their owners connected to a Vertex AI agent' },
  // ---- AI: Meta
  { ...META, name: 'Meta-ExternalAgent', category: 'AI training', match: /meta-externalagent/i, about: "Collects pages to train Meta's AI models" },
  { ...META, name: 'Meta-WebIndexer', category: 'AI search', match: /meta-webindexer/i, about: 'Indexes pages so Meta AI can cite them' },
  { ...META, name: 'Meta-ExternalFetcher', category: 'AI assistant', match: /meta-externalfetcher/i, about: 'Opens a page when someone asks Meta AI about it' },
  { ...META, name: 'FacebookBot', category: 'AI training', match: /FacebookBot/i, about: 'Meta crawler used to train AI speech models' },
  // ---- AI: Amazon
  { ...AMAZON, name: 'Amazonbot', category: 'AI training', match: /Amazonbot/i, about: "Crawls for Alexa and other Amazon services; may train Amazon's AI" },
  { ...AMAZON, name: 'Amzn-SearchBot', category: 'AI search', match: /Amzn-SearchBot/i, about: 'Indexes pages for Amazon search experiences' },
  { ...AMAZON, name: 'Amzn-User', category: 'AI assistant', match: /Amzn-User/i, about: 'Opens a page when someone asks Alexa about it' },
  // ---- AI: everyone else
  { operator: 'ByteDance', domain: 'bytedance.com', name: 'Bytespider', category: 'AI training', match: /Bytespider/i, about: 'ByteDance (TikTok) crawler that collects AI training data' },
  { operator: 'Common Crawl', domain: 'commoncrawl.org', name: 'CCBot', category: 'AI training', match: /CCBot/i, ips: 'ccbot', about: 'Builds the open web archive most AI models are trained on' },
  { operator: 'DuckDuckGo', domain: 'duckduckgo.com', name: 'DuckAssistBot', category: 'AI search', match: /DuckAssistBot/i, ips: 'duckassist', about: "Fetches pages for DuckDuckGo's AI answers" },
  { ...MISTRAL, name: 'MistralAI-User', category: 'AI assistant', match: /MistralAI-User/i, ips: 'mistral-user', about: 'Opens a page when someone asks Le Chat about it' },
  { ...MISTRAL, name: 'MistralAI-Index', category: 'AI search', match: /MistralAI-Index/i, ips: 'mistral-index', about: 'Indexes pages for Le Chat answers' },
  { ...MISTRAL, name: 'MistralAI-Training', category: 'AI training', match: /MistralAI-Training/i, about: "Collects pages to train Mistral's models" },
  { operator: 'Cohere', domain: 'cohere.com', name: 'cohere-ai', category: 'AI training', match: /cohere-ai|cohere-training-data-crawler/i, about: "Collects pages for Cohere's models" },
  { operator: 'You.com', domain: 'you.com', name: 'YouBot', category: 'AI search', match: /YouBot/i, about: "Indexes pages for You.com's AI search" },
  { operator: 'Diffbot', domain: 'diffbot.com', name: 'Diffbot', category: 'AI training', match: /Diffbot/i, about: 'Extracts page data into a knowledge graph sold to AI companies' },
  { operator: 'Allen Institute for AI', domain: 'allenai.org', name: 'AI2Bot', category: 'AI training', match: /AI2Bot/i, about: 'Collects pages to train open AI models' },
  { operator: 'Timpi', domain: 'timpi.io', name: 'Timpibot', category: 'AI training', match: /Timpibot/i, about: 'Collects pages for an AI search index' },
  { operator: 'Huawei', domain: 'huawei.com', name: 'PanguBot', category: 'AI training', match: /PanguBot/i, about: "Collects pages to train Huawei's Pangu models" },
  { operator: 'Webz.io', domain: 'webz.io', name: 'Omgilibot', category: 'AI training', match: /omgili/i, about: 'Collects pages for a data feed sold to AI companies' },

  // ---- Search engines
  { ...GOOGLE, name: 'Google-InspectionTool', category: 'SEO', match: /Google-InspectionTool/i, ips: 'google-common', about: "Search Console's live page test" },
  { ...GOOGLE, name: 'GoogleOther', category: 'Other', match: /GoogleOther/i, ips: 'google-common', about: "Google's general crawler for research and product teams" },
  { ...GOOGLE, name: 'Google AdsBot', category: 'Other', match: /AdsBot-Google/i, ips: 'google-special', about: 'Checks the landing pages of Google Ads' },
  { ...GOOGLE, name: 'Google AdSense', category: 'Other', match: /Mediapartners-Google/i, ips: 'google-special', about: 'Picks which AdSense ads fit a page' },
  { ...GOOGLE, name: 'Storebot-Google', category: 'Search engine', match: /Storebot-Google/i, about: 'Checks product pages for Google Shopping' },
  { ...GOOGLE, name: 'Google Feedfetcher', category: 'Other', match: /FeedFetcher-Google/i, about: 'Reads RSS feeds for Google News and Podcasts' },
  { ...GOOGLE, name: 'Googlebot', category: 'Search engine', match: /Googlebot/i, ips: 'google-common', about: 'Indexes pages for Google Search, AI Overviews and Gemini' },
  { ...MICROSOFT, name: 'Bingbot', category: 'Search engine', match: /bingbot|msnbot|BingPreview|adidxbot/i, ips: 'bing', about: 'Indexes pages for Bing and Microsoft Copilot' },
  { operator: 'Apple', domain: 'apple.com', name: 'Applebot', category: 'Search engine', match: /Applebot/i, ips: 'apple', about: "Indexes pages for Siri, Spotlight and Safari; may train Apple's AI" },
  { operator: 'DuckDuckGo', domain: 'duckduckgo.com', name: 'DuckDuckBot', category: 'Search engine', match: /DuckDuckBot/i, about: 'Indexes pages for DuckDuckGo search' },
  { operator: 'Yandex', domain: 'yandex.com', name: 'YandexBot', category: 'Search engine', match: /Yandex/i, about: 'Indexes pages for Yandex search' },
  { operator: 'Baidu', domain: 'baidu.com', name: 'Baiduspider', category: 'Search engine', match: /Baiduspider/i, about: 'Indexes pages for Baidu search' },
  { operator: 'Sogou', domain: 'sogou.com', name: 'Sogou', category: 'Search engine', match: /Sogou.*spider/i, about: 'Indexes pages for Sogou search' },
  { operator: 'Yahoo', domain: 'yahoo.com', name: 'Yahoo Slurp', category: 'Search engine', match: /Slurp/i, about: 'Indexes pages for Yahoo search' },
  { operator: 'Seznam', domain: 'seznam.cz', name: 'SeznamBot', category: 'Search engine', match: /SeznamBot/i, about: 'Indexes pages for Seznam search' },
  { operator: 'Naver', domain: 'naver.com', name: 'Yeti', category: 'Search engine', match: /Yeti\//i, about: 'Indexes pages for Naver search' },
  { operator: 'Huawei', domain: 'huawei.com', name: 'PetalBot', category: 'Search engine', match: /PetalBot/i, about: 'Indexes pages for Petal search' },
  { operator: 'Mojeek', domain: 'mojeek.com', name: 'MojeekBot', category: 'Search engine', match: /MojeekBot/i, about: 'Indexes pages for Mojeek search' },
  { operator: 'Qwant', domain: 'qwant.com', name: 'Qwantbot', category: 'Search engine', match: /Qwantbot|Qwantify/i, about: 'Indexes pages for Qwant search' },

  // ---- SEO tools
  { operator: 'Ahrefs', domain: 'ahrefs.com', name: 'AhrefsBot', category: 'SEO', match: /Ahrefs/i, about: 'Maps backlinks and keywords for Ahrefs' },
  { operator: 'Semrush', domain: 'semrush.com', name: 'SemrushBot', category: 'SEO', match: /Semrush|SiteAuditBot|SplitSignalBot/i, about: 'Maps backlinks and keywords for Semrush' },
  { operator: 'Majestic', domain: 'majestic.com', name: 'MJ12bot', category: 'SEO', match: /MJ12bot/i, about: 'Maps backlinks for Majestic' },
  { operator: 'Moz', domain: 'moz.com', name: 'DotBot', category: 'SEO', match: /DotBot|rogerbot/i, about: 'Maps backlinks for Moz' },
  { operator: 'Screaming Frog', domain: 'screamingfrog.co.uk', name: 'Screaming Frog', category: 'SEO', match: /Screaming Frog/i, about: 'An SEO site audit someone ran' },
  { operator: 'WebMeUp', domain: 'webmeup.com', name: 'BLEXBot', category: 'SEO', match: /BLEXBot/i, about: 'Maps backlinks for SEO tools' },
  { operator: 'DataForSEO', domain: 'dataforseo.com', name: 'DataForSeoBot', category: 'SEO', match: /DataForSeoBot/i, about: 'Maps backlinks for DataForSEO' },
  { operator: 'Serpstat', domain: 'serpstat.com', name: 'serpstatbot', category: 'SEO', match: /serpstatbot/i, about: 'Maps backlinks for Serpstat' },
  { operator: 'Babbar', domain: 'babbar.tech', name: 'Barkrowler', category: 'SEO', match: /Barkrowler/i, about: 'Maps backlinks for Babbar' },

  // ---- Link previews
  { ...META, name: 'Facebook preview', category: 'Social preview', match: /facebookexternalhit|facebookcatalog/i, about: 'Builds a preview when a link is shared on Facebook, Instagram, Messenger or WhatsApp' },
  { operator: 'X', domain: 'x.com', name: 'Twitterbot', category: 'Social preview', match: /Twitterbot/i, about: 'Builds a preview when a link is shared on X' },
  { operator: 'LinkedIn', domain: 'linkedin.com', name: 'LinkedInBot', category: 'Social preview', match: /LinkedInBot/i, about: 'Builds a preview when a link is shared on LinkedIn' },
  { operator: 'Slack', domain: 'slack.com', name: 'Slackbot', category: 'Social preview', match: /Slackbot|Slack-ImgProxy/i, about: 'Builds a preview when a link is shared on Slack' },
  { operator: 'Discord', domain: 'discord.com', name: 'Discordbot', category: 'Social preview', match: /Discordbot/i, about: 'Builds a preview when a link is shared on Discord' },
  { operator: 'Telegram', domain: 'telegram.org', name: 'TelegramBot', category: 'Social preview', match: /TelegramBot/i, about: 'Builds a preview when a link is shared on Telegram' },
  { operator: 'WhatsApp', domain: 'whatsapp.com', name: 'WhatsApp', category: 'Social preview', match: /WhatsApp/i, about: 'Builds a preview when a link is shared on WhatsApp' },
  { operator: 'Pinterest', domain: 'pinterest.com', name: 'Pinterestbot', category: 'Social preview', match: /Pinterestbot|Pinterest\/0\./i, about: 'Reads pages pinned on Pinterest' },
  { operator: 'Reddit', domain: 'reddit.com', name: 'Redditbot', category: 'Social preview', match: /redditbot/i, about: 'Builds a preview when a link is shared on Reddit' },
  { operator: 'Microsoft', domain: 'skype.com', name: 'Skype preview', category: 'Social preview', match: /SkypeUriPreview/i, about: 'Builds a preview when a link is shared on Skype or Teams' },
  { operator: 'Mastodon', domain: 'joinmastodon.org', name: 'Mastodon', category: 'Social preview', match: /Mastodon\//i, about: 'Builds a preview when a link is shared on Mastodon' },
  { operator: 'Bluesky', domain: 'bsky.app', name: 'Bluesky', category: 'Social preview', match: /Bluesky|Cardyb/i, about: 'Builds a preview when a link is shared on Bluesky' },
  { operator: 'Embedly', domain: 'embed.ly', name: 'Embedly', category: 'Social preview', match: /Embedly/i, about: 'Builds link previews for other apps' },
  { operator: 'Iframely', domain: 'iframely.com', name: 'Iframely', category: 'Social preview', match: /Iframely/i, about: 'Builds link previews for other apps' },
  { operator: 'Quora', domain: 'quora.com', name: 'Quora preview', category: 'Social preview', match: /Quora Link Preview/i, about: 'Builds a preview when a link is shared on Quora' },
  { operator: 'VK', domain: 'vk.com', name: 'vkShare', category: 'Social preview', match: /vkShare/i, about: 'Builds a preview when a link is shared on VK' },

  // ---- Monitoring
  { operator: 'Vercel', domain: 'vercel.com', name: 'Vercel', category: 'Monitoring', match: /vercel/i, about: 'Screenshots and checks from Vercel deployments' },
  { operator: 'UptimeRobot', domain: 'uptimerobot.com', name: 'UptimeRobot', category: 'Monitoring', match: /UptimeRobot/i, about: 'Uptime checks' },
  { operator: 'Pingdom', domain: 'pingdom.com', name: 'Pingdom', category: 'Monitoring', match: /Pingdom/i, about: 'Uptime checks' },
  { operator: 'StatusCake', domain: 'statuscake.com', name: 'StatusCake', category: 'Monitoring', match: /StatusCake/i, about: 'Uptime checks' },
  { operator: 'Better Stack', domain: 'betterstack.com', name: 'Better Stack', category: 'Monitoring', match: /Better ?(?:Uptime|Stack)/i, about: 'Uptime checks' },
  { operator: 'Site24x7', domain: 'site24x7.com', name: 'Site24x7', category: 'Monitoring', match: /Site24x7/i, about: 'Uptime checks' },
  { operator: 'Checkly', domain: 'checklyhq.com', name: 'Checkly', category: 'Monitoring', match: /Checkly/i, about: 'Uptime and browser checks' },
  { operator: 'Datadog', domain: 'datadoghq.com', name: 'Datadog', category: 'Monitoring', match: /Datadog/i, about: 'Synthetic monitoring checks' },
  { ...GOOGLE, name: 'Lighthouse', category: 'Monitoring', match: /Lighthouse|PageSpeed/i, about: 'A PageSpeed / Lighthouse speed test' },
  { operator: 'GTmetrix', domain: 'gtmetrix.com', name: 'GTmetrix', category: 'Monitoring', match: /GTmetrix/i, about: 'A speed test someone ran' },
  { ...SCRIPT, name: 'Uptime monitor', category: 'Monitoring', match: /uptime|monitor|health-?check/i, about: 'An uptime or health check' },

  // ---- Scripts, scrapers and headless browsers (often someone's own bot)
  { ...SCRIPT, name: 'Headless Chrome', category: 'Automation', match: /HeadlessChrome/i, about: 'Chrome driven by a script (Puppeteer, Playwright…)' },
  { ...SCRIPT, name: 'PhantomJS', category: 'Automation', match: /PhantomJS/i, about: 'A scripted headless browser' },
  { ...SCRIPT, name: 'Browser automation', category: 'Automation', match: /Selenium|Puppeteer|Playwright|webdriver|headless/i, about: 'A browser driven by a script' },
  { ...SCRIPT, name: 'Security scanner', category: 'Automation', match: /zgrab|nuclei|masscan|Nmap|sqlmap|nikto|WPScan/i, about: 'Probes the site for weaknesses' },
  { ...SCRIPT, name: 'Scrapy', category: 'Automation', match: /Scrapy/i, about: 'A Python scraper' },
  { ...SCRIPT, name: 'curl', category: 'Automation', match: /\bcurl\//i, about: 'A command-line request' },
  { ...SCRIPT, name: 'Wget', category: 'Automation', match: /Wget/i, about: 'A command-line download' },
  { ...SCRIPT, name: 'Python script', category: 'Automation', match: /python|aiohttp|httpx/i, about: 'A Python program (requests, httpx, aiohttp…)' },
  { ...SCRIPT, name: 'Node.js script', category: 'Automation', match: /node-fetch|undici|axios|\bgot\b|^node$|\bnode(?:\.js)?\//i, about: 'A Node.js program (fetch, axios…)' },
  { ...SCRIPT, name: 'Go program', category: 'Automation', match: /Go-http-client/i, about: 'A program written in Go' },
  { ...SCRIPT, name: 'Java program', category: 'Automation', match: /Java\/|Apache-HttpClient|okhttp/i, about: 'A program written in Java or Kotlin' },
  { ...SCRIPT, name: 'Ruby script', category: 'Automation', match: /\bRuby\b|Faraday/i, about: 'A Ruby program' },
  { ...SCRIPT, name: 'PHP script', category: 'Automation', match: /GuzzleHttp|\bPHP\//i, about: 'A PHP program' },
  { ...SCRIPT, name: 'HTTP library', category: 'Automation', match: /httpclient|http\.rb|reqwest|hackney|libcurl/i, about: 'A program using an HTTP library' },
  { ...SCRIPT, name: 'Perl script', category: 'Automation', match: /libwww-perl/i, about: 'A Perl program' },
  { operator: 'Postman', domain: 'postman.com', name: 'Postman', category: 'Automation', match: /PostmanRuntime/i, about: 'An API request someone sent by hand' },
  { operator: 'Insomnia', domain: 'insomnia.rest', name: 'Insomnia', category: 'Automation', match: /insomnia/i, about: 'An API request someone sent by hand' },
  { operator: 'Internet Archive', domain: 'archive.org', name: 'Internet Archive', category: 'Other', match: /ia_archiver|archive\.org_bot|Wayback/i, about: 'Saves pages to the Wayback Machine' },
];

/** Agents that sign their requests (Web Bot Auth), by the host of their Signature-Agent key directory. */
export const SIGNED_AGENTS: Record<string, BotInfo> = {
  'chatgpt.com': { ...OPENAI, name: 'ChatGPT agent', category: 'AI agent', about: 'A browser ChatGPT drives to do tasks for someone' },
  'agent.bot.goog': BOTS.find((b) => b.name === 'Google-Agent')!,
  'you.com': BOTS.find((b) => b.name === 'YouBot')!,
};

const HEADLESS: BotInfo = { ...SCRIPT, name: 'Headless browser', category: 'Automation', about: 'A browser driven by a script (it reports navigator.webdriver)' };
const NO_UA: BotInfo = { ...SCRIPT, name: 'No user agent', category: 'Automation', about: 'A request that sent no user agent at all, almost always a script' };

/** Anything that calls itself a bot, crawler or spider but isn't in the list above (CUBOT is a phone brand). */
const GENERIC = /(?<!cu)bot\b|(?<!cu)bot\/|crawl|spider|slurp|scrap|fetch|preview|archiv/i;

function genericName(ua: string): string {
  const m = /([a-z][\w.-]*?(?:bot|crawler|spider|scraper|fetcher))(?=[\s/;)+,_-]|$)/i.exec(ua);
  return m && m[1].length > 3 ? m[1].slice(0, 40) : 'Unknown bot';
}

/** The host of the key directory a Signature-Agent header points to (both the current and the legacy form). */
export function signerHost(header: string | null | undefined): string | null {
  const m = header ? /"https:\/\/([a-z0-9.-]+)/i.exec(header) : null;
  return m ? m[1].toLowerCase() : null;
}

/**
 * Which bot sent this request, or null for a person. A known signer wins over the user agent (ChatGPT agent
 * sometimes uses a plain script user agent but always signs); `automated` is the browser's navigator.webdriver.
 */
export function identifyBot(ua: string, signals: { signatureAgent?: string | null; automated?: boolean } = {}): BotInfo | null {
  const signer = signerHost(signals.signatureAgent);
  if (signer && SIGNED_AGENTS[signer]) return SIGNED_AGENTS[signer];
  const known = BOTS.find((b) => b.match.test(ua));
  if (known) return known;
  if (signer) return { name: signer, operator: signer, domain: signer, category: 'AI agent', about: 'An agent that signs its requests' };
  if (signals.automated) return HEADLESS;
  if (!ua.trim()) return NO_UA;
  if (GENERIC.test(ua)) return { ...SCRIPT, name: genericName(ua), category: 'Other', about: 'A bot that names itself but isn’t in the list of known bots' };
  return null;
}

const BY_NAME = new Map<string, BotInfo>([...BOTS, ...Object.values(SIGNED_AGENTS), HEADLESS, NO_UA].map((b) => [b.name, b]));

/** Details of a bot by the name stored with its hits. */
export function botInfo(name: string | null | undefined): BotInfo | undefined {
  return name ? BY_NAME.get(name) : undefined;
}

/** An operator's site (for its favicon), e.g. "OpenAI" → "openai.com". */
export function operatorDomain(operator: string | null | undefined): string | undefined {
  return operator ? (BOTS.find((b) => b.operator === operator)?.domain ?? (operator.includes('.') ? operator : undefined)) : undefined;
}

/**
 * Short pre-filters for the server snippets: a request matching one of these (or carrying a Signature-Agent
 * header) is worth reporting. They only need to catch every bot above; Minilytics decides what each one is.
 */
export const BOT_HINT =
  /bot|crawl|spider|slurp|scrap|fetch|preview|archiv|agent|headless|phantom|selenium|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|monitor|uptime|pingdom|statuscake|checkly|datadog|site24x7|health|curl|wget|python|httpx|java\/|okhttp|httpclient|go-http|node|undici|axios|\bgot\b|ruby|faraday|php|perl|http\.rb|reqwest|hackney|libcurl|postman|insomnia|scrapy|zgrab|nuclei|masscan|nmap|sqlmap|nikto|wpscan|facebookexternalhit|facebookcatalog|meta-|whatsapp|telegram|discord|slack|skype|pinterest|embedly|iframely|quora|vkshare|mastodon|bluesky|cardyb|gpt|claude|anthropic|perplexity|cohere|mistral|amzn|google|bing|yandex|baidu|sogou|seznam|yeti|qwant|mojeek|ahrefs|semrush|screaming frog|vercel|omgili|wayback/i;

/** Only the AI crawlers, assistants and agents, for sites that want to send as little as possible. */
export const AI_BOT_HINT =
  /gpt|oai-|claude|anthropic|perplexity|google-agent|notebooklm|geminin?otebook|gemini-deep|cloudvertex|meta-external|meta-webindexer|facebookbot|amazonbot|amzn-|bytespider|ccbot|duckassist|mistralai|cohere|youbot|diffbot|ai2bot|timpibot|pangubot|omgili/i;
