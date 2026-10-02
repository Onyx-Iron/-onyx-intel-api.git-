import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const appRoot = existsSync(resolve(repoRoot, "portal")) ? resolve(repoRoot, "portal") : repoRoot;

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const text = readFileSync(filePath, "utf8");
  const env = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function present(value) {
  return value ? "set" : "missing";
}

function mask(value) {
  if (!value) return "missing";
  if (value.length <= 8) return "set";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const localEnv = parseEnvFile(resolve(appRoot, ".env.local"));
const testEnv = parseEnvFile(resolve(appRoot, ".env.test.local"));
const vercelProjectPath = resolve(repoRoot, ".vercel", "project.json");
const vercelProject = existsSync(vercelProjectPath)
  ? JSON.parse(readFileSync(vercelProjectPath, "utf8"))
  : null;

const requiredLaunchEnv = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PADDLE_ENV",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
];

/** Ops secrets that unlock scheduled outbox redrive + real CI integration gates. */
const opsReliabilityEnv = [
  "CRON_SECRET",
  "INTERNAL_WORKER_SECRET",
  "TEST_SUPABASE_URL",
  "TEST_SUPABASE_SERVICE_ROLE_KEY",
];

console.log("# Launch Audit");
console.log("");
console.log(`- app root: ${appRoot}`);
console.log(`- repo root: ${repoRoot}`);
console.log("");

if (vercelProject) {
  console.log("## Vercel");
  console.log(`- project: ${vercelProject.projectName} (${vercelProject.projectId})`);
  console.log(`- org: ${vercelProject.orgId}`);
  console.log(`- local link: present`);
  console.log("");
}

console.log("## Environment");
for (const key of requiredLaunchEnv) {
  const sourceValue = localEnv[key] ?? testEnv[key] ?? process.env[key];
  console.log(`- ${key}: ${present(sourceValue)}${sourceValue ? ` (${mask(sourceValue)})` : ""}`);
}

console.log("");
console.log("## Ops / reliability");
for (const key of opsReliabilityEnv) {
  const sourceValue = localEnv[key] ?? testEnv[key] ?? process.env[key];
  console.log(`- ${key}: ${present(sourceValue)}${sourceValue ? ` (${mask(sourceValue)})` : ""}`);
}
console.log("- OUTBOX_APP_URL: (GitHub Actions secret only — not a portal env var)");
console.log("  Set OUTBOX_APP_URL + CRON_SECRET as repo Actions secrets for .github/workflows/outbox-redrive.yml");
console.log("  Set CRON_SECRET (same value) on Vercel so /api/internal/outbox/process accepts cron calls");
console.log("");

console.log("## Clerk routing");
console.log(`- sign-in route: ${localEnv.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in (default)"}`);
console.log(`- sign-up route: ${localEnv.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up (default)"}`);
console.log(`- after sign-in: ${localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/dashboard (default)"}`);
console.log(`- after sign-up: ${localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/dashboard (default)"}`);
console.log("");

console.log("## Repo Signals");
console.log(`- ClerkProvider explicitly configured: ${existsSync(resolve(appRoot, "app", "layout.tsx")) ? "yes" : "unknown"}`);
console.log(`- dedicated sign-in page exists: ${existsSync(resolve(appRoot, "app", "sign-in", "[[...sign-in]]", "page.tsx")) ? "yes" : "no"}`);
console.log(`- dedicated sign-up page exists: ${existsSync(resolve(appRoot, "app", "sign-up", "[[...sign-up]]", "page.tsx")) ? "yes" : "no"}`);
console.log("");

const blockers = [];
if (!localEnv.NEXT_PUBLIC_CLERK_SIGN_IN_URL || localEnv.NEXT_PUBLIC_CLERK_SIGN_IN_URL !== "/sign-in") {
  blockers.push("Clerk sign-in URL should be /sign-in");
}
if (!localEnv.NEXT_PUBLIC_CLERK_SIGN_UP_URL || localEnv.NEXT_PUBLIC_CLERK_SIGN_UP_URL !== "/sign-up") {
  blockers.push("Clerk sign-up URL should be /sign-up");
}
if (!localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL || localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL !== "/dashboard") {
  blockers.push("Clerk after-sign-in URL should be /dashboard");
}
if (!localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || localEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL !== "/dashboard") {
  blockers.push("Clerk after-sign-up URL should be /dashboard");
}
if (!localEnv.PADDLE_ENV || localEnv.PADDLE_ENV !== "live") {
  blockers.push("Paddle live env is not set");
}

console.log("## Status");
if (blockers.length === 0) {
  console.log("- no repo-detectable launch blockers found");
} else {
  for (const blocker of blockers) {
    console.log(`- ${blocker}`);
  }
}
