import { navigate } from '../App';

/**
 * Steps back to the previous in-app page. When there is none (a bookmark, a fresh tab, a link from
 * elsewhere), going back would leave the site, so it goes to `fallback` instead.
 */
export function BackButton({ fallback = '/', label = 'Back', className = 'btn' }: { fallback?: string; label?: string; className?: string }) {
  const back = () => {
    if ((window.history.state as { app?: boolean } | null)?.app) window.history.back();
    else navigate(fallback);
  };
  return (
    <button className={className} onClick={back} aria-label="Go back" title="Go back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {label && <span>{label}</span>}
    </button>
  );
}
