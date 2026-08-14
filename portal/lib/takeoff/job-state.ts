import type {
  TakeoffJobCompletion,
  TakeoffJobState,
  TakeoffWorkUnitStatus,
} from "./contracts";

export const allowedTransitions: Readonly<Record<TakeoffJobState, readonly TakeoffJobState[]>> = {
  uploaded: ["validated", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  validated: ["split", "classified", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  split: ["classified", "blocked", "failed_retryable", "failed_terminal", "cancelled"],
  classified: ["extracted", "blocked", "conflicted", "failed_retryable", "failed_terminal", "cancelled"],
  extracted: ["quantity_validated", "blocked", "conflicted", "failed_retryable", "failed_terminal", "cancelled"],
  quantity_validated: ["review_ready", "blocked", "conflicted", "failed_retryable", "failed_terminal", "cancelled"],
  review_ready: ["approved", "blocked", "conflicted", "superseded", "cancelled"],
  approved: ["estimate_imported", "superseded"],
  estimate_imported: ["superseded"],
  blocked: ["validated", "split", "classified", "extracted", "quantity_validated", "review_ready", "cancelled"],
  conflicted: ["quantity_validated", "review_ready", "superseded", "cancelled"],
  failed_retryable: ["validated", "split", "classified", "extracted", "cancelled"],
  failed_terminal: ["cancelled"],
  superseded: [],
  cancelled: [],
};

const TERMINAL_STATES = new Set<TakeoffJobState>([
  "estimate_imported",
  "failed_terminal",
  "superseded",
  "cancelled",
]);

export function canTransition(from: TakeoffJobState, to: TakeoffJobState): boolean {
  return allowedTransitions[from].includes(to);
}

export function deriveJobCompletion(units: readonly TakeoffWorkUnitStatus[]): TakeoffJobCompletion {
  let unresolved = 0;
  let failed = 0;

  for (const unit of units) {
    const resolved = unit.state === "estimate_imported" || unit.state === "superseded" ||
      (unit.state === "cancelled" && unit.exclusionAuthorized === true);
    if (!resolved) unresolved += 1;
    if (unit.state === "failed_terminal") failed += 1;
  }

  return {
    complete: units.length > 0 && unresolved === 0,
    terminal: units.length > 0 && units.every((unit) => TERMINAL_STATES.has(unit.state)),
    unresolved,
    failed,
  };
}

export function transitionJobState(
  current: { state: TakeoffJobState; rowVersion: number },
  nextState: TakeoffJobState,
  expectedRowVersion: number,
): { state: TakeoffJobState; rowVersion: number } {
  if (current.rowVersion !== expectedRowVersion) {
    throw new Error(`Takeoff row version conflict: expected ${expectedRowVersion}, found ${current.rowVersion}`);
  }
  if (!canTransition(current.state, nextState)) {
    throw new Error(`Invalid takeoff transition: ${current.state} -> ${nextState}`);
  }
  return { state: nextState, rowVersion: current.rowVersion + 1 };
}
