import { createContext, useContext } from 'react';
import type { Query, Site } from './api';

export interface Dash {
  site: Site;
  q: Query;
  reloadKey: number;
  decimals: number;
  money: (minor: number, compact?: boolean) => string;
  addFilter: (key: string, value: string) => void;
  openVisitor: (visitorId: string) => void;
  /** Someone else's public site: hide anything that edits it or links to its settings. */
  readOnly: boolean;
}

export const DashContext = createContext<Dash | null>(null);

export function useDash(): Dash {
  const d = useContext(DashContext);
  if (!d) throw new Error('useDash outside dashboard');
  return d;
}
