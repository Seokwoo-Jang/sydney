import type { SectionLayout } from '@/lib/hooks/useLayoutMode';

/** Every section receives the layout; `board` = PC page, `tabs` = mobile/tablet tab. */
export interface SectionProps {
  layout: SectionLayout;
}
