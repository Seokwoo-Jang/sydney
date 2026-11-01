import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

/** Porcelain surface, 20px radius, soft shadow, no thick border. */
export function Card({ className, padding = 'md', ...rest }: HTMLAttributes<HTMLDivElement> & { padding?: 'none' | 'sm' | 'md' }) {
  return <div className={[styles.card, styles[padding], className ?? ''].join(' ')} {...rest} />;
}
