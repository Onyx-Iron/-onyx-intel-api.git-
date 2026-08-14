import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const command = existsSync(tsxCli) ? process.execPath : "tsx";
const args = existsSync(tsxCli)
  ? [tsxCli, "scripts/verify-test-schema.ts"]
  : ["scripts/verify-test-schema.ts"];
const result = spawnSync(command, args, { stdio: "inherit", env: process.env });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
