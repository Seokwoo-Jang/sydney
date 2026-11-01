'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { useSession, useTrip } from '@/lib/data';
import { useCountdown } from '@/lib/hooks/useCountdown';
import { useCurrencyFirst } from '@/lib/hooks/useCurrencyFirst';
import { InstallMenuItem } from './InstallCard';
import type { SectionLayout } from '@/lib/hooks/useLayoutMode';
import { S } from '@/lib/strings';
import type { Currency } from '@/lib/types';
import { countdownText } from './countdownText';
import styles from './TopBar.module.css';

export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <a href="?" className={styles.brand} aria-label={`${S.brand.title} — ${S.brand.homeLabel}`} onClick={(e) => {
      e.preventDefault();
      onClick();
    }}>
      <span className={styles.brandFull} aria-hidden="true">
        {S.brand.titleLead} <em>{S.brand.titleAccent}</em>
      </span>
      <span className={styles.brandShort} aria-hidden="true">
        {S.brand.titleShortParts[0]} <em>{S.brand.titleShortParts[1]}</em> {S.brand.titleShortParts[2]}
      </span>
    </a>
  );
}

export function CountdownChip({ layout }: { layout: SectionLayout }) {
  const info = useCountdown();
  if (!info) return <span className={styles.chipPlaceholder} aria-hidden="true" />;
  const t = countdownText(info);
  const full = [t.value, t.label, t.flight].filter(Boolean).join(' · ');
  return (
    <p className={[styles.chip, layout === 'tabs' ? styles.chipCompact : ''].join(' ')} title={full}>
      <b className={styles.chipValue}>{t.value}</b>
      {layout === 'board' ? (
        (t.label || t.flight) && <span className={styles.chipLabel}>{[t.label, t.flight].filter(Boolean).join(' · ')}</span>
      ) : (
        <span className="sr-only">{[t.label, t.flight].filter(Boolean).join(' · ')}</span>
      )}
    </p>
  );
}

export function ProfileMenu({ layout }: { layout: SectionLayout }) {
  const session = useSession();
  const trip = useTrip();
  const [currencyFirst, setCurrencyFirst] = useCurrencyFirst(trip.status === 'ready' ? trip.data.trip.displayCurrencyFirst : 'AUD');
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = session.member?.displayName ?? '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session.member) return null;

  return (
    <div
      className={styles.profile}
      ref={rootRef}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {layout === 'board' && <span className={styles.welcome}>{S.profile.welcome(name)}</span>}
      <button
        ref={buttonRef}
        type="button"
        className={styles.avatar}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={S.profile.openMenu(name)}
        onClick={() => setOpen((v) => !v)}
      >
        {name.slice(0, 1)}
      </button>
      <div id={panelId} className={styles.menu} hidden={!open}>
        <p className={styles.menuTitle}>{S.profile.welcomeSentence(name)}</p>
        <div className={styles.menuGroup}>
          <p className={styles.menuLabel}>{S.profile.currency}</p>
          <SegmentedControl<Currency>
            label={S.profile.currency}
            size="sm"
            fill
            value={currencyFirst}
            onChange={setCurrencyFirst}
            options={[
              { value: 'AUD', label: S.profile.audFirst },
              { value: 'KRW', label: S.profile.krwFirst },
            ]}
          />
        </div>
        <InstallMenuItem />
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          busy={leaving}
          onClick={async () => {
            setLeaving(true);
            await session.leave();
          }}
        >
          {leaving ? S.profile.leaving : S.profile.leave}
        </Button>
      </div>
    </div>
  );
}
