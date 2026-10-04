/// <reference types="next/image-types/global" />

// `next-env.d.ts` is gitignored, so CI typecheck never loads Next's image
// module declarations. This keeps static asset imports such as the brand PNG
// assignable without generating that file first.
export {};
