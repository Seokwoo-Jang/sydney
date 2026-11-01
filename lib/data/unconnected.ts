// Production repository for phase 2: the name entry works, data does not.
// Phase 3 replaces this with the Supabase repository (same TripRepository contract).
import type { Member } from '../types';
import { RepositoryError, type TripRepository } from './repository';
import { ENTRY_NAMES, normalizeEntryName } from './session';

const notConnected = () => new RepositoryError('not_connected', 'The trip data source is not connected yet.');

export function createUnconnectedRepository(): TripRepository {
  let member: Member | null = null;
  const fail = async () => ({ ok: false as const, reason: 'error' as const, message: notConnected().message });
  const reject = async (): Promise<never> => {
    throw notConnected();
  };

  return {
    kind: 'unconnected',
    serverManagesPreludeStatus: false,
    async getSession() {
      return member;
    },
    async enter(name) {
      const key = normalizeEntryName(name);
      if (!key) return { ok: false, reason: 'invalid_name' };
      member = { id: `local-${key}`, tripId: 'local', profileKey: key, displayName: ENTRY_NAMES[key] };
      return { ok: true, member };
    },
    async leave() {
      member = null;
    },
    async serverTimeOffset() {
      return 0;
    },
    async loadSnapshot() {
      throw notConnected();
    },
    subscribe() {
      return () => {};
    },
    create: fail,
    update: fail,
    softDelete: fail,
    updateTrip: fail,
    setBudget: fail,
    linkResource: fail,
    unlinkResource: fail,
    uploadFiles: reject,
    async removeFiles() {},
    signedUrl: reject,
    loadLocations: reject,
    shareLocation: reject,
    stopSharing: reject,
    clearMyLocation: reject,
  };
}
