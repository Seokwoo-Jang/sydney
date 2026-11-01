'use client';
// Client root: data provider → toasts → entry gate → shell.
// Static HTML renders the brand frame only (session "checking"): no trip data.
import { ToastProvider } from '@/components/ui';
import { TripDataProvider, useSession } from '@/lib/data';
import { EntryScreen } from './EntryScreen';
import { PwaManager } from './PwaManager';
import { Shell } from './Shell';

function Gate() {
  const session = useSession();
  if (session.status === 'signed_in') return <Shell />;
  return <EntryScreen checking={session.status === 'checking'} />;
}

export function AppRoot() {
  return (
    <TripDataProvider>
      <ToastProvider>
        <PwaManager />
        <Gate />
      </ToastProvider>
    </TripDataProvider>
  );
}
