'use client';
// "Keep it on your home screen" (plan §11.3). Android/Chrome: our own Install
// button over the browser prompt. iPhone Safari: the Share → Add to Home Screen
// steps, shown until closed. Hidden once the app runs from the home screen.
import { Button } from '@/components/ui';
import { useInstall } from '@/lib/pwa';
import { S } from '@/lib/strings';
import styles from './InstallCard.module.css';

export function InstallCard() {
  const install = useInstall();
  if (!install.mode || install.dismissed) return null;
  return (
    <section className={styles.card} aria-labelledby="install-title">
      <img className={styles.icon} src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/icons/icon-192.png`} width={48} height={48} alt="" />
      <div className={styles.body}>
        <h2 id="install-title" className={styles.title}>
          {S.pwa.installTitle}
        </h2>
        <p className={styles.text}>{install.mode === 'ios' ? S.pwa.iosSteps : S.pwa.installBody}</p>
        <div className={styles.actions}>
          {install.mode === 'prompt' && (
            <Button variant="primary" size="sm" onClick={() => void install.install()}>
              {S.pwa.install}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={install.dismiss}>
            {S.pwa.dismiss}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Profile-menu entry: always available until installed (even after "Not now"). */
export function InstallMenuItem() {
  const install = useInstall();
  if (!install.mode) return null;
  if (install.mode === 'prompt') {
    return (
      <Button variant="secondary" size="sm" fullWidth onClick={() => void install.install()}>
        {S.pwa.install}
      </Button>
    );
  }
  return (
    <p className={styles.menuHint}>
      <strong>{S.pwa.howToInstall}</strong> · {S.pwa.iosSteps}
    </p>
  );
}
