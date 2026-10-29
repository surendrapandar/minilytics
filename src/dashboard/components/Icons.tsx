import { useState } from 'react';
import { persona } from '../../shared/names';
import { domainForSource } from '../../shared/sources';
import { flag } from '../lib/format';

export function Favicon({ domain, size = 18, fallback }: { domain?: string | null; size?: number; fallback?: string }) {
  const [broken, setBroken] = useState(false);
  if (!domain || broken) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded text-stone-400"
        style={{ width: size, height: size, fontSize: size * 0.8 }}
      >
        {fallback ?? <LinkIcon size={size} />}
      </span>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      width={size}
      height={size}
      className="shrink-0 rounded"
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function LinkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

export function SourceIcon({ source, domain, size }: { source: string | null; domain?: string | null; size?: number }) {
  if (!source || source === 'Direct/None') return <Favicon size={size} />;
  return <Favicon domain={domainForSource(source) ?? domain ?? (source.includes('.') ? source : null)} size={size} />;
}

const CHANNEL_EMOJI: Record<string, string> = {
  Direct: '🔗',
  'Organic Search': '🔎',
  'Organic Social': '💬',
  AI: '✨',
  Referral: '↗️',
  Email: '✉️',
  Paid: '💸',
};
export function ChannelIcon({ channel }: { channel: string | null }) {
  return <Favicon fallback={CHANNEL_EMOJI[channel ?? ''] ?? '•'} />;
}

const BROWSER_DOMAINS: Record<string, string> = {
  Chrome: 'google.com/chrome',
  'Chrome WebView': 'android.com',
  Safari: 'apple.com/safari',
  'Mobile Safari': 'apple.com/safari',
  Firefox: 'firefox.com',
  Edge: 'microsoft.com/edge',
  Opera: 'opera.com',
  'Samsung Internet': 'samsung.com',
  Brave: 'brave.com',
  Arc: 'arc.net',
  Vivaldi: 'vivaldi.com',
  Yandex: 'browser.yandex.com',
  DuckDuckGo: 'duckduckgo.com',
  Instagram: 'instagram.com',
  Facebook: 'facebook.com',
  Twitter: 'x.com',
  LinkedIn: 'linkedin.com',
  Threads: 'threads.net',
  TikTok: 'tiktok.com',
  WebKit: 'webkit.org',
};
const OS_DOMAINS: Record<string, string> = {
  'Mac OS': 'apple.com',
  iOS: 'apple.com',
  iPadOS: 'apple.com',
  Windows: 'microsoft.com',
  Android: 'android.com',
  Linux: 'kernel.org',
  'Chrome OS': 'chromeos.google',
};

export function BrowserIcon({ name, size }: { name: string | null; size?: number }) {
  return <Favicon domain={name ? BROWSER_DOMAINS[name] : null} size={size} fallback="🌐" />;
}
export function OSIcon({ name, size }: { name: string | null; size?: number }) {
  return <Favicon domain={name ? OS_DOMAINS[name] : null} size={size} fallback="💻" />;
}
export function DeviceIcon({ name, size = 18 }: { name: string | null; size?: number }) {
  return <Favicon size={size} fallback={name === 'Mobile' ? '📱' : name === 'Tablet' ? '📲' : '🖥️'} />;
}
export function Flag({ cc, size = 18 }: { cc: string | null; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.9 }}>
      {flag(cc)}
    </span>
  );
}

/** A friendly, stable avatar per visitor; matches their animal name ("brown fox" → 🦊). */
export function Avatar({ id, size = 40 }: { id: string; size?: number }) {
  const p = persona(id);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full ring-2 ring-white"
      style={{ width: size, height: size, background: p.color, fontSize: size * 0.55 }}
      title={p.name}
    >
      {p.emoji}
    </span>
  );
}
