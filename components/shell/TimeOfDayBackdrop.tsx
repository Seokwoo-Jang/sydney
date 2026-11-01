'use client';
// Opera House cover that follows Sydney local time (plan §6.1).
// Static HTML: Paper placeholder (no phase). Client: phase from the
// server-corrected clock, re-checked every 30s and on visibilitychange,
// 800ms crossfade (instant with reduced motion), next phase preloaded during
// the 10 minutes before a boundary, 'Sydney · 7:42 pm' in the corner.
import { useEffect, useState, type ReactNode } from 'react';
import type { CoverPhase } from '@/lib/time/cover';
import { useCoverPhase } from '@/lib/hooks/useCoverPhase';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { S } from '@/lib/strings';
import { publicAsset } from '@/lib/url';
import styles from './TimeOfDayBackdrop.module.css';

export type BackdropVariant = 'cover' | 'hero' | 'compact' | 'entry';

const FADE_MS = 800;

// The Day photo is a 3:2 close-up: wide, short boxes (PC cover, compact tab
// covers) get a panorama with the whole building on its right edge
// (scripts/make-wide-cover.mjs) instead of a crop that cuts the sails or the wall.
const WIDE: Partial<Record<CoverPhase, true>> = { day: true };

function CoverPicture({ phase, preload, wide }: { phase: CoverPhase; preload?: boolean; wide?: boolean }) {
  const base = publicAsset(`/images/cover/${phase}`);
  const priority = preload ? 'low' : 'high';
  if (wide && WIDE[phase]) {
    return (
      <picture>
        <source type="image/avif" srcSet={`${base}-wide.avif`} />
        <img className={[styles.img, styles.wide].join(' ')} src={`${base}-wide.webp`} alt="" decoding="async" loading="eager" fetchPriority={priority} draggable={false} />
      </picture>
    );
  }
  return (
    <picture>
      <source media="(min-width: 768px)" type="image/avif" srcSet={`${base}-desktop.avif`} />
      <source media="(min-width: 768px)" type="image/webp" srcSet={`${base}-desktop.webp`} />
      <source type="image/avif" srcSet={`${base}-mobile.avif`} />
      <img
        className={styles.img}
        src={`${base}-mobile.webp`}
        alt=""
        decoding="async"
        loading="eager"
        fetchPriority={priority}
        draggable={false}
      />
    </picture>
  );
}

export interface TimeOfDayBackdropProps {
  variant: BackdropVariant;
  children?: ReactNode;
  /** Hide the 'Sydney · 7:42 pm' chip. */
  hideClock?: boolean;
  className?: string;
  /** Rendered element. Use 'header' for the page cover. */
  as?: 'div' | 'header' | 'section';
  id?: string;
  'aria-labelledby'?: string;
  /** Always this photo instead of following Sydney time (the sign-in page shows Day). */
  fixedPhase?: CoverPhase;
}

export function TimeOfDayBackdrop({ variant, children, hideClock, className, as: Tag = 'div', fixedPhase, ...rest }: TimeOfDayBackdropProps) {
  const wide = variant === 'cover' || variant === 'compact';
  const live = useCoverPhase();
  const phase = fixedPhase ?? live.phase;
  const preload = fixedPhase ? null : live.preload;
  const clock = live.clock;
  const reduced = useReducedMotion();
  // Bottom → top. The newest layer fades in over the previous one.
  const [layers, setLayers] = useState<CoverPhase[]>([]);

  useEffect(() => {
    if (!phase) return;
    setLayers((prev) => (prev[prev.length - 1] === phase ? prev : [...prev.slice(-1), phase]));
  }, [phase]);

  useEffect(() => {
    if (layers.length < 2) return;
    const t = window.setTimeout(() => setLayers((l) => l.slice(-1)), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(t);
  }, [layers, reduced]);

  return (
    <Tag className={[styles.root, styles[variant], className ?? ''].join(' ')} data-cover-phase={phase ?? undefined} {...rest}>
      <div className={styles.media} aria-hidden="true">
        {layers.map((p, i) => (
          <div
            key={p}
            className={[styles.layer, i === layers.length - 1 && layers.length > 1 ? styles.fadeIn : '', i === 0 && layers.length === 1 ? styles.first : ''].join(' ')}
            data-cover-phase={p}
          >
            <CoverPicture phase={p} wide={wide} />
          </div>
        ))}
        {preload && preload !== phase && (
          <div className={styles.preload} data-cover-phase={preload}>
            <CoverPicture phase={preload} preload wide={wide} />
          </div>
        )}
      </div>
      <div className={styles.content}>{children}</div>
      {!hideClock && clock && (
        <p className={styles.clock}>{S.cover.clock(clock)}</p>
      )}
    </Tag>
  );
}
