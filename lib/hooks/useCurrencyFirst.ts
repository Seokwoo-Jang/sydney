'use client';
// Per-device display preference "AUD first / KRW first" (profile menu).
// Falls back to trips.display_currency_first. Not trip data, so localStorage is fine.
import { useCallback, useSyncExternalStore } from 'react';
import type { Currency } from '../types';

const KEY = 'sydney.currencyFirst';
const EVENT = 'sydney:currencyfirst';
let memory: Currency | null = null; // used when storage is blocked

function read(): Currency | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'AUD' || v === 'KRW' ? v : memory;
  } catch {
    return memory;
  }
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCurrencyFirst(tripDefault: Currency = 'AUD'): [Currency, (c: Currency) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((c: Currency) => {
    memory = c;
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      // Storage blocked: preference lasts until reload.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [stored ?? tripDefault, set];
}
