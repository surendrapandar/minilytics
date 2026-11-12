import { useState } from 'react';

export const SMALL_BUTTON = 'rounded-md px-2 py-0.5 text-xs font-medium transition';

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}

/** A code block with a small header bar, so the copy button never covers the code. */
export function Code({ label, children }: { label?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-night dark:ring-1 dark:ring-stone-200">
      <div className="flex items-center justify-between border-b border-night-line px-4 py-1.5">
        <span className="font-mono text-xs text-night-muted">{label}</span>
        <CopyButton text={children} className={`${SMALL_BUTTON} text-night-muted hover:bg-night-line hover:text-night-fg`} />
      </div>
      <code className="code rounded-none">{children}</code>
    </div>
  );
}

/** A single line to copy, e.g. a webhook URL. */
export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</code>
      <CopyButton text={value} className={`${SMALL_BUTTON} border border-stone-200 bg-white hover:bg-stone-100`} />
    </div>
  );
}
