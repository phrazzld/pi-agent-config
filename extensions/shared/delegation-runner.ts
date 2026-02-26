import { spawn } from "node:child_process";

import {
  DelegatedRunHealthMonitor,
  resolveDelegatedHealthPolicy,
  type DelegatedHealthPolicy,
  type DelegatedHealthSnapshot,
  type DelegatedHealthSummary,
} from "./delegated-health";

export type DelegatedAbortOrigin = "signal" | "health" | "budget" | "policy" | "external";

export interface DelegatedRunnerProgressMarker {
  kind: "tool_start" | "tool_end" | "assistant" | "assistant_error" | "other";
  action: string;
  toolName?: string;
  fingerprint?: string;
}

export interface DelegatedRunnerLineOutcome {
  marker?: DelegatedRunnerProgressMarker;
  abortReason?: string;
  abortOrigin?: DelegatedAbortOrigin;
}

export interface DelegatedRunnerWatchdog {
  intervalMs: number;
  origin?: DelegatedAbortOrigin;
  evaluate: () => string | undefined;
}

export interface RunDelegatedCommandOptions {
  label: string;
  args: string[];
  cwd: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  runtimeLimitSeconds?: number;
  forceKillAfterMs?: number;
  tickIntervalMs?: number;
  onTick?: () => void;
  onStdoutLine?: (line: string) => DelegatedRunnerLineOutcome | DelegatedRunnerProgressMarker | void;
  onStderr?: (text: string) => void;
  watchdogs?: DelegatedRunnerWatchdog[];
  onHealthWarning?: (warning: string, snapshot: DelegatedHealthSnapshot) => void;
  healthPolicyOverrides?: Partial<DelegatedHealthPolicy>;
}

export interface DelegatedRunOutcome {
  exitCode: number;
  stderr: string;
  aborted: boolean;
  abortOrigin?: DelegatedAbortOrigin;
  abortReason?: string;
  health: DelegatedHealthSummary;
}

