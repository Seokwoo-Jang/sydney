import type { IconName } from '@/components/ui/Icon';
import { S } from '@/lib/strings';
import type { BoardSectionKey, SectionKey } from '@/lib/url';

/** Mobile bottom tabs; `prelude` lives inside the `days` tab. */
export type TabKey = Exclude<SectionKey, 'prelude'>;

/** PC TOC order follows where the sections sit on the board: Prelude is in the aside next to Budget. */
export const BOARD_ORDER: BoardSectionKey[] = ['overview', 'days', 'ready', 'wallet', 'prelude', 'journal', 'links'];

/** Mobile tab order: before → during → after the trip (plan §4.4). */
export const TAB_ORDER: TabKey[] = ['ready', 'days', 'wallet', 'links', 'journal'];

export const TAB_ICON: Record<TabKey, IconName> = {
  ready: 'checklist',
  days: 'itinerary',
  wallet: 'budget',
  links: 'library',
  journal: 'journal',
};

export const sectionId = (key: BoardSectionKey) => `section-${key}`;

export const menuLabel = (key: BoardSectionKey): string => S.sections[key].menu;

export const tabOf = (section: SectionKey): TabKey => (section === 'prelude' ? 'days' : section);
