import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

type BootstrapLaneState = "queued" | "running" | "ok" | "failed";
type ChangeAction = "created" | "updated" | "skipped";

interface BootstrapChangeLike {
  action: ChangeAction;
}

interface LaneResultLike {
  name: string;
  model: string;
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

interface BootstrapLaneProgress {
  name: string;
  model: string;
  state: BootstrapLaneState;
  startedAtMs?: number;
  elapsedMs?: number;
  error?: string;
}

export interface BootstrapProgressTracker {
  setPhase(phase: string, detail?: string): void;
  setLanes(lanes: Array<{ name: string; model: string }>): void;
  markLaneStarted(name: string): void;
  markLaneFinished(result: LaneResultLike): void;
  setWriteProgress(changes: BootstrapChangeLike[]): void;
  finish(error?: string): void;
}

const BOOTSTRAP_STATUS_ID = "bootstrap";
const BOOTSTRAP_WIDGET_ID = "bootstrap-progress";

export function createBootstrapProgressTracker(
  ctx: ExtensionContext,
  options: { repoRoot: string; domain: string; mode: string; force: boolean },
): BootstrapProgressTracker {
  const startedAtMs = Date.now();
  let phase = "starting";
  let detail = "initializing";
  let lanes: BootstrapLaneProgress[] = [];
  let writes = { created: 0, updated: 0, skipped: 0 };
  let done = false;

  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  const render = (): void => {
    const now = Date.now();
    const elapsed = formatElapsed(now - startedAtMs);
    const laneCompleteCount = lanes.filter((lane) => lane.state === "ok" || lane.state === "failed").length;
    const laneRunningCount = lanes.filter((lane) => lane.state === "running").length;

    const statusBits = [
      `bootstrap ${options.mode}`,
      `phase=${phase}`,
      lanes.length > 0 ? `lanes=${laneCompleteCount}/${lanes.length}` : "",
      `elapsed=${elapsed}`,
    ].filter(Boolean);

    ctx.ui.setStatus(BOOTSTRAP_STATUS_ID, statusBits.join(" | "));

    const lines = [
      "Bootstrap Repo",
      `- repo: ${options.repoRoot}`,
      `- domain: ${options.domain}`,
      `- mode: ${options.mode}${options.force ? " + --force" : ""}`,
      `- phase: ${phase}${detail ? ` (${detail})` : ""}`,
      `- elapsed: ${elapsed}`,
    ];

    if (lanes.length > 0) {
      lines.push(`- lanes: ${laneCompleteCount}/${lanes.length} complete, ${laneRunningCount} running`);
      for (const lane of lanes) {
        const laneNow = Date.now();
        const laneElapsedMs = lane.state === "running"
          ? laneNow - (lane.startedAtMs ?? laneNow)
          : lane.elapsedMs ?? 0;
        const laneElapsed = lane.startedAtMs || lane.elapsedMs ? ` ${formatElapsed(Math.max(0, laneElapsedMs))}` : "";
        lines.push(
          `  - ${laneStateGlyph(lane.state)} ${lane.name} (${shortModelName(lane.model)}) ${lane.state}${laneElapsed}`,
        );
        if (lane.error) {
          lines.push(`    error: ${truncateText(lane.error, 120)}`);
        }
      }
    }

    const totalWrites = writes.created + writes.updated + writes.skipped;
    if (totalWrites > 0) {
      lines.push(`- writes: created=${writes.created} updated=${writes.updated} skipped=${writes.skipped}`);
    }

    if (done) {
      lines.push("- state: finished");
    }

    ctx.ui.setWidget(BOOTSTRAP_WIDGET_ID, lines, { placement: "aboveEditor" });
  };

  const ticker = setInterval(() => {
    render();
  }, 1000);

  const scheduleCleanup = (delayMs: number): void => {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
    }

    cleanupTimer = setTimeout(() => {
      ctx.ui.setWidget(BOOTSTRAP_WIDGET_ID, undefined);
      ctx.ui.setStatus(BOOTSTRAP_STATUS_ID, undefined);
    }, delayMs);
  };

  render();

  return {
    setPhase(nextPhase, nextDetail) {
      phase = nextPhase;
      detail = nextDetail ?? "";
      render();
    },
    setLanes(nextLanes) {
      lanes = nextLanes.map((lane) => ({
        name: lane.name,
        model: lane.model,
        state: "queued",
      }));
      render();
    },
    markLaneStarted(name) {
      const lane = lanes.find((item) => item.name === name);
      if (!lane) {
        return;
      }

      lane.state = "running";
      lane.startedAtMs = Date.now();
      lane.error = undefined;
      render();
    },
    markLaneFinished(result) {
      const lane = lanes.find((item) => item.name === result.name);
      if (!lane) {
        return;
      }
      lane.state = result.ok ? "ok" : "failed";
      lane.elapsedMs = result.elapsedMs;
      lane.error = result.error;
      render();
    },
    setWriteProgress(changes) {
      writes = countBootstrapActions(changes);
      render();
    },
    finish(error) {
      if (done) {
        return;
      }

      done = true;

      if (error) {
        phase = "failed";
        detail = truncateText(error, 180);
      }

      clearInterval(ticker);
      render();
      scheduleCleanup(error ? 20_000 : 12_000);
    },
  };
}

function countBootstrapActions(changes: BootstrapChangeLike[]): { created: number; updated: number; skipped: number } {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const change of changes) {
    if (change.action === "created") {
      created += 1;
      continue;
    }
    if (change.action === "updated") {
      updated += 1;
      continue;
    }
    skipped += 1;
  }

  return { created, updated, skipped };
}

function laneStateGlyph(state: BootstrapLaneState): string {
  switch (state) {
    case "queued":
      return "•";
    case "running":
      return "⏳";
    case "ok":
      return "✅";
    case "failed":
      return "❌";
    default:
      return "•";
  }
}

function shortModelName(model: string): string {
  if (model.length <= 38) {
    return model;
  }

  const parts = model.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  return truncateText(model, 38);
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}