export async function runDelegatedCommand(options: RunDelegatedCommandOptions): Promise<DelegatedRunOutcome> {
  const healthPolicy = resolveDelegatedHealthPolicy(process.env, options.healthPolicyOverrides ?? {});
  const health = new DelegatedRunHealthMonitor(options.label, healthPolicy);

  return await new Promise<DelegatedRunOutcome>((resolve) => {
    const command = options.command ?? "pi";
    const child = spawn(command, options.args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: options.env ?? process.env,
    });

    health.noteEvent("spawn");

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let aborted = false;
    let abortOrigin: DelegatedAbortOrigin | undefined;
    let abortReason: string | undefined;
    let closed = false;
    let settled = false;

    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let runtimeTimer: ReturnType<typeof setTimeout> | null = null;
    let healthTimer: ReturnType<typeof setInterval> | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    const watchdogTimers: Array<ReturnType<typeof setInterval>> = [];

    const stopForceKillTimer = () => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const stopRuntimeTimer = () => {
      if (runtimeTimer) {
        clearTimeout(runtimeTimer);
        runtimeTimer = null;
      }
    };

    const stopHealthTimer = () => {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
    };

    const stopTickTimer = () => {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    };

    const stopWatchdogTimers = () => {
      while (watchdogTimers.length > 0) {
        const timer = watchdogTimers.pop();
        if (timer) {
          clearInterval(timer);
        }
      }
    };

    const cleanup = () => {
      stopRuntimeTimer();
      stopForceKillTimer();
      stopHealthTimer();
      stopTickTimer();
      stopWatchdogTimers();
      if (options.signal && signalAbortHandler) {
        options.signal.removeEventListener("abort", signalAbortHandler);
      }
    };

    const settle = (exitCode: number, overrideStderr?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stderr: overrideStderr ?? stderrBuffer,
        aborted,
        abortOrigin,
        abortReason,
        health: health.summary(aborted ? "aborted" : "ok"),
      });
    };

    const abortChild = (origin: DelegatedAbortOrigin, reason: string) => {
      if (aborted || closed) {
        return;
      }

      aborted = true;
      abortOrigin = origin;
      abortReason = reason;
      health.noteEvent(`abort:${origin}`);

      stopRuntimeTimer();
      stopHealthTimer();
      stopTickTimer();
      stopWatchdogTimers();

      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, options.forceKillAfterMs ?? 4_000);
    };

    const applyProgressMarker = (marker: DelegatedRunnerProgressMarker) => {
      const fingerprint = marker.fingerprint ?? "";
      switch (marker.kind) {
        case "tool_start":
          health.noteToolStart(marker.toolName ?? "unknown", marker.action);
          if (fingerprint) {
            health.setFingerprint(fingerprint);
          }
          break;
        case "tool_end":
          health.noteToolEnd(marker.toolName, marker.action);
          if (fingerprint) {
            health.setFingerprint(fingerprint);
          }
          break;
        case "assistant":
        case "assistant_error":
          health.noteProgress(marker.action, fingerprint || undefined);
          break;
        default:
          health.noteEvent(marker.action);
          if (fingerprint) {
            health.setFingerprint(fingerprint);
          }
      }
    };

    const processLine = (line: string) => {
      if (!line.trim()) {
        return;
      }

      let outcome: DelegatedRunnerLineOutcome | DelegatedRunnerProgressMarker | void;
      try {
        outcome = options.onStdoutLine?.(line);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        abortChild("external", `stdout handler failure: ${reason}`);
        return;
      }

      const normalized = normalizeLineOutcome(outcome);
      if (!normalized) {
        return;
      }

      if (normalized.marker) {
        applyProgressMarker(normalized.marker);
      }

      if (normalized.abortReason) {
        abortChild(normalized.abortOrigin ?? "external", normalized.abortReason);
      }
    };

    let signalAbortHandler: (() => void) | null = null;

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBuffer += text;
      options.onStderr?.(text);
      if (text.trim()) {
        health.noteEvent("stderr_output");
      }
    });

    child.on("close", (code) => {
      closed = true;
      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer.trim());
      }
      settle(code ?? 0);
    });

    child.on("error", (error) => {
      closed = true;
      const message = error?.message ? String(error.message) : "delegated process error";
      if (!stderrBuffer.trim()) {
        stderrBuffer = message;
      }
      settle(1, message);
    });

    healthTimer = setInterval(() => {
      if (closed) {
        return;
      }
      const evaluation = health.evaluate();
      if (evaluation.warning) {
        options.onHealthWarning?.(evaluation.warning, evaluation.snapshot);
      }
      if (evaluation.abortReason) {
        abortChild("health", evaluation.abortReason);
      }
    }, healthPolicy.pollIntervalMs);

    if (options.runtimeLimitSeconds && options.runtimeLimitSeconds > 0) {
      runtimeTimer = setTimeout(() => {
        abortChild("budget", `runtime budget exceeded (${options.runtimeLimitSeconds}s)`);
      }, Math.max(1, Math.floor(options.runtimeLimitSeconds)) * 1_000);
    }

    if (options.tickIntervalMs && options.tickIntervalMs > 0 && options.onTick) {
      tickTimer = setInterval(() => {
        if (!closed) {
          options.onTick?.();
        }
      }, options.tickIntervalMs);
    }

    for (const watchdog of options.watchdogs ?? []) {
      const intervalMs = Number.isFinite(watchdog.intervalMs)
        ? Math.max(50, Math.floor(watchdog.intervalMs))
        : 250;
      const timer = setInterval(() => {
        if (closed) {
          return;
        }
        const reason = watchdog.evaluate();
        if (reason) {
          abortChild(watchdog.origin ?? "policy", reason);
        }
      }, intervalMs);
      watchdogTimers.push(timer);
    }

    if (options.signal) {
      signalAbortHandler = () => {
        abortChild("signal", "parent signal canceled delegated run");
      };

      if (options.signal.aborted) {
        signalAbortHandler();
      } else {
        options.signal.addEventListener("abort", signalAbortHandler, { once: true });
      }
    }
  });
}

function normalizeLineOutcome(
  outcome: DelegatedRunnerLineOutcome | DelegatedRunnerProgressMarker | void,
): DelegatedRunnerLineOutcome | null {
  if (!outcome) {
    return null;
  }

  if (isProgressMarker(outcome)) {
    return { marker: outcome };
  }

  return outcome;
}

function isProgressMarker(value: unknown): value is DelegatedRunnerProgressMarker {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DelegatedRunnerProgressMarker>;
  return typeof candidate.kind === "string" && typeof candidate.action === "string";
}
