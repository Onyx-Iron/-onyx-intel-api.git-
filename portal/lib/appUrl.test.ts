import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("appUrl", () => {
  it("does not hard-code production as the only fallback", () => {
    const src = readFileSync(join(process.cwd(), "lib/appUrl.ts"), "utf8");
    assert.match(src, /VERCEL_ENV/);
    assert.match(src, /VERCEL_URL/);
    assert.match(src, /NEXT_PUBLIC_APP_URL/);
    assert.match(src, /localhost:3000/);
  });

  it("is used by Clerk layout and auth pages", () => {
    for (const rel of [
      "app/layout.tsx",
      "app/sign-in/[[...sign-in]]/page.tsx",
      "app/sign-up/[[...sign-up]]/page.tsx",
      "lib/google/oauth.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.match(src, /getAppOrigin/, `missing getAppOrigin in ${rel}`);
      assert.doesNotMatch(
        src,
        /NEXT_PUBLIC_APP_URL \|\| "https:\/\/app\.onyx-iron\.com"/,
        `stale prod fallback in ${rel}`,
      );
    }
  });
});
