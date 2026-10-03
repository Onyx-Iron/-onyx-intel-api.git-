/**
 * Session-scoped undo/redo stack for manual takeoff canvas.
 * Commands call the same save/patch/delete endpoints — they never bypass server validation.
 */

export interface TakeoffCommand {
  id: string;
  label: string;
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

const MAX_HISTORY = 50;

export class CommandStack {
  private undoStack: TakeoffCommand[] = [];
  private redoStack: TakeoffCommand[] = [];
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.redoStack.at(-1)?.label ?? null; }

  async push(cmd: TakeoffCommand): Promise<void> {
    await cmd.redo();
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  /** Record an already-applied mutation (e.g. after a successful save). */
  record(cmd: TakeoffCommand): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  async undo(): Promise<boolean> {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    await cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  async redo(): Promise<boolean> {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    await cmd.redo();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
