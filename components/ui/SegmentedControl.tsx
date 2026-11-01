'use client';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Small brass dot after the label (e.g. Prelude has a plan today). */
  dot?: boolean;
  /** Screen-reader text for the dot. */
  dotLabel?: string;
}

export interface SegmentedControlProps<V extends string> {
  options: Array<SegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  /** Accessible group name. */
  label: string;
  /** `fill` stretches segments to equal widths (mobile). */
  fill?: boolean;
  size?: 'md' | 'sm';
  /** Lay the choices out as a grid with this many columns (e.g. 8 categories → 4 × 2). */
  columns?: number;
  className?: string;
}

/** Single-choice switch (radiogroup semantics, arrow keys move the choice). */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  label,
  fill,
  size = 'md',
  columns,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[styles.group, fill ? styles.fill : '', columns ? styles.grid : '', styles[size], className ?? ''].join(' ')}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
            {o.dot && (
              <span className={styles.dot}>
                {o.dotLabel && <span className="sr-only">{o.dotLabel}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}

/** Toggle chip for filters (Together / Eren / Amy, categories). */
export function Chip({ selected, onClick, children, className }: ChipProps) {
  return (
    <button type="button" aria-pressed={selected} className={[styles.chip, className ?? ''].join(' ')} onClick={onClick}>
      {children}
    </button>
  );
}

/** Row of chips with a group label. */
export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={[styles.chips, className ?? ''].join(' ')}>
      {children}
    </div>
  );
}
