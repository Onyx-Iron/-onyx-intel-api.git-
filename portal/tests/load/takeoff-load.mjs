import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsxCli)) {
  console.error("tsx is required to run the takeoff load gate");
  process.exit(1);
}
const result = spawnSync(process.execPath, [tsxCli, resolve(root, "tests", "load", "takeoff-load-worker.ts")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
