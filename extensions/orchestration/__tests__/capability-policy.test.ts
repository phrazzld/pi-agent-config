import { describe, expect, test } from "bun:test";

import {
  buildPipelineCapabilityMessage,
  isAutopilotPipelineName,
  isPipelineAllowedForTarget,
  pipelineTargetScopeHint,
  resolveWorkflowTarget,
} from "../capability-policy";

describe("orchestration capability policy", () => {
  test("resolves workflow target from environment", () => {
    expect(resolveWorkflowTarget({ PI_WORKFLOW_TARGET: "build" } as NodeJS.ProcessEnv)).toBe("build");
    expect(resolveWorkflowTarget({ PI_WORKFLOW_TARGET: "meta" } as NodeJS.ProcessEnv)).toBe("meta");
    expect(resolveWorkflowTarget({ PI_WORKFLOW_TARGET: "" } as NodeJS.ProcessEnv)).toBe("unknown");
  });

  test("detects autopilot pipeline names", () => {
    expect(isAutopilotPipelineName("autopilot-v1")).toBe(true);
    expect(isAutopilotPipelineName("repo-autopilot-v2")).toBe(true);
    expect(isAutopilotPipelineName("software-delivery-v1")).toBe(false);
  });

  test("build target can run autopilot pipelines", () => {
    expect(isPipelineAllowedForTarget("autopilot-v1", "build")).toBe(true);
    expect(isPipelineAllowedForTarget("autopilot-v1", "meta")).toBe(false);
    expect(isPipelineAllowedForTarget("autopilot-v1", "ops")).toBe(false);
  });

  test("non-autopilot pipelines are allowed in every target", () => {
    expect(isPipelineAllowedForTarget("meta-refactor-v1", "meta")).toBe(true);
    expect(isPipelineAllowedForTarget("software-delivery-v1", "ops")).toBe(true);
  });

  test("scope hint and message are emitted for autopilot outside build", () => {
    expect(pipelineTargetScopeHint("autopilot-v1")).toBe("build-only capability");
    const message = buildPipelineCapabilityMessage("autopilot-v1", "meta");
    expect(message).toContain("build-only");
    expect(buildPipelineCapabilityMessage("autopilot-v1", "build")).toBeNull();
  });
});
