export interface GuardrailDecision {
  block: boolean;
  reason?: string;
}

interface GuardrailRule {
  name: string;
  pattern: RegExp;
  reason: string;
}

const RULES: GuardrailRule[] = [
  {
    name: "rm",
    pattern: /\brm\b/i,
    reason:
      "Blocked: use trash/recycle-bin workflow instead of rm for recoverability (example: `trash <path>`).",
  },
  {
    name: "git-rebase",
    pattern: /\bgit\s+rebase\b/i,
    reason: "Blocked: avoid history rewrite. Prefer `git merge` for integrating branches.",
  },
  {
    name: "git-reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Blocked: irreversible history/worktree reset (`git reset --hard`).",
  },
  {
    name: "git-clean-force",
    pattern: /\bgit\s+clean\s+-f(d|x)?\b/i,
    reason: "Blocked: irreversible untracked-file deletion (`git clean -f*`).",
  },
  {
    name: "git-force-push",
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f)(\s|$)/i,
    reason: "Blocked: force-push rewrites remote history.",
  },
  {
    name: "git-branch-delete-force",
    pattern: /\bgit\s+branch\s+-D\b/i,
    reason: "Blocked: force branch deletion (`git branch -D`).",
  },
  {
    name: "git-amend",
    pattern: /\bgit\s+commit\b[^\n]*\s--amend(\s|$)/i,
    reason: "Blocked: `git commit --amend` rewrites commit history.",
  },
  {
    name: "pi-nested-noninteractive",
    pattern:
      /\bpi\b(?!ctl)\b[^\n]*(--mode\b|--no-session\b|-p\b|--append-system-prompt\b|--tools\b)/i,
    reason:
      "Blocked: nested non-interactive `pi` invocation from inside Pi can trigger process storms. Use built-in orchestration tools (`team_run`, `pipeline_run`, `subagent`) instead, or run the nested CLI manually outside this session.",
  },
  {
    name: "gh-pr-merge",
    pattern: /\bgh\s+pr\s+merge\b/i,
    reason:
      "Blocked: use `/squash-merge` so readiness checks enforce critical/high review gates before merge.",
  },
];

export function evaluateCommandSafety(command: string): GuardrailDecision {
  const text = command.trim();
  if (!text) {
    return { block: false };
  }

  const allowNestedPi =
    process.env.PI_GUARDRAILS_ALLOW_NESTED_PI?.toLowerCase() === "true";

  for (const rule of RULES) {
    if (allowNestedPi && rule.name === "pi-nested-noninteractive") {
      continue;
    }

    if (rule.pattern.test(text)) {
      return {
        block: true,
        reason: rule.reason,
      };
    }
  }

  return { block: false };
}

export function listGuardrailRules(): string[] {
  return RULES.map((rule) => `${rule.name}: ${rule.reason}`);
}
