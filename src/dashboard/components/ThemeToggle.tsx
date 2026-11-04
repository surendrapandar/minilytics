import { setTheme, useTheme, type Theme } from '../lib/theme';

const NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

const ICONS: Record<Theme, JSX.Element> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
};

/** Cycles light → dark → system. */
export function ThemeToggle({ className = 'btn h-10 w-10 px-0' }: { className?: string }) {
  const { theme } = useTheme();
  const title = `Theme: ${LABEL[theme]} (click for ${LABEL[NEXT[theme]].toLowerCase()})`;
  return (
    <button className={className} onClick={() => setTheme(NEXT[theme])} aria-label={title} title={title}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[theme]}
      </svg>
    </button>
  );
}
