// Web Push without a library (plan §8.5): RFC 8291 message encryption
// (aes128gcm, RFC 8188) and an RFC 8292 VAPID Authorization header.
// Web-standard APIs only (WebCrypto, TextEncoder, atob/btoa) so the same file
// runs in the Edge Function (Deno) and in the unit tests (Node).

export interface PushTarget {
  endpoint: string;
  p256dh: string; // receiver public key, base64url uncompressed P-256 point (65 bytes)
  auth: string; // receiver auth secret, base64url (16 bytes)
}

export interface VapidKeys {
  publicKey: string; // base64url uncompressed P-256 point
  privateKey: string; // base64url raw 32-byte scalar d — Supabase secret only
  subject: string; // 'mailto:…' or 'https://…'
}

export type Urgency = 'very-low' | 'low' | 'normal' | 'high';

export interface PushOptions {
  ttl: number; // seconds the push service may hold the message
  urgency?: Urgency;
  topic?: string; // ≤ 32 base64url characters; a newer message with the same topic replaces an undelivered one
  now?: number; // ms since epoch, for tests
}

export interface PushRequest {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

export const RECORD_SIZE = 4096;
const TAG_LENGTH = 16;
const VAPID_LIFETIME_S = 12 * 3600;

// ── bytes ──────────────────────────────────────────────────────

const enc = new TextEncoder();

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const std = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const copy = (b: Uint8Array): Uint8Array<ArrayBuffer> => concat(b);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', copy(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: copy(salt), info: copy(info) }, key, bytes * 8);
  return new Uint8Array(bits);
}

function checkPoint(raw: Uint8Array, what: string): void {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error(`${what}: expected an uncompressed P-256 point`);
}

// ── RFC 8291 encryption ────────────────────────────────────────

export interface SenderKeys {
  privateKey: CryptoKey; // ECDH P-256
  publicRaw: Uint8Array; // 65 bytes
}

/**
 * Encrypts one push message as a single aes128gcm record:
 * header (salt ‖ rs ‖ idlen ‖ sender public key) ‖ AES-128-GCM(payload ‖ 0x02).
 * `salt` and `sender` are generated per message; tests may pass them in.
 */
export async function encryptPayload(
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  plaintext: Uint8Array,
  opts: { salt?: Uint8Array; sender?: SenderKeys } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  checkPoint(uaPublic, 'p256dh');
  if (authSecret.length !== 16) throw new Error('auth: expected 16 bytes');
  if (plaintext.length + 1 + TAG_LENGTH > RECORD_SIZE) throw new Error('payload too large');

  let sender = opts.sender;
  if (!sender) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    sender = { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('salt: expected 16 bytes');

  const uaKey = await crypto.subtle.importKey('raw', copy(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" ‖ 0 ‖ ua_public ‖ as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, sender.publicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, Uint8Array.of(0x02)); // last-record delimiter, no padding
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aes, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, Uint8Array.of(sender.publicRaw.length), sender.publicRaw, sealed);
}

// ── RFC 8292 VAPID ─────────────────────────────────────────────

async function vapidSigningKey(vapid: VapidKeys): Promise<CryptoKey> {
  const pub = b64urlDecode(vapid.publicKey);
  checkPoint(pub, 'VAPID public key');
  const d = b64urlDecode(vapid.privateKey);
  if (d.length !== 32) throw new Error('VAPID private key: expected 32 bytes');
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.subarray(1, 33)),
    y: b64urlEncode(pub.subarray(33, 65)),
    d: b64urlEncode(d),
    ext: false,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** `vapid t=<ES256 JWT>, k=<public key>` for the endpoint's origin. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowMs = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = { aud, exp: Math.floor(nowMs / 1000) + VAPID_LIFETIME_S, sub: vapid.subject };
  const body = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const input = enc.encode(`${header}.${body}`);
  // WebCrypto ECDSA signatures are already r ‖ s (64 bytes), the JWS form.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidSigningKey(vapid), input),
  );
  return `vapid t=${header}.${body}.${b64urlEncode(sig)}, k=${b64urlEncode(b64urlDecode(vapid.publicKey))}`;
}

// ── request ────────────────────────────────────────────────────

// The push services browsers subscribe through: FCM (Chrome, Android browsers),
// Mozilla, Apple and Windows (Edge on PC). Same list as save_push_subscription.
const PUSH_HOST = /^(fcm\.googleapis\.com|([a-z0-9-]+\.)*(push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com))$/;

/** True for an https endpoint on a known push service; nothing else is ever POSTed to. */
export function isPushService(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && u.port === '' && !u.username && !u.password && PUSH_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** Everything `fetch` needs to deliver one message to one subscription. */
export async function buildPushRequest(
  sub: PushTarget,
  payload: string,
  vapid: VapidKeys,
  opts: PushOptions,
): Promise<PushRequest> {
  if (!isPushService(sub.endpoint)) throw new Error('endpoint is not a known push service');
  const body = await encryptPayload(b64urlDecode(sub.p256dh), b64urlDecode(sub.auth), enc.encode(payload));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, vapid, opts.now),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.floor(opts.ttl))),
  };
  if (opts.urgency) headers.Urgency = opts.urgency;
  if (opts.topic) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) throw new Error('topic: up to 32 base64url characters');
    headers.Topic = opts.topic;
  }
  return { url: sub.endpoint, headers, body };
}
