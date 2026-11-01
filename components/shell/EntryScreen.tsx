'use client';
// Name entry (plan §8.1). Eren or Amy, trimmed and case-insensitive. This picks
// one of two shared profiles; it is not identity verification and never says so.
// `checking` renders the same brand frame without the form (static HTML).
// Phones in the browser first see a short guide: how to put the app on the Home
// Screen (iPhone / Android) and which notifications exist (owner, 2026-11-01).
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, SegmentedControl, TextInput } from '@/components/ui';
import { normalizeEntryName, useSession } from '@/lib/data';
import { isIOS, isStandalone, useInstall } from '@/lib/pwa';
import { S } from '@/lib/strings';
import { TimeOfDayBackdrop } from './TimeOfDayBackdrop';
import styles from './EntryScreen.module.css';

export function EntryScreen({ checking }: { checking: boolean }) {
  return (
    <div className={styles.screen}>
      <TimeOfDayBackdrop variant="entry" as="header" className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={`eyebrow ${styles.eyebrow}`}>{S.brand.subtitle}</p>
          <h1 className={styles.title}>
            {S.brand.titleLead} <em>{S.brand.titleAccent}</em>
          </h1>
          <p className={styles.intro}>{S.brand.intro}</p>
        </div>
      </TimeOfDayBackdrop>
      <main className={styles.panel}>
        {checking ? (
          <p className={styles.checking} role="status">
            {S.entry.checking}
          </p>
        ) : (
          <EntryFlow />
        )}
      </main>
    </div>
  );
}

type Phone = 'iphone' | 'android';

/** Guide first on a phone's browser (not the installed app, not a computer); then the name. */
function EntryFlow() {
  const [step, setStep] = useState<'guide' | 'form' | null>(null);
  const [phone, setPhone] = useState<Phone>('iphone');
  useEffect(() => {
    const android = /Android/i.test(navigator.userAgent);
    setPhone(android ? 'android' : 'iphone');
    setStep((isIOS() || android) && !isStandalone() ? 'guide' : 'form');
  }, []);
  if (step === 'guide') return <EntryGuide phone={phone} onPhone={setPhone} onContinue={() => setStep('form')} />;
  return step === 'form' ? <EntryForm /> : null;
}

function EntryGuide({ phone, onPhone, onContinue }: { phone: Phone; onPhone: (p: Phone) => void; onContinue: () => void }) {
  const install = useInstall();
  const G = S.entryGuide;
  const steps = phone === 'iphone' ? G.iphoneSteps : G.androidSteps;
  return (
    <section className={styles.guide} aria-labelledby="entry-guide-heading">
      <h2 id="entry-guide-heading" className={styles.guideHeading}>
        {G.heading}
      </h2>

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

      <Button variant="primary" fullWidth onClick={onContinue}>
        {G.continue}
      </Button>
    </section>
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
