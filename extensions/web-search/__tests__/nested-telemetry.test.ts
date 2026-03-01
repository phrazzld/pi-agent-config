import path from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveWebSearchLogPath } from "../telemetry";

describe("web-search nested telemetry gating", () => {
  test("enables logs at top level by default", () => {
    const base = "/tmp/pi-config";
    expect(resolveWebSearchLogPath(base, 0, {})).toBe(path.join(base, "logs", "web-search.ndjson"));
  });

  test("disables logs in delegated depth unless override is set", () => {
    const base = "/tmp/pi-config";
    expect(resolveWebSearchLogPath(base, 2, {})).toBeUndefined();

    expect(
      resolveWebSearchLogPath(base, 2, {
        PI_WEB_SEARCH_ENABLE_NESTED_LOG: "true",
      }),
    ).toBe(path.join(base, "logs", "web-search.ndjson"));
  });
});
