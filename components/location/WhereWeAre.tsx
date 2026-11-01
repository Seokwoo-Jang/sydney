'use client';
// Where We Are (plan §7.8): opt-in live location, latest position only.
// Opening the card shows both people on a map (loaded on demand) above the list.
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Badge, Button, ButtonLink, Card, MemberMarks, useToast } from '@/components/ui';
import { useLocations, useServerNow, type LocationDeviceError } from '@/lib/data';
import { formatDistance, freshness, haversineM, mapsDirectionsUrl, mapsPointUrl, seenLine } from '@/lib/location';
import type { Member, ProfileKey } from '@/lib/types';
import { S } from '@/lib/strings';
import type { LivePerson } from './LiveMapCanvas';
import styles from './WhereWeAre.module.css';

// Leaflet needs the browser: load the map only when the card opens.
const LiveMapCanvas = dynamic(() => import('./LiveMapCanvas'), { ssr: false, loading: () => <div className={styles.mapPlaceholder} /> });

const WARNED_KEY = 'sydney.location.warned';

function readWarned(): boolean {
  try {
    return localStorage.getItem(WARNED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeWarned() {
  try {
    localStorage.setItem(WARNED_KEY, '1');
  } catch {
    // Private mode: the warning shows again next time.
  }
}

const DEVICE_ERROR: Record<LocationDeviceError, string> = {
  denied: S.location.denied,
  unavailable: S.location.unavailable,
  unsupported: S.location.unsupported,
  failed: S.location.unavailable,
};

export function WhereWeAre({ me, members, tz }: { me: Member | null; members: Member[]; tz: string }) {
  const loc = useLocations();
  const now = useServerNow(30_000);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // After turning sharing on, the map moves to me.
  const [mapFocus, setMapFocus] = useState<{ key: ProfileKey; seq: number } | null>(null);
  const focusMe = () => me && setMapFocus((f) => ({ key: me.profileKey, seq: (f?.seq ?? 0) + 1 }));

  const mine = me ? loc.list.find((l) => l.memberId === me.id) : undefined;
  const sharingHere = !!mine?.isSharing && !!loc.mySessionId && mine.sharingSessionId === loc.mySessionId;
  const sharingElsewhere = !!mine?.isSharing && !sharingHere;
  const people = members
    .map((m) => ({ member: m, row: loc.list.find((l) => l.memberId === m.id) }))
    .sort((a, b) => Number(b.member.id === me?.id) - Number(a.member.id === me?.id));
  const both = people.filter((p) => p.row);
  const apart = both.length === 2 ? formatDistance(haversineM(both[0].row!, both[1].row!)) : null;

  // Markers re-render only when a position, its freshness or its "seen" text changes.
  const nowMinute = now ? Math.floor(now.getTime() / 60_000) : 0;
  const mapPeople = useMemo<LivePerson[]>(
    () =>
      now
        ? both.map(({ member, row }) => ({
            key: member.profileKey,
            name: member.displayName,
            lat: row!.lat,
            lng: row!.lng,
            accuracyM: row!.accuracyM,
            state: freshness(row!, now.getTime()),
            seen: seenLine(row!, now, tz),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loc.list, nowMinute, tz, members],
  );

  const share = async () => {
    if (!readWarned()) return setConfirming(true);
    if (await loc.share()) focusMe();
  };
  const confirmShare = async () => {
    writeWarned();
    setConfirming(false);
    if (await loc.share()) focusMe();
  };
  const stop = async () => {
    if (await loc.stop()) toast.show(S.location.stopped);
  };
  const clear = async () => {
    if (await loc.clear()) toast.show(S.location.cleared);
  };

  const summary = people
    .map(({ member, row }) => `${member.displayName} · ${row && now ? seenLine(row, now, tz) : S.location.notShared}`)
    .join('  ·  ');

  return (
    <Card padding="sm" className={styles.card}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h3 className={styles.title}>{S.location.title}</h3>
          {sharingHere ? (
            <Badge tone="now">{S.location.sharing}</Badge>
          ) : (
            !open && <p className={styles.summary}>{loc.status === 'ready' ? summary : S.location.intro}</p>
          )}
        </div>
        <Button variant="link" size="sm" aria-expanded={open} aria-controls="where-we-are-body" onClick={() => setOpen((v) => !v)}>
          {open ? S.location.hide : S.location.show}
        </Button>
      </div>

      {open && (
        <div id="where-we-are-body" className={styles.body}>
          <p className={styles.hint}>{S.location.intro}</p>

          {mapPeople.length > 0 && <LiveMapCanvas people={mapPeople} ariaLabel={S.location.title} focus={mapFocus} />}

          {confirming ? (
            <div className={styles.warning} role="alertdialog" aria-labelledby="loc-warn-title">
              <p id="loc-warn-title" className={styles.warningTitle}>
                {S.location.warning}
              </p>
              <p className={styles.hint}>{S.location.warningDetail}</p>
              <div className={styles.actions}>
                <Button variant="primary" size="sm" busy={loc.device.busy} onClick={() => void confirmShare()}>
                  {S.location.confirmShare}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  {S.actions.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              {sharingHere ? (
                <Button variant="secondary" size="sm" busy={loc.device.busy} onClick={() => void stop()}>
                  {S.location.stop}
                </Button>
              ) : (
                <Button variant="primary" size="sm" iconStart="map-pin" busy={loc.device.busy} onClick={() => void share()}>
                  {sharingElsewhere ? S.location.shareHere : S.location.share}
                </Button>
              )}
              {sharingElsewhere && (
                <Button variant="ghost" size="sm" busy={loc.device.busy} onClick={() => void stop()}>
                  {S.location.stop}
                </Button>
              )}
            </div>
          )}
          <p className={styles.hint}>{sharingElsewhere ? S.location.otherDevice : S.location.whileOpen}</p>
          {loc.device.error && (
            <p className={styles.error} role="alert">
              {DEVICE_ERROR[loc.device.error]}
            </p>
          )}

          <ul className={styles.people}>
            {people.map(({ member, row }) => {
              const state = row && now ? freshness(row, now.getTime()) : 'off';
              const isMe = member.id === me?.id;
              return (
                <li key={member.id} className={[styles.person, row && state !== 'live' ? styles.dim : ''].join(' ')}>
                  <MemberMarks who={member.profileKey} />
                  <div className={styles.personText}>
                    <p className={styles.name}>{isMe ? S.location.you(member.displayName) : member.displayName}</p>
                    <p className={styles.seen}>
                      {row && now ? seenLine(row, now, tz) : S.location.notShared}
                      {row?.accuracyM != null && state === 'live' ? ` · ${S.location.accuracy(row.accuracyM)}` : ''}
                    </p>
                  </div>
                  {row && (
                    <div className={styles.links}>
                      <ButtonLink variant="link" size="sm" href={mapsPointUrl(row)} external iconEnd="external">
                        {S.maps.open}
                      </ButtonLink>
                      {!isMe && mine && (
                        <ButtonLink variant="link" size="sm" href={mapsDirectionsUrl(mine, row)} external>
                          {S.maps.directions}
                        </ButtonLink>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {apart && <p className={styles.hint}>{S.location.apart(apart)}</p>}

          {mine && (
            <Button variant="ghost" size="sm" busy={loc.device.busy} onClick={() => void clear()}>
              {S.location.clear}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
