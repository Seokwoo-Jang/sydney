'use client';
// Form fields. <Field> owns the label/hint/error ids; inputs inside pick them
// up from context, so every control is labelled and described.
import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { S } from '@/lib/strings';
import styles from './Field.module.css';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Error text; also sets aria-invalid on the control. */
  error?: ReactNode;
  optional?: boolean;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, optional, hideLabel, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={[styles.field, className ?? ''].join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : styles.label}>
        {label}
        {optional && <span className={styles.optional}>{S.fields.optional}</span>}
      </label>
      <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function useFieldProps(id: string | undefined, describedBy: string | undefined) {
  const ctx = useContext(FieldContext);
  return {
    id: id ?? ctx?.id,
    'aria-describedby': [ctx?.describedBy, describedBy].filter(Boolean).join(' ') || undefined,
    'aria-invalid': ctx?.invalid || undefined,
  };
}

export function TextInput({ className, id, 'aria-describedby': describedBy, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[styles.control, className ?? ''].join(' ')} {...useFieldProps(id, describedBy)} {...rest} />;
}

export function TextArea({ className, id, 'aria-describedby': describedBy, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={[styles.control, styles.textarea, className ?? ''].join(' ')}
      {...useFieldProps(id, describedBy)}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  className,
  id,
  options,
  'aria-describedby': describedBy,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  return (
    <div className={styles.selectWrap}>
      <select className={[styles.control, styles.select, className ?? ''].join(' ')} {...useFieldProps(id, describedBy)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
