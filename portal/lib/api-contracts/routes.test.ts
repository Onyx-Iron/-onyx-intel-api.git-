import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type HttpMethod = typeof HTTP_METHODS[number];

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ["node_modules", ".next", "build", "out"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function routeMatches(caller: string, route: string): boolean {
  const callerParts = caller.split("/");
  const routeParts = route.split("/");
  return callerParts.length === routeParts.length && callerParts.every((part, index) =>
    part === routeParts[index]
      || (/^\[[^\]]+\]$/.test(part) && /^\[[^\]]+\]$/.test(routeParts[index])),
  );
}

function fetchPath(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.templateSpans.reduce(
    (path, span) => {
      const dynamicSegment = path.endsWith("/") || span.literal.text.startsWith("/") ? "[id]" : "";
      return `${path}${dynamicSegment}${span.literal.text}`;
    },
    node.head.text,
  );
}

function fetchMethod(node: ts.Expression | undefined, source: ts.SourceFile): HttpMethod {
  if (!node || !ts.isObjectLiteralExpression(node)) return "GET";
  const property = node.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate)
      && candidate.name.getText(source).replace(/["']/g, "") === "method",
  );
  if (!property || !ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) return "GET";
  const value = property.initializer.text.toUpperCase();
  return HTTP_METHODS.includes(value as HttpMethod) ? value as HttpMethod : "GET";
}

describe("frontend API route contracts", () => {
  it("has a matching route and HTTP method for every statically discoverable fetch", () => {
    const appRoot = join(process.cwd(), "app");
    const routeRoot = join(appRoot, "api");
    const routes = filesBelow(routeRoot)
      .filter((file) => file.endsWith("route.ts"))
      .map((file) => {
        const source = readFileSync(file, "utf8");
        return {
          path: `/api/${relative(routeRoot, dirname(file)).replaceAll("\\", "/")}`,
          methods: new Set([...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
            .map((match) => match[1] as HttpMethod)),
        };
      });

    const callers: Array<{ file: string; path: string; method: HttpMethod }> = [];
    for (const root of ["app", "components", "lib"].map((directory) => join(process.cwd(), directory))) {
      for (const file of filesBelow(root).filter((candidate) => /\.(ts|tsx)$/.test(candidate))) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
            const rawPath = node.arguments[0] ? fetchPath(node.arguments[0]) : null;
            if (rawPath?.startsWith("/api/")) {
              callers.push({
                file: relative(process.cwd(), file),
                path: rawPath.split("?")[0],
                method: fetchMethod(node.arguments[1], source),
              });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }

    const missing = callers.flatMap((caller) => {
      const route = routes.find((candidate) => routeMatches(caller.path, candidate.path));
      if (!route) return [`${caller.method} ${caller.path}: route missing (${caller.file})`];
      if (!route.methods.has(caller.method)) {
        return [`${caller.method} ${caller.path}: handler missing; found ${[...route.methods].join(",")} (${caller.file})`];
      }
      return [];
    }).sort();

    assert.deepEqual(missing, []);
  });
});
