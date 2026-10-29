/**
 * Royalty helpers — computed in code (not by the LLM) so numbers are always correct.
 * Policy: royalties are calculated quarterly and paid within 45 days of quarter end.
 * Minimum payout threshold ₹1,000 — smaller balances roll over to the next quarter.
 */
export const MIN_PAYOUT = 1000;
export const PAYOUT_WINDOW_DAYS = 45;

const quarterEnd = (year: number, q: number) => new Date(Date.UTC(year, q * 3 + 3, 0)); // last day of quarter
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Next date by which a royalty payout is due, relative to `today`. */
export function nextPayoutDate(today = new Date()): Date {
  const y = today.getUTCFullYear();
  const q = Math.floor(today.getUTCMonth() / 3);
  const prevEnd = q === 0 ? quarterEnd(y - 1, 3) : quarterEnd(y, q - 1);
  const prevDue = addDays(prevEnd, PAYOUT_WINDOW_DAYS);
  return today <= prevDue ? prevDue : addDays(quarterEnd(y, q), PAYOUT_WINDOW_DAYS);
}

export const toNumber = (v: string | number | null | undefined) => Number(v ?? 0);

export function royaltySummary(earned: string | number, paid: string | number) {
  const e = toNumber(earned);
  const p = toNumber(paid);
  const pending = Math.max(0, Math.round((e - p) * 100) / 100);
  return { royaltyEarned: e, royaltyPaid: p, royaltyPending: pending, belowPayoutThreshold: pending > 0 && pending < MIN_PAYOUT };
}

export const formatINR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const formatDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
