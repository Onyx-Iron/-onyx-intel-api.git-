const baseUrl = (process.env.LAUNCH_SMOKE_BASE_URL ?? "https://app.onyx-iron.com").replace(/\/$/, "");
const urls = {
  home: `${baseUrl}/`,
  dashboard: `${baseUrl}/dashboard`,
  signIn: `${baseUrl}/sign-in`,
  signUp: `${baseUrl}/sign-up`,
  takeoffJobs: `${baseUrl}/api/takeoff/jobs?project_id=smoke-test`,
  testHarness: `${baseUrl}/e2e/takeoff`,
};

async function head(url) {
  const res = await fetch(url, { redirect: "manual" });
  return {
    status: res.status,
    location: res.headers.get("location"),
    clerkReason: res.headers.get("x-clerk-auth-reason"),
    clerkStatus: res.headers.get("x-clerk-auth-status"),
  };
}

async function text(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
}

const dashboard = await head(urls.dashboard);
const home = await head(urls.home);
const signIn = await text(urls.signIn);
const signUp = await text(urls.signUp);
const takeoffJobs = await head(urls.takeoffJobs);
const testHarness = await head(urls.testHarness);

const checks = [
  {
    name: "home redirects to dashboard",
    ok: home.status >= 300 && home.status < 400 && home.location === "/dashboard",
    detail: `${home.status} ${home.location ?? ""}`.trim(),
  },
  {
    name: "dashboard redirects to sign-in",
    ok: dashboard.status >= 300 && dashboard.status < 400 && dashboard.location === "/sign-in",
    detail: `${dashboard.status} ${dashboard.location ?? ""}`.trim(),
  },
  {
    name: "dashboard is normal signed-out state",
    ok: dashboard.clerkStatus === "signed-out" && dashboard.clerkReason === "session-token-and-uat-missing",
    detail: `status=${dashboard.clerkStatus ?? "missing"} reason=${dashboard.clerkReason ?? "missing"}`,
  },
  {
    name: "sign-in page does not mention accounts.dev",
    ok: !signIn.body.includes("accounts.dev"),
    detail: signIn.body.includes("accounts.dev") ? "accounts.dev present" : "clean",
  },
  {
    name: "sign-up page does not mention accounts.dev",
    ok: !signUp.body.includes("accounts.dev"),
    detail: signUp.body.includes("accounts.dev") ? "accounts.dev present" : "clean",
  },
  {
    name: "takeoff job API rejects anonymous access",
    ok: takeoffJobs.status === 401 || (takeoffJobs.status >= 300 && takeoffJobs.status < 400 && takeoffJobs.location?.startsWith("/sign-in")),
    detail: `${takeoffJobs.status} ${takeoffJobs.location ?? ""}`.trim(),
  },
  {
    name: "browser-test harness is unavailable outside test mode",
    ok: testHarness.status === 404 || (testHarness.status >= 300 && testHarness.status < 400 && testHarness.location?.startsWith("/sign-in")),
    detail: `${testHarness.status} ${testHarness.location ?? ""}`.trim(),
  },
];

console.log("# Launch Smoke");
for (const check of checks) {
  console.log(`- ${check.ok ? "pass" : "fail"}: ${check.name} (${check.detail})`);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  process.exitCode = 1;
}
