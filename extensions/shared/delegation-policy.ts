export const PI_DELEGATED_BY_ENV = "PI_DELEGATED_BY";

export type DelegationCaller = "master" | "team" | "subagent" | "unknown";

export function resolveDelegationCaller(
  env: Record<string, string | undefined> = process.env,
): DelegationCaller {
  const raw = String(env[PI_DELEGATED_BY_ENV] ?? "").trim().toLowerCase();
  if (!raw) {
    return "master";
  }
  if (raw === "team") {
    return "team";
  }
  if (raw === "subagent") {
    return "subagent";
  }
  return "unknown";
}

export function withDelegationCaller(
  env: NodeJS.ProcessEnv,
  caller: Exclude<DelegationCaller, "master" | "unknown">,
): NodeJS.ProcessEnv {
  return {
    ...env,
    [PI_DELEGATED_BY_ENV]: caller,
  };
}

export function canInvokeTeamTools(caller: DelegationCaller): boolean {
  return caller === "master";
}

export function canInvokeSubagentTool(caller: DelegationCaller): boolean {
  return caller !== "subagent";
}

export function formatDelegationPolicyBlock(toolName: string, caller: DelegationCaller): string {
  if (toolName === "subagent") {
    return `[delegation-policy] subagents may not invoke subagents (caller=${caller}).`;
  }

  return `[delegation-policy] ${toolName} is master-only (caller=${caller}).`;
}
