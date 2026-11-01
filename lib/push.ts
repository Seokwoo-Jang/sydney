'use client';
// Web Push on this browser (plan §8.5): support checks, permission (asked only
// from a click), subscribe / unsubscribe with the app's VAPID key. Saving goes
// through the data layer (usePushDevices().save), passed in by the caller.
// Nothing here reads trip data.
import type { PushSubscriptionInput } from './data/repository';
import { getRegistration, isIOS, isStandalone, serviceWorkerReady } from './pwa';
import { S } from './strings';
import type { PushKind } from './types';

/** Public half of the VAPID pair (uncompressed P-256 point, base64url). The private half lives only in Supabase secrets. */
export const VAPID_PUBLIC_KEY = 'BJc6ADvIsAq09AL7hoNfQ1jrBdpYjvDTqOMSTvvzlipmMVnbpMdvph87RFb8NvkjB0EO8cvBHB2dq_xJJFjelmk';

/** Order of the per-device switches; all on for a new device. */
export const PUSH_KINDS: readonly PushKind[] = ['schedule', 'flights_car', 'partner_updates', 'countdown'];

// ── base64url ────────────────────────────────────────────────────
export function toBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── environment ──────────────────────────────────────────────────
/**
 * `home_screen`: iPhone/iPad outside the home-screen app (iOS 16.4+ allows push
 * only there). `ios_update`: the home-screen app on an older iOS.
 */
export type PushSupport = 'supported' | 'home_screen' | 'ios_update' | 'unsupported';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const apis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIOS()) {
    if (!isStandalone()) return 'home_screen';
    return apis ? 'supported' : 'ios_update';
  }
  return apis ? 'supported' : 'unsupported';
}

export type PushPermission = NotificationPermission | 'unsupported';

/** Reads the permission without asking. */
export function pushPermission(): PushPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function browserName(ua: string): string | null {
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/EdgA?\/|Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

/**
 * 'iPhone', 'iPad', 'Android phone (Chrome)', 'Mac (Safari)', 'Windows PC (Edge)'.
 * `touchMac`: iPadOS reports a Mac with a touch screen.
 */
export function deviceLabel(ua: string, touchMac = false): string {
  const n = S.notifications.deviceNames;
  // iPhone / iPad: only the home-screen app gets notifications, so no browser name.
  if (/iPhone|iPod/.test(ua)) return n.iphone;
  if (/iPad/.test(ua) || (touchMac && /Macintosh/.test(ua))) return n.ipad;
  const device = /Android/.test(ua)
    ? /Mobile/.test(ua)
      ? n.androidPhone
      : n.androidTablet
    : /Macintosh|Mac OS X/.test(ua)
      ? n.mac
      : /Windows/.test(ua)
        ? n.windows
        : /CrOS/.test(ua)
          ? n.chromebook
          : n.other;
  const browser = browserName(ua);
  return browser ? `${device} (${browser})` : device;
}

function thisDeviceLabel(): string {
  return deviceLabel(navigator.userAgent, navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ── subscription ─────────────────────────────────────────────────
export type SubscribeResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'dismissed' | 'not_ready' | 'failed'; message?: string };

async function browserSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('PushManager' in window)) return null;
  const reg = await getRegistration();
  if (!reg) return null;
  try {
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** This browser's push endpoint, or null when it has none. Never asks for permission. */
export async function getThisEndpoint(): Promise<string | null> {
  return (await browserSubscription())?.endpoint ?? null;
}

/**
 * Call straight from a click: Safari only shows the permission prompt for a
 * user gesture, so nothing is awaited before it. Then subscribes (reusing a
 * subscription made with the same key) and saves it for the signed-in profile.
 * `save` throws on failure; its message is returned for the UI.
 */
export async function subscribeThisDevice(
  save: (input: PushSubscriptionInput) => Promise<unknown>,
  kinds: readonly PushKind[] = PUSH_KINDS,
): Promise<SubscribeResult> {
  if (pushSupport() !== 'supported') return { ok: false, reason: 'unsupported' };
  let permission: NotificationPermission;
  try {
    permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

  const reg = await serviceWorkerReady();
  if (!reg) return { ok: false, reason: 'not_ready' };

  let sub: PushSubscription;
  try {
    const key = fromBase64Url(VAPID_PUBLIC_KEY);
    const existing = await reg.pushManager.getSubscription();
    const existingKey = existing?.options?.applicationServerKey;
    if (existing && (!existingKey || sameBytes(new Uint8Array(existingKey), key))) {
      sub = existing;
    } else {
      // Made with another key (an older deploy): replace it.
      if (existing) await existing.unsubscribe().catch(() => false);
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }

  const p256dh = toBase64Url(sub.getKey('p256dh'));
  const auth = toBase64Url(sub.getKey('auth'));
  if (!p256dh || !auth) return { ok: false, reason: 'failed' };
  try {
    await save({ endpoint: sub.endpoint, p256dh, auth, deviceLabel: thisDeviceLabel(), enabledKinds: [...kinds] });
  } catch (e) {
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : undefined };
  }
  return { ok: true, endpoint: sub.endpoint };
}

/**
 * Drops this browser's subscription so the push service stops delivering here.
 * The server row is removed by the caller (or by leave_trip). Resolves to the
 * endpoint that was dropped. Gives up after `timeoutMs` so Leave never hangs.
 */
export async function unsubscribeThisDevice(timeoutMs = 3000): Promise<string | null> {
  const run = async () => {
    const sub = await browserSubscription();
    if (!sub) return null;
    await sub.unsubscribe().catch(() => false);
    return sub.endpoint;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([run().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
