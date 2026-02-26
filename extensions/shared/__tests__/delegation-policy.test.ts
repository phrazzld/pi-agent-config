import { describe, expect, test } from "bun:test";

import {
  canInvokeSubagentTool,
  canInvokeTeamTools,
  formatDelegationPolicyBlock,
  resolveDelegationCaller,
  withDelegationCaller,
} from "../delegation-policy";

describe("delegation policy", () => {
  test("resolves master caller when env is unset", () => {
    expect(resolveDelegationCaller({})).toBe("master");
  });

  test("resolves known delegated callers", () => {
    expect(resolveDelegationCaller({ PI_DELEGATED_BY: "team" })).toBe("team");
    expect(resolveDelegationCaller({ PI_DELEGATED_BY: "subagent" })).toBe("subagent");
    expect(resolveDelegationCaller({ PI_DELEGATED_BY: "TEAM" })).toBe("team");
  });

  test("unknown caller is non-master", () => {
    expect(resolveDelegationCaller({ PI_DELEGATED_BY: "weird" })).toBe("unknown");
    expect(canInvokeTeamTools("unknown")).toBe(false);
  });

  test("team tools are master-only", () => {
    expect(canInvokeTeamTools("master")).toBe(true);
    expect(canInvokeTeamTools("team")).toBe(false);
    expect(canInvokeTeamTools("subagent")).toBe(false);
  });

  test("subagent tool is blocked only for subagent caller", () => {
    expect(canInvokeSubagentTool("master")).toBe(true);
    expect(canInvokeSubagentTool("team")).toBe(true);
    expect(canInvokeSubagentTool("subagent")).toBe(false);
  });

  test("child env tags delegated caller", () => {
    const env = withDelegationCaller({ PATH: "/usr/bin" }, "subagent");
    expect(env.PI_DELEGATED_BY).toBe("subagent");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("policy block messages are explicit", () => {
    expect(formatDelegationPolicyBlock("subagent", "subagent")).toContain("subagents may not invoke subagents");
    expect(formatDelegationPolicyBlock("team_run", "team")).toContain("master-only");
  });
});
