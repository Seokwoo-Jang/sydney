'use client';
// Home-screen app (plan §11.3): service worker registration, "new version"
// prompt and install hints. Nothing here touches trip data.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { publicAsset } from './url';

// ── environment ──────────────────────────────────────────────────
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

/** iPhone / iPad Safari (iPadOS reports a Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ── service worker ───────────────────────────────────────────────
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let registered = false;

/** Registers /sw.js once (production builds only, where the file exists). */
export function registerServiceWorker(): void {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (process.env.NODE_ENV !== 'production') return;
  registered = true;
  const scope = publicAsset('/');
  navigator.serviceWorker
    .register(publicAsset('/sw.js'), { scope })
    .then((reg) => {
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        const check = () => {
          // A waiting worker with a controller already in place = an update, not the first install.
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            emit();
          }
        };
        check();
        w.addEventListener('statechange', check);
      };
      track(reg.waiting);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // Look for a new deploy when the page comes back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => undefined);
      });
    })
    .catch(() => {
      registered = false;
    });
}

/** This page's registration, if any. Never waits (development has none). */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** The active registration (registers first if needed); null when none is active within `timeoutMs`. */
export async function serviceWorkerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  registerServiceWorker();
  if (process.env.NODE_ENV !== 'production' && !(await getRegistration())) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** True while a new version waits. Never reloads by itself: the user taps Refresh. */
export function useUpdateReady(): { ready: boolean; apply: () => void } {
  const ready = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => waiting !== null,
    () => false,
  );
  const apply = useCallback(() => {
    const w = waiting;
    if (!w) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    w.postMessage('SKIP_WAITING');
  }, []);
  return { ready, apply };
}

// ── install ──────────────────────────────────────────────────────
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferred = e as BeforeInstallPromptEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installListeners.forEach((l) => l());
  });
}

const DISMISS_KEY = 'sydney.installHintDismissed';

export interface InstallState {
  /** 'prompt' = Android/Chrome install button, 'ios' = Share → Add to Home Screen, null = nothing to offer. */
  mode: 'prompt' | 'ios' | null;
  /** The card was closed on this device ("Not now"); the profile menu still offers it. */
  dismissed: boolean;
  install(): Promise<void>;
  dismiss(): void;
}

export function useInstall(): InstallState {
  const hasPrompt = useSyncExternalStore(
    (cb) => {
      installListeners.add(cb);
      return () => installListeners.delete(cb);
    },
    () => deferred !== null,
    () => false,
  );
  const [env, setEnv] = useState<{ standalone: boolean; ios: boolean; dismissed: boolean } | null>(null);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Private mode: the card simply shows again.
    }
    setEnv({ standalone: isStandalone(), ios: isIOS(), dismissed });
  }, []);

  const install = useCallback(async () => {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice.catch(() => undefined);
    deferred = null;
    installListeners.forEach((l) => l());
  }, []);
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setEnv((s) => (s ? { ...s, dismissed: true } : s));
  }, []);

  const mode = !env || env.standalone ? null : hasPrompt ? 'prompt' : env.ios ? 'ios' : null;
  return { mode, dismissed: env?.dismissed ?? false, install, dismiss };
}
