'use client';
// Registers the service worker, offers "Refresh" when a new deploy is waiting,
// and shows pushes that arrive while the app is open as a toast (plan §8.5, §11.3).
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui';
import { registerServiceWorker, useUpdateReady } from '@/lib/pwa';
import { S } from '@/lib/strings';

export function PwaManager() {
  const toast = useToast();
  const { ready, apply } = useUpdateReady();
  const shown = useRef(false);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!ready || shown.current) return;
    shown.current = true;
    // Never reloads by itself, so a half-written entry is not lost (plan §11.3).
    toast.show(S.pwa.updateReady, { action: { label: S.pwa.refresh, onClick: apply }, duration: 10 * 60_000 });
  }, [ready, apply, toast]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; title?: string; body?: string; url?: string } | null;
      if (d?.type !== 'push') return;
      const url = d.url;
      toast.show([d.title, d.body].filter(Boolean).join(' · '), url ? { action: { label: S.actions.open, onClick: () => window.location.assign(url) } } : undefined);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [toast]);

  return null;
}
