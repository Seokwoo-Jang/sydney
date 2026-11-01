'use client';
// Notifications (plan §8.5): turn push on for this device, choose the four
// kinds per device, and see or remove this profile's devices. Permission is
// asked only from the "Turn on notifications" click, never on load.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckField, ConfirmDelete } from '@/components/checklist/FormBits';
import { Badge, Button, SaveStatus, Sheet, useToast, type SaveState } from '@/components/ui';
import { usePushDevices, useTrip, type PushDevicesApi } from '@/lib/data';
import { isIOS } from '@/lib/pwa';
import {
  PUSH_KINDS,
  getThisEndpoint,
  pushPermission,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushPermission,
  type PushSupport,
  type SubscribeResult,
} from '@/lib/push';
import { formatDayLabel, zonedDate } from '@/lib/time/zone';
import type { PushDevice, PushKind } from '@/lib/types';
import { S } from '@/lib/strings';
import styles from './NotificationsSheet.module.css';

const KIND_LABEL: Record<PushKind, string> = {
  schedule: S.notifications.schedule,
  flights_car: S.notifications.flightsCar,
  partner_updates: S.notifications.partnerUpdates,
  countdown: S.notifications.countdown,
};

function kindHint(kind: PushKind, partner: string | null): string {
  const h = S.notifications.kindHint;
  if (kind === 'schedule') return h.schedule;
  if (kind === 'flights_car') return h.flightsCar;
  if (kind === 'partner_updates') return h.partnerUpdates(partner);
  return h.countdown;
}

/** null for `denied`: the blocked notice with the settings steps replaces the button. */
function failureText(res: Extract<SubscribeResult, { ok: false }>): string | null {
  const n = S.notifications;
  if (res.reason === 'denied') return null;
  if (res.reason === 'dismissed') return n.dismissed;
  if (res.reason === 'not_ready') return n.notReady;
  if (res.reason === 'unsupported') return n.unsupported;
  return res.message || n.failed;
}

/** 'Sat, 31 Oct' in this device's time zone, kept on one line. */
function addedOn(iso: string): string {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // keep UTC
  }
  return formatDayLabel(zonedDate(new Date(iso), tz)).replace(/ /g, ' ');
}

export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  return (
    <Sheet
      open={open}
      onClose={() => {
        setSaveState('idle');
        onClose();
      }}
      title={S.notifications.title}
      description={S.notifications.intro}
      headerExtra={<SaveStatus state={saveState} />}
    >
      <NotificationsBody onSaveState={setSaveState} />
    </Sheet>
  );
}

interface DeviceEnv {
  support: PushSupport;
  permission: PushPermission;
  /** This browser's push endpoint (null = not subscribed in the browser). */
  endpoint: string | null;
}

