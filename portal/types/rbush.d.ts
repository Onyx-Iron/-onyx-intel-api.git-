declare module "rbush" {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  export default class RBush<T extends BBox> {
    load(items: T[]): this;
    search(box: BBox): T[];
  }
}
