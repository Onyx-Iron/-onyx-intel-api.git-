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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recoverTakeoffWork(db: any, workerId: string, batchSize = 20): Promise<TakeoffRecoveryResult> {
  const { data, error } = await db.rpc("recover_expired_takeoff_units", {
    p_limit: batchSize,
    p_max_attempts: 8,
  });
  if (error) throw error;
  const recovered = (data ?? []) as Array<{ state: AttemptState }>;
  const outbox = await processOutboxBatch(db, workerId, { batchSize });
  return {
    recoveredUnits: recovered.length,
    terminalUnits: recovered.filter((unit) => unit.state === "failed_terminal").length,
    outbox,
  };
}
