import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type ProfileName = "ultrathink" | "execute" | "ship" | "fast";

interface Profile {
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools: string[];
  instructions: string;
}

interface ProfileStateEntry {
  name: ProfileName;
}

const PROFILES: Record<ProfileName, Profile> = {
  ultrathink: {
    thinking: "xhigh",
    tools: ["read", "bash", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: ultrathink. Prioritize deep analysis, architecture quality, and risk surfacing before coding.",
  },
  execute: {
    thinking: "medium",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: execute. Deliver requested changes with focused scope, direct implementation, and concise verification.",
  },
  ship: {
    thinking: "high",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: ship. Complete work end-to-end, run checks, and leave PR-ready output with explicit residual risk.",
  },
  fast: {
    thinking: "low",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    instructions:
      "Mode: fast. Optimize for speed and unblocking. Keep patches minimal and avoid speculative refactors.",
  },
};

export default function profilesExtension(pi: ExtensionAPI): void {
  let activeProfile: ProfileName | null = null;

  pi.registerFlag("profile", {
    type: "string",
    description: "Profile to apply at startup: ultrathink|execute|ship|fast",
  });

  pi.registerCommand("profile", {
    description: "Switch profile: ultrathink|execute|ship|fast",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();

      if (!requested) {
        if (!ctx.hasUI) {
          return;
        }
        const selected = await ctx.ui.select("Select profile", [
          "ultrathink",
          "execute",
          "ship",
          "fast",
        ]);
        if (!selected) {
          return;
        }
        await applyProfile(pi, selected as ProfileName, ctx, true);
        return;
      }

      if (!isProfileName(requested)) {
        ctx.ui.notify("Usage: /profile ultrathink|execute|ship|fast", "warning");
        return;
      }
      await applyProfile(pi, requested, ctx, true);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("profile");
    if (typeof flag === "string" && isProfileName(flag)) {
      activeProfile = await applyProfile(pi, flag, ctx, false);
      return;
    }

    const env = process.env.PI_DEFAULT_PROFILE?.trim().toLowerCase();
    if (env && isProfileName(env)) {
      activeProfile = await applyProfile(pi, env, ctx, false);
      return;
    }

    const restored = restoreProfileFromBranch(ctx);
    if (restored) {
      activeProfile = await applyProfile(pi, restored, ctx, false);
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    const restored = restoreProfileFromBranch(ctx);
    if (restored && restored !== activeProfile) {
      activeProfile = await applyProfile(pi, restored, ctx, false);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!activeProfile) {
      return undefined;
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n${PROFILES[activeProfile].instructions}`,
    };
  });
}

async function applyProfile(
  pi: ExtensionAPI,
  profileName: ProfileName,
  ctx: ExtensionContext,
  notify: boolean
): Promise<ProfileName> {
  const profile = PROFILES[profileName];
  pi.setThinkingLevel(profile.thinking);

  const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
  const enabledTools = profile.tools.filter((tool) => availableTools.has(tool));
  if (enabledTools.length > 0) {
    pi.setActiveTools(enabledTools);
  }

  pi.appendEntry<ProfileStateEntry>("profile-state", { name: profileName });

  if (notify) {
    ctx.ui.notify(
      `Profile ${profileName}: thinking=${profile.thinking}, tools=${enabledTools.join(", ")}`,
      "info"
    );
  }

  return profileName;
}

function restoreProfileFromBranch(ctx: ExtensionContext): ProfileName | null {
  const branch = ctx.sessionManager.getBranch();
  let candidate: ProfileName | null = null;

  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== "profile-state") {
      continue;
    }
    const value = (entry.data as ProfileStateEntry | undefined)?.name;
    if (value && isProfileName(value)) {
      candidate = value;
    }
  }

  return candidate;
}

function isProfileName(value: string): value is ProfileName {
  return value === "ultrathink" || value === "execute" || value === "ship" || value === "fast";
}
