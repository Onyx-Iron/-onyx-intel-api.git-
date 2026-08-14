import { processOutboxBatch, type OutboxProcessResult } from "@/lib/estimating/outbox-worker";

export type AttemptState = "failed_retryable" | "failed_terminal";

export function nextRetryAt(base: Date, attempts: number, jitterMs = 0): Date {
  const exponent = Math.max(0, attempts - 1);
  const delay = Math.min(30_000 * (2 ** exponent), 15 * 60_000);
  return new Date(base.getTime() + delay + Math.max(0, jitterMs));
}

export function classifyAttempt(input: { attempts: number; maxAttempts: number }): AttemptState {
  return input.attempts >= input.maxAttempts ? "failed_terminal" : "failed_retryable";
}

export interface TakeoffRecoveryResult {
  recoveredUnits: number;
  terminalUnits: number;
  outbox: OutboxProcessResult;
}

export interface ExpiredUnitRecoveryResult {
  recoveredUnits: number;
  terminalUnits: number;
}

// Kept separate from the outbox sweep so authenticated job polling can repair
// expired takeoff leases cheaply. The database RPC uses SKIP LOCKED, making
// overlapping browser polls and the scheduled sweep safe and idempotent.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recoverExpiredTakeoffUnits(db: any, batchSize = 20): Promise<ExpiredUnitRecoveryResult> {
  const { data, error } = await db.rpc("recover_expired_takeoff_units", {
    p_limit: batchSize,
    p_max_attempts: 8,
  });
  if (error) throw error;
  const recovered = (data ?? []) as Array<{ state: AttemptState }>;
  return {
    recoveredUnits: recovered.length,
    terminalUnits: recovered.filter((unit) => unit.state === "failed_terminal").length,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recoverTakeoffWork(db: any, workerId: string, batchSize = 20): Promise<TakeoffRecoveryResult> {
  const recovered = await recoverExpiredTakeoffUnits(db, batchSize);
  const outbox = await processOutboxBatch(db, workerId, { batchSize });
  return {
    ...recovered,
    outbox,
  };
}
