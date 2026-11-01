import type { CountdownInfo } from '@/lib/hooks/useCountdown';
import { S } from '@/lib/strings';

export interface CountdownText {
  /** Serif figure: 'D-56', 'D-Day', 'Day 2 of 9', 'Welcome home'. */
  value: string;
  /** Sans label next to it. */
  label: string;
  /** Outbound flight line (before departure), e.g. 'SB101 · Thu, 26 Dec, 8:30 pm'. */
  flight: string | null;
}

export function countdownText(info: CountdownInfo): CountdownText {
  const { state, outbound } = info;
  switch (state.kind) {
    case 'before':
      return { value: S.countdown.dMinus(state.days), label: S.countdown.untilSydney, flight: outbound?.label ?? null };
    case 'dday': {
      if (state.atAirport) return { value: S.countdown.dDay, label: S.countdown.atAirport, flight: outbound?.label ?? null };
      const mins = Math.max(0, Math.ceil(state.msUntilDeparture / 60000));
      return {
        value: S.countdown.dDay,
        label: S.countdown.departsIn(Math.floor(mins / 60), mins % 60),
        flight: outbound?.label ?? null,
      };
    }
    case 'during':
      return { value: S.countdown.dayOf(state.day, state.total), label: '', flight: null };
    case 'after':
      return { value: S.countdown.welcomeHome, label: S.countdown.notesWaiting, flight: null };
  }
}
