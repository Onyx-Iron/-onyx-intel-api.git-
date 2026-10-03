import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { authorizeOutboxCron, authorizeOutboxPost } from "./outbox-cron-auth.ts";

const ORIGINAL = {
  worker: process.env.INTERNAL_WORKER_SECRET,
  cron: process.env.CRON_SECRET,
};

afterEach(() => {
  if (ORIGINAL.worker === undefined) delete process.env.INTERNAL_WORKER_SECRET;
  else process.env.INTERNAL_WORKER_SECRET = ORIGINAL.worker;
  if (ORIGINAL.cron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL.cron;
});

describe("outbox worker auth", () => {
  it("rejects a POST when the worker secret is missing or wrong", () => {
    delete process.env.INTERNAL_WORKER_SECRET;
    const missing = authorizeOutboxPost(new Headers());
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 500);

    process.env.INTERNAL_WORKER_SECRET = "worker-secret";
    const wrong = authorizeOutboxPost(new Headers({ "x-worker-secret": "nope" }));
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.status, 401);

    const ok = authorizeOutboxPost(new Headers({ "x-worker-secret": "worker-secret" }));
    assert.equal(ok.ok, true);
  });

  it("accepts the Vercel cron bearer or the worker header, and fails closed otherwise", () => {
    delete process.env.CRON_SECRET;
    delete process.env.INTERNAL_WORKER_SECRET;
    const closed = authorizeOutboxCron(new Headers({ authorization: "Bearer anything" }));
    assert.equal(closed.ok, false);
    if (!closed.ok) assert.equal(closed.status, 401);

    process.env.CRON_SECRET = "cron-secret";
    const cron = authorizeOutboxCron(new Headers({ authorization: "Bearer cron-secret" }));
    assert.equal(cron.ok, true);

    const wrongBearer = authorizeOutboxCron(new Headers({ authorization: "Bearer other" }));
    assert.equal(wrongBearer.ok, false);

    process.env.INTERNAL_WORKER_SECRET = "worker-secret";
    const worker = authorizeOutboxCron(new Headers({ "x-worker-secret": "worker-secret" }));
    assert.equal(worker.ok, true);
  });
});
