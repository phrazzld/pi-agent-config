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

interface ProfileDescriptor {
  name: ProfileName;
  label: string;
  summary: string;
  aliases: string[];
}

const PROFILES: Record<ProfileName, Profile> = {
  ultrathink: {
    thinking: "xhigh",
    tools: ["read", "bash", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: ultrathink. Prioritize deep analysis, architecture quality, and risk surfacing before coding. Use teams/subagents at your discretion when work is non-trivial, cross-functional, or ambiguous; skip orchestration for trivial factual asks or tiny edits. For meta/config architecture work, proactively invoke team_run for meta-council, then synthesize into a concise recommendation. Treat user phrases like 'ask the council' or 'use everything at your disposal' as explicit permission to orchestrate.",
  },
  execute: {
    thinking: "medium",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: execute. Deliver requested changes with focused scope, direct implementation, and concise verification. Use teams/subagents opportunistically for non-trivial multi-step work, risky changes, or when parallel specialist analysis improves quality; avoid orchestration overhead for tiny edits. Treat user phrases like 'ask the council' or 'use everything at your disposal' as explicit permission to orchestrate.",
  },
  ship: {
    thinking: "high",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "web_search"],
    instructions:
      "Mode: ship. Complete work end-to-end, run checks, and leave PR-ready output with explicit residual risk. Prefer team/pipeline orchestration for substantial work that benefits from planning/review/specialists; keep direct execution for straightforward small tasks. Treat user phrases like 'ask the council' or 'use everything at your disposal' as explicit permission to orchestrate.",
  },
  fast: {
    thinking: "low",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    instructions:
      "Mode: fast. Optimize for speed and unblocking. Keep patches minimal and avoid speculative refactors.",
  },
};

const PROFILE_DESCRIPTORS: ProfileDescriptor[] = [
  {
    name: "ultrathink",
    label: "meta",
    summary: "Deep architecture/reflection mode (alias for ultrathink)",
    aliases: ["meta", "deep", "think"],
  },
  {
    name: "execute",
    label: "execute",
    summary: "Balanced implementation mode",
    aliases: ["build", "dev", "workhorse"],
  },
  {
    name: "ship",
    label: "ship",
    summary: "End-to-end delivery + verification mode",
    aliases: ["release", "deliver"],
  },
  {
    name: "fast",
    label: "fast",
    summary: "Quick unblock mode with minimal thinking",
    aliases: ["quick"],
  },
];

const PROFILE_ALIAS_TO_NAME = buildAliasMap(PROFILE_DESCRIPTORS);

export default function profilesExtension(pi: ExtensionAPI): void {
  let activeProfile: ProfileName | null = null;

  pi.registerFlag("profile", {
    type: "string",
    description:
      "Profile at startup: meta|execute|ship|fast (also supports ultrathink/deep/build/release/quick aliases)",
  });

  pi.registerCommand("profile", {
    description: "Switch profile. Usage: /profile meta|execute|ship|fast or /profile list",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();

      if (!requested) {
        if (!ctx.hasUI) {
          return;
        }

        const options = PROFILE_DESCRIPTORS.map(
          (descriptor) => `${descriptor.label} (${descriptor.name}) — ${descriptor.summary}`
        );

        const selected = await ctx.ui.select("Select profile", options);
        if (!selected) {
          return;
        }

        const descriptor = PROFILE_DESCRIPTORS[options.indexOf(selected)];
        await applyProfile(pi, descriptor.name, ctx, true);
        return;
      }

      if (requested === "list" || requested === "help") {
        ctx.ui.notify(profileUsageLines().join("\n"), "info");
        return;
      }

      const resolved = parseProfileName(requested);
      if (!resolved) {
        ctx.ui.notify(profileUsageLines().join("\n"), "warning");
        return;
      }

      await applyProfile(pi, resolved, ctx, true);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const flag = pi.getFlag("profile");
    if (typeof flag === "string") {
      const resolved = parseProfileName(flag.trim().toLowerCase());
      if (resolved) {
        activeProfile = await applyProfile(pi, resolved, ctx, false);
        return;
      }
    }

    const env = process.env.PI_DEFAULT_PROFILE?.trim().toLowerCase();
    if (env) {
      const resolved = parseProfileName(env);
      if (resolved) {
        activeProfile = await applyProfile(pi, resolved, ctx, false);
        return;
      }
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
    const descriptor = PROFILE_DESCRIPTORS.find((item) => item.name === profileName);
    const display = descriptor ? `${descriptor.label} (${profileName})` : profileName;
    ctx.ui.notify(
      `Profile ${display}: thinking=${profile.thinking}, tools=${enabledTools.join(", ")}`,
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

function parseProfileName(value: string): ProfileName | null {
  if (isProfileName(value)) {
    return value;
  }
  return PROFILE_ALIAS_TO_NAME.get(value) ?? null;
}

function isProfileName(value: string): value is ProfileName {
  return value === "ultrathink" || value === "execute" || value === "ship" || value === "fast";
}

function buildAliasMap(descriptors: ProfileDescriptor[]): Map<string, ProfileName> {
  const map = new Map<string, ProfileName>();
  for (const descriptor of descriptors) {
    map.set(descriptor.name, descriptor.name);
    map.set(descriptor.label, descriptor.name);
    for (const alias of descriptor.aliases) {
      map.set(alias, descriptor.name);
    }
  }
  return map;
}

function profileUsageLines(): string[] {
  return [
    "Usage: /profile <name>",
    "Available profiles:",
    ...PROFILE_DESCRIPTORS.map(
      (descriptor) =>
        `- ${descriptor.label} (${descriptor.name}) — ${descriptor.summary}; aliases: ${descriptor.aliases.join(", ")}`
    ),
  ];
}
