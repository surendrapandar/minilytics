import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'ml_privacy_mode';
const listeners = new Set<() => void>();
let enabled = false;
let initialized = false;

function applyToDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('privacy-mode', enabled);
}

export function initPrivacyMode() {
  if (initialized) return;
  initialized = true;
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    enabled = false;
  }
  applyToDocument();
}

export function setPrivacyMode(next: boolean) {
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Private browsing can reject writes; the toggle still works for this page.
  }
  applyToDocument();
  for (const listener of listeners) listener();
}

export function togglePrivacyMode() {
  setPrivacyMode(!enabled);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** State is module-level so every header button and blurred element reacts to the same toggle. */
export function usePrivacyMode() {
  return useSyncExternalStore(subscribe, () => enabled, () => false);
}

if (typeof window !== 'undefined') initPrivacyMode();
