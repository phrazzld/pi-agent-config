import path from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { parseBootstrapArgs } from "./args";
import {
  bootstrapRepo,
  detectRepoRoot,
  formatBootstrapSummary,
  toErrorMessage,
} from "./engine";

const BOOTSTRAP_PARAMS = Type.Object({
  domain: Type.Optional(Type.String({ description: "Domain slug (e.g. vox, cerberus)" })),
  force: Type.Optional(Type.Boolean({ description: "Overwrite existing differing files" })),
  quick: Type.Optional(Type.Boolean({ description: "Deprecated: ignored (bootstrap now always runs the full planning+ambition flow)." })),
  max: Type.Optional(Type.Boolean({ description: "Deprecated: ignored (bootstrap now always runs max-depth lanes)." })),
});

export default function bootstrapExtension(pi: ExtensionAPI): void {
  pi.registerCommand("bootstrap-repo", {
    description:
      "Opinionated repo bootstrap: always plan + ambition pass + apply for repo-local .pi foundation",
    handler: async (args, ctx) => {
      const defaultDomain = path.basename(await detectRepoRoot(pi, ctx.cwd));
      const parsed = parseBootstrapArgs(args, defaultDomain);

      if (parsed.quick || parsed.max) {
        ctx.ui.notify(
          "bootstrap-repo ignores --quick/--max: the workflow is now opinionated (always full planning + ambition + apply).",
          "info",
        );
      }

      try {
        const result = await bootstrapRepo(pi, ctx, {
          domain: parsed.domain,
          force: parsed.force,
        });

        const summary = formatBootstrapSummary(result);
        ctx.ui.notify(summary, "info");
        pi.sendMessage({
          customType: "bootstrap-repo",
          content: summary,
          display: true,
          details: result,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        ctx.ui.notify(`bootstrap-repo failed: ${message}`, "error");
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "bootstrap_repo",
    label: "Bootstrap Repo",
    description:
      "Bootstrap repo-local Pi foundation using an opinionated plan+ambition+apply workflow.",
    parameters: BOOTSTRAP_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const defaultDomain = path.basename(await detectRepoRoot(pi, ctx.cwd));

      try {
        const result = await bootstrapRepo(pi, ctx, {
          domain: params.domain?.trim() || defaultDomain,
          force: params.force ?? false,
        });

        const summary = formatBootstrapSummary(result);
        return {
          content: [{ type: "text", text: summary }],
          details: result,
        };
      } catch (error) {
        throw new Error(`bootstrap-repo failed: ${toErrorMessage(error)}`);
      }
    },
    renderCall(args, theme) {
      const domain = String(args.domain ?? "project");
      return new Text(
        `${theme.fg("toolTitle", theme.bold("bootstrap_repo "))}${theme.fg("accent", domain)}`,
        0,
        0,
      );
    },
  });
}
