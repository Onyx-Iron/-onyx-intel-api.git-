/** Static image imports (CI typecheck has no `.next` image ambient types). */
declare module "*.png" {
  const src: string | { src: string; height: number; width: number; blurDataURL?: string };
  export default src;
}

declare module "*.jpg" {
  const src: string | { src: string; height: number; width: number; blurDataURL?: string };
  export default src;
}

declare module "*.jpeg" {
  const src: string | { src: string; height: number; width: number; blurDataURL?: string };
  export default src;
}

declare module "*.webp" {
  const src: string | { src: string; height: number; width: number; blurDataURL?: string };
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}
