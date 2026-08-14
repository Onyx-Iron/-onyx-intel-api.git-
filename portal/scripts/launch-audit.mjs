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
  "ONYX_PLATFORM_ADMIN_EMAILS",
  "CRON_SECRET",
  "PADDLE_ENV",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "PADDLE_PRICE_SOLO_MONTHLY",
  "PADDLE_PRICE_SOLO_YEARLY",
  "PADDLE_PRICE_CREW_MONTHLY",
  "PADDLE_PRICE_CREW_YEARLY",
  "PADDLE_PRICE_BUSINESS_MONTHLY",
  "PADDLE_PRICE_BUSINESS_YEARLY",
];

function envValue(key) {
  return localEnv[key] ?? testEnv[key] ?? process.env[key];
}

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
  const sourceValue = envValue(key);
  console.log(`- ${key}: ${present(sourceValue)}${sourceValue ? ` (${mask(sourceValue)})` : ""}`);
}

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
console.log(`- document upload route exists: ${existsSync(resolve(appRoot, "app", "api", "documents", "upload", "route.ts")) ? "yes" : "no"}`);
console.log(`- document ingest route exists: ${existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "ingest", "route.ts")) ? "yes" : "no"}`);
console.log(`- document status route exists: ${existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "status", "route.ts")) ? "yes" : "no"}`);
console.log(`- document retry route exists: ${existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "retry", "route.ts")) ? "yes" : "no"}`);
console.log(`- automated takeoff job route exists: ${existsSync(resolve(appRoot, "app", "api", "takeoff", "jobs", "route.ts")) ? "yes" : "no"}`);
console.log(`- approval preview route exists: ${existsSync(resolve(appRoot, "app", "api", "takeoff", "approval-preview", "route.ts")) ? "yes" : "no"}`);
console.log(`- takeoff recovery route exists: ${existsSync(resolve(appRoot, "app", "api", "internal", "takeoff", "recover", "route.ts")) ? "yes" : "no"}`);
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
if (!existsSync(resolve(appRoot, "app", "api", "documents", "upload", "route.ts"))) {
  blockers.push("Document upload route is missing");
}
if (!existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "ingest", "route.ts"))) {
  blockers.push("Document ingest route is missing");
}
if (!existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "status", "route.ts"))) {
  blockers.push("Document status route is missing");
}
if (!existsSync(resolve(appRoot, "app", "api", "documents", "[id]", "retry", "route.ts"))) {
  blockers.push("Document retry route is missing");
}
if (!localEnv.CRON_SECRET && !process.env.CRON_SECRET) {
  blockers.push("CRON_SECRET is missing; Vercel cannot authenticate scheduled takeoff recovery");
}
if (!localEnv.ONYX_PLATFORM_ADMIN_EMAILS && !process.env.ONYX_PLATFORM_ADMIN_EMAILS) {
  blockers.push("ONYX_PLATFORM_ADMIN_EMAILS is missing; privileged maintenance and account access are disabled");
}
if (!["PADDLE_ENV", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"].every((key) => envValue(key))) {
  blockers.push("Paddle billing env is incomplete; paid signup, checkout, and webhook reconciliation are disabled");
}
if (!["PADDLE_PRICE_SOLO_MONTHLY", "PADDLE_PRICE_SOLO_YEARLY", "PADDLE_PRICE_CREW_MONTHLY", "PADDLE_PRICE_CREW_YEARLY", "PADDLE_PRICE_BUSINESS_MONTHLY", "PADDLE_PRICE_BUSINESS_YEARLY"].every((key) => envValue(key))) {
  blockers.push("Paddle product prices are incomplete; at least one sellable plan or billing cycle cannot be purchased");
}
for (const [label, parts] of [
  ["Automated takeoff job route", ["app", "api", "takeoff", "jobs", "route.ts"]],
  ["Approval preview route", ["app", "api", "takeoff", "approval-preview", "route.ts"]],
  ["Takeoff recovery route", ["app", "api", "internal", "takeoff", "recover", "route.ts"]],
  ["Takeoff certification report", ["fixtures", "takeoff", "certification-report.json"]],
]) {
  if (!existsSync(resolve(appRoot, ...parts))) blockers.push(`${label} is missing`);
}
const certificationPath = resolve(appRoot, "fixtures", "takeoff", "certification-report.json");
if (existsSync(certificationPath)) {
  const certification = JSON.parse(readFileSync(certificationPath, "utf8"));
  const summary = certification.summary ?? {};
  console.log(`- takeoff certification: ${summary.certified ?? 0} certified, ${summary.provisional ?? 0} provisional, ${summary.blocked ?? 0} blocked`);
  if ((summary.provisional ?? 0) > 0 || (summary.blocked ?? 0) > 0 || (summary.certified ?? 0) === 0) {
    blockers.push("Automated takeoff certification is incomplete; blocked or provisional capabilities must not be marketed as flawless");
  }
}
console.log("## Status");
if (blockers.length === 0) {
  console.log("- no repo-detectable launch blockers found");
} else {
  for (const blocker of blockers) {
    console.log(`- ${blocker}`);
  }
  process.exitCode = 1;
}
