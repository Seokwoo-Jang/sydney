import { describe, expect, it } from 'vitest';
import { NOT_A_MAP_LINK, mapHref, parseMapUrl, searchMapUrl } from '@/lib/maps';

describe('parseMapUrl', () => {
  it('accepts the allowed hosts', () => {
    for (const url of [
      'https://google.com/maps/place/Example',
      'https://www.google.com/maps?q=Example',
      'https://maps.google.com/?q=Example',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/AbCdEf123',
    ]) {
      expect(parseMapUrl(url).ok, url).toBe(true);
    }
  });
  it('reads place name and coordinates from a full URL', () => {
    const r = parseMapUrl(
      'https://www.google.com/maps/place/Queen+Victoria+Building/@-33.8718,151.2067,17z/data=!3m1!4b1?entry=ttu',
    );
    expect(r).toMatchObject({ ok: true, name: 'Queen Victoria Building', lat: -33.8718, lng: 151.2067 });
    if (r.ok) expect(r.url).toContain('entry=ttu');
  });
  it('prefers !3d!4d pin coordinates', () => {
    const r = parseMapUrl('https://www.google.com/maps/place/X/@-33.8,151.2,15z/data=!4m6!3d-33.85!4d151.21');
    expect(r).toMatchObject({ lat: -33.85, lng: 151.21 });
  });
  it('decodes Korean place names', () => {
    const r = parseMapUrl('https://www.google.com/maps/place/%EC%98%88%EC%8B%9C+%EC%9E%A5%EC%86%8C/');
    expect(r).toMatchObject({ ok: true, name: '예시 장소' });
  });
  it('short links keep the URL without name or coordinates', () => {
    expect(parseMapUrl('https://maps.app.goo.gl/AbCdEf123')).toEqual({
      ok: true,
      url: 'https://maps.app.goo.gl/AbCdEf123',
      name: null,
      lat: null,
      lng: null,
      source: 'link',
    });
  });
  it('rejects everything else', () => {
    for (const url of [
      'https://google.com.evil.com/maps/place/X',
      'https://evil.com/maps/place/X',
      'https://www.google.com/search?q=maps',
      'http://maps.google.com/?q=X',
      'javascript:alert(1)',
      'https://goo.gl/AbCdEf',
      'https://maps.app.goo.gl/',
      'not a url',
      '',
    ]) {
      expect(parseMapUrl(url), url).toEqual({ ok: false, error: NOT_A_MAP_LINK });
    }
  });
});

describe('search links', () => {
  it('encodes the query', () => {
    expect(searchMapUrl(' 퀸 빅토리아 빌딩 & Co ')).toBe(
      'https://www.google.com/maps/search/?api=1&query=%ED%80%B8%20%EB%B9%85%ED%86%A0%EB%A6%AC%EC%95%84%20%EB%B9%8C%EB%94%A9%20%26%20Co',
    );
  });
  it('mapHref falls back from link to place to coordinates', () => {
    const base = { mapUrl: null, place: '', mapLat: null, mapLng: null };
    expect(mapHref({ ...base, mapUrl: 'https://maps.app.goo.gl/x1' })).toEqual({
      href: 'https://maps.app.goo.gl/x1',
      kind: 'link',
    });
    expect(mapHref({ ...base, mapUrl: 'https://evil.com/maps', place: 'Example Hall' })?.kind).toBe('search');
    expect(mapHref({ ...base, mapLat: -33.8, mapLng: 151.2 })?.href).toContain('-33.8%2C151.2');
    expect(mapHref(base)).toBeNull();
  });
});
