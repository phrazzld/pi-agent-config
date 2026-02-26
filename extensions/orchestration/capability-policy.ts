export type WorkflowTarget = "meta" | "build" | "ops" | "daybook" | "slice" | "unknown";

export function resolveWorkflowTarget(env: NodeJS.ProcessEnv = process.env): WorkflowTarget {
  const raw = String(env.PI_WORKFLOW_TARGET ?? "").trim().toLowerCase();
  if (raw === "meta" || raw === "build" || raw === "ops" || raw === "daybook" || raw === "slice") {
    return raw;
  }
  return "unknown";
}

export function isAutopilotPipelineName(pipelineName: string): boolean {
  const normalized = pipelineName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === "autopilot" ||
    normalized.startsWith("autopilot-") ||
    normalized.startsWith("repo-autopilot-") ||
    normalized.includes("autopilot-v");
}

export function isPipelineAllowedForTarget(pipelineName: string, target: WorkflowTarget): boolean {
  if (!isAutopilotPipelineName(pipelineName)) {
    return true;
  }

  return target === "build" || target === "unknown";
}

export function pipelineTargetScopeHint(pipelineName: string): string | null {
  if (!isAutopilotPipelineName(pipelineName)) {
    return null;
  }

  return "build-only capability";
}

export function buildPipelineCapabilityMessage(
  pipelineName: string,
  target: WorkflowTarget,
): string | null {
  if (isPipelineAllowedForTarget(pipelineName, target)) {
    return null;
  }

  return `Pipeline ${pipelineName} is build-only. Relaunch with pictl build to run autopilot capabilities.`;
}