function NotificationsBody({ onSaveState }: { onSaveState: (s: SaveState) => void }) {
  const push = usePushDevices();
  const trip = useTrip();
  const toast = useToast();
  const partner = trip.status === 'ready' ? (trip.data.partner?.displayName ?? null) : null;
  const [env, setEnv] = useState<DeviceEnv | null>(null);
  const [busy, setBusy] = useState<'on' | 'off' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readEnv = useCallback(async () => {
    const support = pushSupport();
    const endpoint = support === 'supported' ? await getThisEndpoint() : null;
    setEnv({ support, permission: pushPermission(), endpoint });
  }, []);

  // Read again on return from the system settings (permission may have changed).
  useEffect(() => {
    void readEnv();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void readEnv();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [readEnv]);

  const here = env?.endpoint ? (push.devices.find((d) => d.endpoint === env.endpoint) ?? null) : null;

  // Runs straight from the click: subscribeThisDevice asks for permission before awaiting anything.
  const turnOn = async () => {
    setMessage(null);
    setBusy('on');
    const res = await subscribeThisDevice(push.save);
    setBusy(null);
    await readEnv();
    if (res.ok) toast.show(S.notifications.turnedOn);
    else setMessage(failureText(res));
  };

  const turnOff = async (device: PushDevice) => {
    setMessage(null);
    setBusy('off');
    const res = await push.remove(device.id);
    if (res.ok) {
      await unsubscribeThisDevice();
      onSaveState('idle'); // the switches are gone with the device
      toast.show(S.notifications.turnedOff);
    } else {
      setMessage(res.message);
    }
    setBusy(null);
    await readEnv();
  };

  const removeDevice = async (device: PushDevice) => {
    if (device.endpoint === env?.endpoint) return turnOff(device);
    setRemoving(device.id);
    const res = await push.remove(device.id);
    setRemoving(null);
    toast.show(res.ok ? S.notifications.removed : res.message);
  };

  return (
    <div className={styles.body}>
      <section className={styles.block} aria-labelledby="notif-device">
        <h3 id="notif-device" className={styles.heading}>
          {S.notifications.thisDevice}
        </h3>
        {env && (
          <ThisDevice
            env={env}
            push={push}
            here={here}
            partner={partner}
            busy={busy}
            onTurnOn={() => void turnOn()}
            onTurnOff={(d) => void turnOff(d)}
            onSaveState={onSaveState}
          />
        )}
        <p className={styles.message} role="status" aria-live="polite">
          {message}
        </p>
      </section>

      {push.status !== 'unavailable' && (
        <section className={styles.block} aria-labelledby="notif-devices">
          <h3 id="notif-devices" className={styles.heading}>
            {S.notifications.devices}
          </h3>
          {push.status === 'loading' && push.devices.length === 0 && <p className={styles.hint}>{S.notifications.loadingDevices}</p>}
          {push.status === 'error' && (
            <div className={styles.inline}>
              <p className={styles.error}>{push.error?.message || S.notifications.loadFailed}</p>
              <Button variant="link" size="sm" onClick={() => void push.refresh()}>
                {S.actions.retry}
              </Button>
            </div>
          )}
          {push.status === 'ready' && push.devices.length === 0 && <p className={styles.hint}>{S.notifications.noDevices}</p>}
          {push.devices.length > 0 && (
            <>
              <ul className={styles.devices}>
                {push.devices.map((d) => (
                  <li key={d.id} className={styles.device}>
                    <p className={styles.deviceText}>
                      <span>{S.notifications.deviceLine(d.deviceLabel || S.notifications.deviceNames.other, addedOn(d.createdAt))}</span>
                      {d.endpoint === env?.endpoint && <Badge tone="soft">{S.notifications.thisDevice}</Badge>}
                    </p>
                    <ConfirmDelete
                      label={S.notifications.remove}
                      question={S.notifications.removeConfirm}
                      busy={removing === d.id || (busy === 'off' && d.endpoint === env?.endpoint)}
                      onConfirm={() => void removeDevice(d)}
                    />
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>{S.notifications.unknownDevice}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function ThisDevice({
  env,
  push,
  here,
  partner,
  busy,
  onTurnOn,
  onTurnOff,
  onSaveState,
}: {
  env: DeviceEnv;
  push: PushDevicesApi;
  here: PushDevice | null;
  partner: string | null;
  busy: 'on' | 'off' | null;
  onTurnOn: () => void;
  onTurnOff: (device: PushDevice) => void;
  onSaveState: (s: SaveState) => void;
}) {
  const n = S.notifications;
  if (push.status === 'unavailable') return <p className={styles.hint}>{n.unavailable}</p>;
  if (env.support === 'unsupported') return <p className={styles.hint}>{n.unsupported}</p>;
  if (env.support === 'ios_update') return <p className={styles.hint}>{n.iosUpdate}</p>;
  if (env.support === 'home_screen') {
    return (
      <div className={styles.notice}>
        <p className={styles.noticeTitle}>{n.homeScreen}</p>
        <p className={styles.hint}>
          <strong>{S.pwa.howToInstall}</strong> · {S.pwa.iosSteps}
        </p>
        <p className={styles.hint}>{n.homeScreenThen}</p>
      </div>
    );
  }
  if (env.permission === 'denied') {
    return (
      <div className={styles.notice}>
        <p className={styles.noticeTitle}>{n.denied}</p>
        <p className={styles.hint}>{isIOS() ? n.deniedIos : n.deniedOther}</p>
      </div>
    );
  }
  if (!here) {
    // Wait for the list before offering the button, so a subscribed device never flashes "Turn on".
    if (push.status === 'loading' && env.endpoint) return <p className={styles.hint}>{n.loadingDevices}</p>;
    return (
      <div className={styles.actions}>
        <Button variant="primary" busy={busy === 'on'} onClick={onTurnOn}>
          {busy === 'on' ? n.turningOn : n.turnOn}
        </Button>
      </div>
    );
  }
  return (
    <>
      <KindSwitches device={here} partner={partner} setKinds={push.setKinds} onSaveState={onSaveState} />
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" busy={busy === 'off'} onClick={() => onTurnOff(here)}>
          {busy === 'off' ? n.turningOff : n.turnOff}
        </Button>
      </div>
    </>
  );
}

/** Per-device kinds, saved on each change. The newest change wins; a failure falls back to the saved value. */
function KindSwitches({
  device,
  partner,
  setKinds,
  onSaveState,
}: {
  device: PushDevice;
  partner: string | null;
  setKinds: PushDevicesApi['setKinds'];
  onSaveState: (s: SaveState) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<PushKind[] | null>(null);
  const seq = useRef(0);
  const kinds = draft ?? device.enabledKinds;

  const toggle = async (kind: PushKind, on: boolean) => {
    const next = PUSH_KINDS.filter((k) => (k === kind ? on : kinds.includes(k)));
    const n = ++seq.current;
    setDraft(next);
    onSaveState('saving');
    const res = await setKinds(device.id, next);
    if (n !== seq.current) return;
    setDraft(null);
    onSaveState(res.ok ? 'saved' : 'error');
    if (!res.ok) toast.show(res.message);
  };

  return (
    <fieldset className={styles.kinds}>
      <legend className={styles.legend}>{S.notifications.onThisDevice}</legend>
      {PUSH_KINDS.map((kind) => (
        <CheckField
          key={kind}
          label={KIND_LABEL[kind]}
          hint={kindHint(kind, partner)}
          checked={kinds.includes(kind)}
          onChange={(on) => void toggle(kind, on)}
        />
      ))}
    </fieldset>
  );
}
