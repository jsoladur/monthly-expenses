import { test } from "@playwright/test";

// Per-test unique id for seeded e2e users. Playwright runs the chromium and
// mobile-safari projects in parallel, so a `Date.now()` stamp alone can
// collide: two tests share one user and wipe each other's rows. The id mixes
// the project name, this worker process, and the test id. Call it inside a
// test (it reads `test.info()`); it returns the same value for the whole test.
const runTag = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export function uniqueId(): string {
  const info = test.info();
  return `${info.project.name}-${runTag}-${info.testId}`;
}
