import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectDropdownProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  labelledBy?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
  placeholder?: string;
}

/** Accessible, keyboard-operated select matching the website switcher's popover. */
export function SelectDropdown({
  value, options, onChange, id, ariaLabel, labelledBy, disabled = false,
  className = '', buttonClassName = '', menuClassName = '',
  align = 'left', placeholder = 'Select an option',
}: SelectDropdownProps) {
  const generatedId = useId().replace(/:/g, '-');
  const listId = `select-options-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [openAbove, setOpenAbove] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const firstEnabled = options.findIndex((option) => !option.disabled);

  function focusOption(index: number) {
    if (index < 0) return;
    optionRefs.current[index]?.focus({ preventScroll: true });
    optionRefs.current[index]?.scrollIntoView({ block: 'nearest' });
  }

  function openMenu(initialIndex = selectedIndex) {
    if (disabled || firstEnabled < 0) return;
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      const expectedHeight = Math.min(256, options.length * 40 + 8);
      const below = window.innerHeight - bounds.bottom;
      setOpenAbove(below < expectedHeight + 12 && bounds.top > below);
    }
    setOpen(true);
    // Focus after the popover has mounted.
    const index = initialIndex >= 0 && !options[initialIndex]?.disabled ? initialIndex : firstEnabled;
    requestAnimationFrame(() => focusOption(index));
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!open) return;
    function onOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onOutsidePointer);
    return () => document.removeEventListener('pointerdown', onOutsidePointer);
  }, [open]);

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowDown' ? selectedIndex : selectedIndex < 0 ? options.length - 1 : selectedIndex);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu(true);
    }
  }

  function onOptionsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    const current = enabled.findIndex((index) => optionRefs.current[index] === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      // Let the browser move focus first; onBlur will dismiss the menu.
      return;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!enabled.length) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      focusOption(enabled[next]);
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const letter = event.key.toLocaleLowerCase();
      const start = current < 0 ? 0 : current + 1;
      const match = [...enabled.slice(start), ...enabled.slice(0, start)]
        .find((index) => options[index].label.toLocaleLowerCase().startsWith(letter));
      if (match !== undefined) {
        event.preventDefault();
        focusOption(match);
      }
    }
  }

  return (
    <div className={`relative min-w-0 ${className}`} ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        title={selected?.label ?? placeholder}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`flex w-full min-w-0 items-center justify-between gap-2 text-left ${buttonClassName || 'input'}`}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-stone-400'}`}>{selected?.label ?? placeholder}</span>
        <svg className={`h-4 w-4 shrink-0 text-stone-400 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={ariaLabel || 'Choose an option'}
          aria-labelledby={labelledBy}
          onKeyDown={onOptionsKeyDown}
          className={`card dropdown-enter absolute z-50 max-h-64 min-w-full overflow-y-auto overscroll-contain p-1
            ${openAbove ? 'bottom-full mb-2' : 'top-full mt-2'}
            ${align === 'right' ? 'right-0' : 'left-0'} ${menuClassName}`}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => { optionRefs.current[index] = node; }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              title={option.label}
              disabled={option.disabled}
              tabIndex={-1}
              className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm
                outline-none transition-colors hover:bg-stone-100 focus:bg-stone-100
                focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-300
                ${value === option.value ? 'bg-stone-50 font-medium text-ink' : 'text-stone-600'}
                disabled:cursor-not-allowed disabled:opacity-40`}
              onClick={() => choose(option)}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {value === option.value && (
                <svg className="h-4 w-4 shrink-0 text-stone-700" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 8 3.2 3.2L13 4.5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
