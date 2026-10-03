/**
 * Professional takeoff canvas hotkeys.
 *
 * L → length (line)   A → area   C → count
 * Space → temporary pan (hold)   Z → undo   Esc → cancel   Enter → finish
 */

export type CanvasTool =
  | "pan"
  | "calibrate"
  | "count"
  | "length"
  | "area"
  | "utility_pipe"
  | "spot_elevation"
  | "contour_line"
  | "civil_area_bounds";

export type HotkeyAction =
  | { type: "tool"; tool: CanvasTool }
  | { type: "cancel" }
  | { type: "finish" }
  | { type: "undo" }
  | { type: "pan_hold_start" }
  | { type: "pan_hold_end" };

const TOOL_BY_KEY: Record<string, CanvasTool> = {
  l: "length",
  a: "area",
  c: "count",
  p: "pan",
  k: "calibrate",
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
      /* ignore — closest may throw outside a DOM */
    }
  }
  return false;
}

/**
 * Map a keyboard event to a canvas hotkey action.
 * Returns null when the event should be ignored (editable fields, modifiers, unknown keys).
 */
export function resolveCanvasHotkey(
  event: Pick<KeyboardEvent, "key" | "code" | "type" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "target">,
): HotkeyAction | null {
  if (isEditableKeyboardTarget(event.target)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (event.type === "keyup") {
    if (key === " " || event.code === "Space") return { type: "pan_hold_end" };
    return null;
  }

  // keydown
  if (key === "Escape") return { type: "cancel" };
  if (key === "Enter") return { type: "finish" };
  if (lower === "z" && !event.repeat) return { type: "undo" };
  if ((key === " " || event.code === "Space") && !event.repeat) return { type: "pan_hold_start" };

  const tool = TOOL_BY_KEY[lower];
  if (tool && !event.repeat) return { type: "tool", tool };

  return null;
}

/** Human-readable shortcut legend for the toolbar. */
export const CANVAS_HOTKEY_HINT =
  "L line · A area · C count · Space pan · Z undo · Esc cancel · Enter finish";
