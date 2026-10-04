/**
 * Professional takeoff canvas hotkeys.
 *
 * L → length (line)   A → area   C → count
 * Space → temporary pan (hold)
 * Z / Ctrl+Z → undo   Ctrl+Y / Ctrl+Shift+Z → redo
 * Esc → cancel   Enter → finish   Delete → delete selection
 */

export type CanvasTool =
  | "pan"
  | "calibrate"
  | "count"
  | "length"
  | "area"
  | "perimeter"
  | "utility_pipe"
  | "spot_elevation"
  | "contour_line"
  | "civil_area_bounds"
  | "scale_region";

export type HotkeyAction =
  | { type: "tool"; tool: CanvasTool }
  | { type: "cancel" }
  | { type: "finish" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete_selection" }
  | { type: "select_all" }
  | { type: "duplicate" }
  | { type: "pan_hold_start" }
  | { type: "pan_hold_end" };

const TOOL_BY_KEY: Record<string, CanvasTool> = {
  l: "length",
  a: "area",
  r: "perimeter",
  c: "count",
  p: "pan",
  k: "calibrate",
  s: "scale_region",
};

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function") {
    try {
      if (el.closest("[contenteditable='true']")) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Map a keyboard event to a canvas hotkey action.
 * Returns null when the event should be ignored (editable fields, unknown keys).
 */
export function resolveCanvasHotkey(
  event: Pick<KeyboardEvent, "key" | "code" | "type" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">,
): HotkeyAction | null {
  if (isEditableKeyboardTarget(event.target)) return null;
  if (event.altKey) return null;

  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  const mod = event.metaKey || event.ctrlKey;

  if (event.type === "keyup") {
    if (key === " " || event.code === "Space") return { type: "pan_hold_end" };
    return null;
  }

  // Modifier chords first
  if (mod && !event.repeat) {
    if (lower === "z" && event.shiftKey) return { type: "redo" };
    if (lower === "z") return { type: "undo" };
    if (lower === "y") return { type: "redo" };
    if (lower === "a") return { type: "select_all" };
    if (lower === "d") return { type: "duplicate" };
    return null;
  }

  if (key === "Escape") return { type: "cancel" };
  if (key === "Enter") return { type: "finish" };
  if ((key === "Delete" || key === "Backspace") && !event.repeat) return { type: "delete_selection" };
  if (lower === "z" && !event.repeat) return { type: "undo" };
  if ((key === " " || event.code === "Space") && !event.repeat) return { type: "pan_hold_start" };

  const tool = TOOL_BY_KEY[lower];
  if (tool && !event.repeat) return { type: "tool", tool };

  return null;
}

/** Human-readable shortcut legend for the toolbar. */
export const CANVAS_HOTKEY_HINT =
  "L line · R perimeter · A area · C count · K scale · Space pan · Ctrl+Z undo · Enter finish";
