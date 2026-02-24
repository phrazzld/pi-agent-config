import { describe, expect, test } from "bun:test";

import { evaluateCommandSafety } from "../policy";

describe("guardrails policy", () => {
  test("allows safe command", () => {
    const decision = evaluateCommandSafety("git status");
    expect(decision.block).toBe(false);
  });

  test("blocks rm command", () => {
    const decision = evaluateCommandSafety("rm -rf node_modules");
    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("trash");
  });

  test("blocks git rebase command", () => {
    const decision = evaluateCommandSafety("git rebase main");
    expect(decision.block).toBe(true);
    expect(decision.reason).toContain("merge");
  });

  test("blocks force push command", () => {
    const decision = evaluateCommandSafety("git push --force origin HEAD");
    expect(decision.block).toBe(true);
  });

  test("blocks amend commit command", () => {
    const decision = evaluateCommandSafety("git commit --amend --no-edit");
    expect(decision.block).toBe(true);
  });
});
