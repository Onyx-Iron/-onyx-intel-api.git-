/**
 * Pro Fluid Compute limits this portal is built against.
 * maxDuration exports stay numeric literals in each route: Next.js only
 * picks up a statically analyzable number.
 *
 * Generally available cap: 800 seconds.
 * Extended beta on Node.js 24: 1800 seconds. A later Secure Compute or
 * Static IP attachment cannot run above 800 seconds.
 * Request bodies: 100 MB. Callers stay under that.
 */
export const FUNCTION_BODY_LIMIT_BYTES = 80 * 1024 * 1024;
