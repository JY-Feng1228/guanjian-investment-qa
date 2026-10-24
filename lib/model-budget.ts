// First verification allowance approved by the owner. This is not a rolling allowance.
export const APPROVED_BUDGET_USD = 0.30;
export const UNKNOWN_REQUEST_RESERVE_USD = 0.10;
export type BudgetAttempt = { reservationUsd: number; estimatedCostUsd: number | null };

export function reservedSpend(attempts: BudgetAttempt[]): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.estimatedCostUsd ?? Math.max(UNKNOWN_REQUEST_RESERVE_USD, attempt.reservationUsd)), 0);
}

export function canStartRequest(attempts: BudgetAttempt[], reservationUsd: number): boolean {
  if (!Number.isFinite(reservationUsd) || reservationUsd <= 0 || attempts.some(a => !Number.isFinite(a.reservationUsd) || a.reservationUsd <= 0 || (a.estimatedCostUsd !== null && (!Number.isFinite(a.estimatedCostUsd) || a.estimatedCostUsd < 0)))) return false;
  // Leave a separate reserve before every request, even when earlier usage was reported.
  return reservedSpend(attempts) + reservationUsd + UNKNOWN_REQUEST_RESERVE_USD <= APPROVED_BUDGET_USD;
}
