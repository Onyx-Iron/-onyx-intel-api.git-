// Fail-closed environment variable access. A production deploy with a blank
// NEXT_PUBLIC_SUPABASE_URL (or similar) has repeatedly reached runtime
// before -- Vercel accepts an empty-string env var without complaint, and a
// bare `process.env.X!` non-null assertion happily forwards that empty
// string into whatever client reads it next, surfacing as a confusing
// third-party error (or a silently broken feature) far from the real cause.
// requireEnv() throws immediately, with the variable name, at the point of
// use instead.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function requireEnvOneOf(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value;
  }
  throw new Error(`Missing required environment variable: one of [${names.join(", ")}]`);
}
