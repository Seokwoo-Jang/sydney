'use client';
// Form draft that resets only when a sheet opens or switches record — never
// when the record changes underneath (a remote edit must not wipe the draft).
import { useCallback, useState } from 'react';

export function useDraft<T extends object>(open: boolean, id: string | null, init: () => T) {
  const [s, setS] = useState(() => ({ open, id, value: init() }));
  let current = s;
  if (open && (!s.open || s.id !== id)) {
    current = { open, id, value: init() };
    setS(current);
  } else if (!open && s.open) {
    current = { ...s, open: false };
    setS(current);
  }
  const patch = useCallback((p: Partial<T>) => setS((prev) => ({ ...prev, value: { ...prev.value, ...p } })), []);
  const replace = useCallback((value: T) => setS((prev) => ({ ...prev, value })), []);
  return [current.value, patch, replace] as const;
}
