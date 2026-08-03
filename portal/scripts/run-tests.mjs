import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "unit" && mode !== "integration") {
  console.error("Usage: node scripts/run-tests.mjs <unit|integration>");
  process.exit(1);
}

const root = process.cwd();
const ignoredDirs = new Set(["node_modules", ".next", "out", "build"]);

function isIgnoredDirectory(entry, relPath) {
  const normalizedPath = relPath.replaceAll("\\", "/");
  return (
    ignoredDirs.has(entry) ||
    entry.startsWith("node_modules-") ||
    normalizedPath === "supabase/functions"
  );
}

function walk(dir) {
  const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = relative(root, fullPath);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (isIgnoredDirectory(entry, relPath)) {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (stat.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = walk(root)
  .filter((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"))
  .filter((file) => {
    const integration = file.endsWith(".integration.test.ts") || file.endsWith(".integration.test.tsx");
    return mode === "integration" ? integration : !integration;
  })
  .map((file) => relative(root, file));

if (testFiles.length === 0) {
  console.log(`No ${mode} tests found.`);
  process.exit(0);
}

const tsxCli = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const command = existsSync(tsxCli) ? process.execPath : "tsx";
const baseArgs = existsSync(tsxCli) ? [tsxCli, "--test"] : ["--test"];
let exitCode = 0;

for (const testFile of testFiles) {
  const result = spawnSync(command, [...baseArgs, testFile], { stdio: "inherit" });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status != null && result.status !== 0) {
    exitCode = result.status;
  }
}

process.exit(exitCode);
