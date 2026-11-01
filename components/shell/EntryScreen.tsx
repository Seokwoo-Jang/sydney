'use client';
// Name entry (plan §8.1). Eren or Amy, trimmed and case-insensitive. This picks
// one of two shared profiles; it is not identity verification and never says so.
// `checking` renders the same brand frame without the form (static HTML).
// Phones in the browser first see a short guide: how to put the app on the Home
// Screen (iPhone / Android) and which notifications exist. Computers show the same
// guide next to the form, with a QR code that opens the site on a phone
// (owner, 2026-11-01).
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Icon, SegmentedControl, TextInput } from '@/components/ui';
import { normalizeEntryName, useSession } from '@/lib/data';
import { isIOS, isStandalone, useInstall } from '@/lib/pwa';
import { S } from '@/lib/strings';
import { publicAsset } from '@/lib/url';
import { QrCode } from './QrCode';
import { TimeOfDayBackdrop } from './TimeOfDayBackdrop';
import styles from './EntryScreen.module.css';

export function EntryScreen({ checking }: { checking: boolean }) {
  return (
    <div className={styles.screen}>
      <TimeOfDayBackdrop variant="entry" as="header" className={styles.hero} fixedPhase="day">
        <div className={styles.heroInner}>
          <p className={`eyebrow ${styles.eyebrow}`}>{S.brand.subtitle}</p>
          <h1 className={styles.title}>
            {S.brand.titleLead} <em>{S.brand.titleAccent}</em>
          </h1>
          <p className={styles.intro}>{S.brand.intro}</p>
        </div>
      </TimeOfDayBackdrop>
      {checking ? (
        <main className={styles.panel}>
          <p className={styles.checking} role="status">
            {S.entry.checking}
          </p>
        </main>
      ) : (
        <EntryFlow />
      )}
    </div>
  );
}

type Phone = 'iphone' | 'android';

/**
 * Phone browser: the guide first, then the name. Computer: the name with the guide and a
 * QR code beside it. The installed app goes straight to the name.
 */
function EntryFlow() {
  const [device, setDevice] = useState<'phone' | 'computer' | 'app' | null>(null);
  const [step, setStep] = useState<'guide' | 'form'>('guide');
  const [phone, setPhone] = useState<Phone>('iphone');
  useEffect(() => {
    const android = /Android/i.test(navigator.userAgent);
    setPhone(android ? 'android' : 'iphone');
    setDevice(isStandalone() ? 'app' : isIOS() || android ? 'phone' : 'computer');
  }, []);
  if (!device) return <main className={styles.panel} />;
  if (device === 'computer') {
    return (
      <div className={styles.panels}>
        <main className={styles.panel}>
          <EntryForm />
        </main>
        <aside className={[styles.panel, styles.side].join(' ')} aria-labelledby="entry-guide-heading">
          <PhoneLink />
          <GuideBlocks phone={phone} onPhone={setPhone} />
        </aside>
      </div>
    );
  }
  return (
    <main className={styles.panel}>
      {device === 'phone' && step === 'guide' ? (
        <section className={styles.guide} aria-labelledby="entry-guide-heading">
          <h2 id="entry-guide-heading" className={styles.guideHeading}>
            {S.entryGuide.heading}
          </h2>
          <GuideBlocks phone={phone} onPhone={setPhone} />
          {/* Said where the choice is made: the browser gets no notifications. */}
          <p className={styles.continueNote}>
            <Icon name="bell" size={16} />
            <span>{S.entryGuide.continueNote}</span>
          </p>
          <Button variant="primary" fullWidth onClick={() => setStep('form')}>
            {S.entryGuide.continue}
          </Button>
        </section>
      ) : (
        <EntryForm />
      )}
    </main>
  );
}

/** Computer: a QR code of this site's address to open it on a phone. */
function PhoneLink() {
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(process.env.NEXT_PUBLIC_SITE_URL || new URL(publicAsset('/'), window.location.origin).href), []);
  const G = S.entryGuide;
  return (
    <section className={styles.phoneLink}>
      <h2 id="entry-guide-heading" className={styles.guideHeading}>
        {G.pcTitle}
      </h2>
      <div className={styles.qrRow}>
        {url ? <QrCode value={url} label={G.qrLabel} className={styles.qr} /> : <span className={styles.qr} />}
        <div className={styles.qrText}>
          <p className={styles.guideText}>{G.pcIntro}</p>
          {url ? <p className={styles.url}>{url.replace(/^https?:\/\//, '')}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** Home Screen steps (iPhone / Android) and the notification kinds; shared by phones and computers. */
function GuideBlocks({ phone, onPhone }: { phone: Phone; onPhone: (p: Phone) => void }) {
  const install = useInstall();
  const G = S.entryGuide;
  const steps = phone === 'iphone' ? G.iphoneSteps : G.androidSteps;
  return (
    <>
      <div className={styles.guideBlock}>
        <h3 className={styles.guideTitle}>{G.homeTitle}</h3>
        <p className={styles.guideText}>{G.homeIntro}</p>
        <SegmentedControl
          label={G.platform}
          fill
          value={phone}
          onChange={(v) => onPhone(v as Phone)}
          options={[
            { value: 'iphone', label: G.iphone },
            { value: 'android', label: G.android },
          ]}
        />
        <ol className={styles.steps}>
          {steps.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        {phone === 'iphone' ? <p className={styles.guideNote}>{G.iphoneNote}</p> : null}
        {phone === 'android' && install.mode === 'prompt' ? (
          <Button variant="secondary" size="sm" onClick={() => void install.install()}>
            {G.installNow}
          </Button>
        ) : null}
      </div>

      <div className={styles.guideBlock}>
        <h3 className={styles.guideTitle}>{G.notifyTitle}</h3>
        <p className={styles.guideText}>{G.notifyIntro}</p>
        <ul className={styles.kinds}>
          {G.notifyKinds.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className={styles.guideNote}>{G.notifyPrivacy}</p>
      </div>
    </>
  );
}

function EntryForm() {
  const session = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The iPhone home-screen app has its own storage: say why the name is asked again (plan §11.3).
  const [reenterHint, setReenterHint] = useState(false);
  useEffect(() => setReenterHint(isIOS() && isStandalone()), []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!normalizeEntryName(name)) {
      setError(S.entry.invalidName);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await session.enter(name);
    if (!res.ok) {
      setBusy(false);
      setError(res.reason === 'invalid_name' ? S.entry.invalidName : S.entry.failed);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-labelledby="entry-heading">
      <h2 id="entry-heading" className="sr-only">
        {S.entry.heading}
      </h2>
      <Field label={S.entry.nameLabel} hint={reenterHint ? `${S.entry.hint} ${S.pwa.iosReenter}` : S.entry.hint} error={error ?? undefined}>
        <TextInput
          name="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          required
        />
      </Field>
      <Button type="submit" variant="primary" fullWidth busy={busy}>
        {busy ? S.entry.submitting : S.entry.submit}
      </Button>
    </form>
  );
}
