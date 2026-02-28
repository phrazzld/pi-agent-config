import { describe, expect, test } from "bun:test";

import {
  currentOrchestrationDepth,
  isTopLevelTelemetryEnabled,
  isTruthyEnvFlag,
} from "../depth-telemetry";

describe("depth telemetry helpers", () => {
  test("currentOrchestrationDepth clamps invalid values", () => {
    expect(currentOrchestrationDepth({ PI_ORCH_DEPTH: "2" })).toBe(2);
    expect(currentOrchestrationDepth({ PI_ORCH_DEPTH: "-1" })).toBe(0);
    expect(currentOrchestrationDepth({ PI_ORCH_DEPTH: "abc" })).toBe(0);
    expect(currentOrchestrationDepth({})).toBe(0);
  });

  test("isTruthyEnvFlag parses common true variants", () => {
    expect(isTruthyEnvFlag("true")).toBe(true);
    expect(isTruthyEnvFlag(" 1 ")).toBe(true);
    expect(isTruthyEnvFlag("yes")).toBe(true);
    expect(isTruthyEnvFlag("on")).toBe(true);
    expect(isTruthyEnvFlag("false")).toBe(false);
    expect(isTruthyEnvFlag("0")).toBe(false);
    expect(isTruthyEnvFlag(undefined)).toBe(false);
  });

  test("isTopLevelTelemetryEnabled defaults to top-level-only", () => {
    const flag = "PI_EXAMPLE_ENABLE_NESTED";

    expect(isTopLevelTelemetryEnabled(flag, { PI_ORCH_DEPTH: "0" })).toBe(true);
    expect(isTopLevelTelemetryEnabled(flag, { PI_ORCH_DEPTH: "1" })).toBe(false);
    expect(
      isTopLevelTelemetryEnabled(flag, {
        PI_ORCH_DEPTH: "2",
        [flag]: "true",
      }),
    ).toBe(true);
  });
});
