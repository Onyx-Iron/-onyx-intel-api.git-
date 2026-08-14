import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:process";

const portalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(portalRoot, "..");

const steps = [
  { label: "TypeScript", command: "npm", args: ["run", "typecheck"] },
  { label: "Lint", command: "npm", args: ["run", "lint"] },
  { label: "Unit tests", command: "npm", args: ["run", "test:unit"] },
  { label: "Isolated database tests", command: "npm", args: ["run", "test:integration"], env: { REQUIRE_INTEGRATION_TESTS: "true" } },
  { label: "Browser acceptance", command: "npm", args: ["run", "test:browser"] },
  { label: "Python takeoff tests", command: process.env.PYTHON_EXECUTABLE ?? (platform === "win32" ? "python" : "python3"), args: ["-m", "unittest", "-v"], cwd: repoRoot },
  { label: "Takeoff certification", command: "npm", args: ["run", "evaluate:takeoff"] },
  { label: "Production build", command: "npm", args: ["run", "build"] },
  { label: "Repository launch audit", command: "npm", args: ["run", "launch:audit"] },
  { label: "Live signed-out smoke", command: "npm", args: ["run", "launch:smoke"] },
];

for (const step of steps) {
  console.log(`\n## ${step.label}`);
  const options = { cwd: step.cwd ?? portalRoot, stdio: "inherit", env: { ...process.env, ...step.env } };
  const result = platform === "win32" && step.command === "npm"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", ...step.args], options)
    : spawnSync(step.command, step.args, options);
  if (result.error) {
    console.error(`${step.label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`${step.label} failed with exit code ${result.status ?? 1}.`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll launch gates passed.");
