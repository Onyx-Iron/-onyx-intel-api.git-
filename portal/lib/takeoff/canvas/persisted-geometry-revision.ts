/**
 * Undo/redo for a measurement whose geometry was already PATCH'd.
 *
 * The commit response's row_version is the server's current version. Undo
 * and redo must send that version (then the version the previous call
 * returned). A local-only revert leaves takeoff_items and the draft
 * estimate on the edited quantity.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface GeometryRevision {
  points: Point2[];
  quantity: number;
}

export interface ManualGeometryPatchBody {
  id: string;
  row_version: number;
  quantity: number;
  unit: string;
  cost_code: string | null;
  geometry: {
    points: Point2[];
    coordinate_space: "page_space";
    label?: string;
    assembly_key?: string | null;
  };
}

interface PersistedGeometryRevisionArgs {
  id: string;
  /** row_version returned by the commit PATCH — the version now on the server. */
  rowVersion: number;
  unit: string;
  costCode: string | null;
  label?: string;
  assemblyKey?: string | null;
  before: GeometryRevision;
  after: GeometryRevision;
}

export class PersistedGeometryRevision {
  private rowVersion: number;
  private readonly args: PersistedGeometryRevisionArgs;

  constructor(args: PersistedGeometryRevisionArgs) {
    this.args = {
      ...args,
      before: { quantity: args.before.quantity, points: args.before.points.map((p) => ({ x: p.x, y: p.y })) },
      after: { quantity: args.after.quantity, points: args.after.points.map((p) => ({ x: p.x, y: p.y })) },
    };
    this.rowVersion = args.rowVersion;
  }

  get version(): number {
    return this.rowVersion;
  }

  undoBody(): ManualGeometryPatchBody {
    return this.body(this.args.before);
  }

  redoBody(): ManualGeometryPatchBody {
    return this.body(this.args.after);
  }

  /** Call only after the server accepts the patch. */
  accept(rowVersion: number): void {
    this.rowVersion = rowVersion;
  }

  private body(rev: GeometryRevision): ManualGeometryPatchBody {
    return {
      id: this.args.id,
      row_version: this.rowVersion,
      quantity: rev.quantity,
      unit: this.args.unit,
      cost_code: this.args.costCode,
      geometry: {
        points: rev.points.map((p) => ({ x: p.x, y: p.y })),
        coordinate_space: "page_space",
        label: this.args.label,
        assembly_key: this.args.assemblyKey,
      },
    };
  }
}
