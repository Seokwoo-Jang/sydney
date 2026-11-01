import { describe, expect, it } from 'vitest';
import { PUSH_KINDS, VAPID_PUBLIC_KEY, deviceLabel, fromBase64Url, toBase64Url } from '@/lib/push';

// Browser side of Web Push (plan §8.5): key encoding and device labels.
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
};

describe('push keys', () => {
  it('ships an uncompressed P-256 public key', () => {
    const key = fromBase64Url(VAPID_PUBLIC_KEY);
    expect(key.length).toBe(65);
    expect(key[0]).toBe(0x04);
  });

  it('round-trips base64url without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
    const s = toBase64Url(bytes.buffer);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(s))).toEqual(Array.from(bytes));
    expect(toBase64Url(fromBase64Url(VAPID_PUBLIC_KEY).buffer)).toBe(VAPID_PUBLIC_KEY);
    expect(toBase64Url(null)).toBe('');
  });

  it('lists the four device switches in the contract order', () => {
    expect(PUSH_KINDS).toEqual(['schedule', 'flights_car', 'partner_updates', 'countdown']);
  });
});

describe('device labels', () => {
  it('names phones, tablets and computers', () => {
    expect(deviceLabel(UA.iphone)).toBe('iPhone');
    expect(deviceLabel(UA.ipadDesktop, true)).toBe('iPad');
    expect(deviceLabel(UA.ipadDesktop, false)).toBe('Mac (Safari)');
    expect(deviceLabel(UA.androidChrome)).toBe('Android phone (Chrome)');
    expect(deviceLabel(UA.androidSamsung)).toBe('Android phone (Samsung Internet)');
    expect(deviceLabel(UA.androidTablet)).toBe('Android tablet (Chrome)');
    expect(deviceLabel(UA.windowsEdge)).toBe('Windows PC (Edge)');
    expect(deviceLabel(UA.macFirefox)).toBe('Mac (Firefox)');
    expect(deviceLabel('')).toBe('Computer');
  });
});
