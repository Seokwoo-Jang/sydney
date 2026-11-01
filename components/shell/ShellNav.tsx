'use client';
// Navigation API the shell gives to every section:
//   const { goToSection, layout } = useShellNav();
//   goToSection('days', { day: '2030-12-28', item: 'it-d3-plaza' });
// Board: pushes the URL and scrolls to the section. Tabs: pushes the URL; the
// shell switches tab (and restores that tab's scroll position).
import { createContext, useContext } from 'react';
import type { SectionLayout } from '@/lib/hooks/useLayoutMode';
import type { SectionKey, UrlPatch } from '@/lib/url';

export interface ShellNavApi {
  layout: SectionLayout;
  /** `null` = overview. Clears `view` and `item` unless given in `extra`; keeps `day`. */
  goToSection(section: SectionKey | null, extra?: Omit<UrlPatch, 'section'>): void;
}

export const ShellNavContext = createContext<ShellNavApi | null>(null);

export function useShellNav(): ShellNavApi {
  const ctx = useContext(ShellNavContext);
  if (!ctx) throw new Error('useShellNav must be used inside the Shell.');
  return ctx;
}
