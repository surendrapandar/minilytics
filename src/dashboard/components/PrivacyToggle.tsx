import { togglePrivacyMode, usePrivacyMode } from '../lib/privacy';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.06 12.35a1 1 0 0 1 0-.7C3.66 8.1 7.5 5 12 5s8.34 3.1 9.94 6.65a1 1 0 0 1 0 .7C20.34 15.9 16.5 19 12 19s-8.34-3.1-9.94-6.65Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
}

/** Eye button shared by every dashboard header: blurs the logo and site addresses for screenshots. */
export function PrivacyToggle({ className = 'btn h-11 w-11 justify-center px-0' }: { className?: string }) {
  const on = usePrivacyMode();
  return (
    <button
      type="button"
      className={`${className}${on ? ' btn-privacy-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Turn off privacy mode' : 'Turn on privacy mode, blurring the logo and site addresses'}
      title={on ? 'Privacy mode on — click to show names' : 'Privacy mode: blur the logo and site addresses for screenshots'}
      onClick={togglePrivacyMode}
    >
      <EyeIcon off={on} />
    </button>
  );
}
