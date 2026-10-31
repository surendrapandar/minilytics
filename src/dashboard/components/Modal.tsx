import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  open,
  onClose,
  children,
  width = 'max-w-2xl',
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  title?: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      if (!cardRef.current?.contains(document.activeElement)) cardRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      const focusable = cardRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) {
        e.preventDefault();
        cardRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/30 p-4 backdrop-blur-[2px] sm:p-10"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div ref={cardRef} tabIndex={-1} className={`card w-full ${width} p-0 outline-none`} onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-4 sm:px-6">
            <div className="min-w-0 text-lg font-semibold">{title}</div>
            <button className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
