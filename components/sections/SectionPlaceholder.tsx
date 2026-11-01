'use client';
// Temporary body for section stubs: shows the shared loading/error/empty
// states wired to the real data hook. Section builders replace it.
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import type { DataResult } from '@/lib/data';
import { S } from '@/lib/strings';
import styles from './SectionPlaceholder.module.css';

export function SectionPlaceholder<T>({
  result,
  count,
  empty,
}: {
  result: DataResult<T>;
  count: (data: T) => number;
  empty?: { title: string; actionLabel?: string };
}) {
  if (result.status === 'loading') return <LoadingState />;
  if (result.status === 'error') return <ErrorState onRetry={result.retry} />;
  if (count(result.data) === 0) return <EmptyState title={empty?.title ?? S.empty.generic} actionLabel={empty?.actionLabel} onAction={() => {}} />;
  return <p className={styles.placeholder}>{S.data.placeholder}</p>;
}
