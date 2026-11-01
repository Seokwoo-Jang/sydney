import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger' | 'onDark';
export type ButtonSize = 'md' | 'sm';

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconStart?: IconName;
  iconEnd?: IconName;
  fullWidth?: boolean;
  children?: ReactNode;
}

function classes(variant: ButtonVariant, size: ButtonSize, fullWidth: boolean | undefined, extra?: string) {
  return [styles.button, styles[variant], styles[size], fullWidth ? styles.full : '', extra ?? ''].filter(Boolean).join(' ');
}

export interface ButtonProps extends Common, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows a busy state and disables the button. */
  busy?: boolean;
}

/** Every size keeps a 44px touch target; `sm` only tightens padding and type. */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconStart,
  iconEnd,
  fullWidth,
  busy,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes(variant, size, fullWidth, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {iconStart && <Icon name={iconStart} size={size === 'sm' ? 16 : 18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={size === 'sm' ? 16 : 18} />}
    </button>
  );
}

export interface ButtonLinkProps extends Common, AnchorHTMLAttributes<HTMLAnchorElement> {
  /** External links open in a new tab with rel=noopener. */
  external?: boolean;
}

export function ButtonLink({
  variant = 'link',
  size = 'md',
  iconStart,
  iconEnd,
  fullWidth,
  external,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <a
      className={classes(variant, size, fullWidth, className)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : null)}
      {...rest}
    >
      {iconStart && <Icon name={iconStart} size={size === 'sm' ? 16 : 18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={size === 'sm' ? 16 : 18} />}
    </a>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required accessible name. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'onDark';
}

export function IconButton({ icon, label, variant = 'ghost', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={[styles.iconButton, styles[variant], className ?? ''].join(' ')} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}
