// D-Day countdown (plan §9.1). Days before departure count on the home
// (Korean) calendar; during the trip the Day number follows the Sydney calendar.
import { SYDNEY_TZ, diffDays, zonedDate } from './zone';

export type CountdownState =
  | { kind: 'before'; days: number }
  | { kind: 'dday'; msUntilDeparture: number; atAirport: boolean }
  | { kind: 'during'; day: number; total: number }
  | { kind: 'after' };

export interface CountdownInput {
  startDate: string;
  endDate: string;
  homeTimezone: string;
  departureAt: Date | null;
  airportBy: Date | null;
  tripTimezone?: string;
}

export function countdown(now: Date, input: CountdownInput): CountdownState {
  const home = zonedDate(now, input.homeTimezone);
  const total = diffDays(input.endDate, input.startDate) + 1;
  if (home < input.startDate) return { kind: 'before', days: diffDays(input.startDate, home) };
  if (home > input.endDate) return { kind: 'after' };
  const departed = input.departureAt ? now.getTime() >= input.departureAt.getTime() : home > input.startDate;
  if (home === input.startDate && !departed) {
    return {
      kind: 'dday',
      msUntilDeparture: input.departureAt ? input.departureAt.getTime() - now.getTime() : 0,
      atAirport: !!input.airportBy && now.getTime() >= input.airportBy.getTime(),
    };
  }
  const local = zonedDate(now, input.tripTimezone ?? SYDNEY_TZ);
  const day = Math.min(total, Math.max(1, diffDays(local, input.startDate) + 1));
  return { kind: 'during', day, total };
}

export function formatCountdown(state: CountdownState): string {
  switch (state.kind) {
    case 'before':
      return `D-${state.days} · Until Sydney`;
    case 'dday': {
      if (state.atAirport) return 'D-Day · Time to be at the airport';
      const mins = Math.max(0, Math.ceil(state.msUntilDeparture / 60000));
      return `D-Day · Departs in ${Math.floor(mins / 60)}h ${mins % 60}m`;
    }
    case 'during':
      return `Day ${state.day} of ${state.total}`;
    case 'after':
      return 'Welcome home';
  }
}
