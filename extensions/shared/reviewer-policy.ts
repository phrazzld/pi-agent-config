export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "none";
export type ReviewerSource = "bot" | "human";
export type ReviewPolicyDecision = "block" | "address-or-track" | "informational";

export interface ReviewPolicyRow {
  source: ReviewerSource | "any";
  severity: ReviewSeverity;
  decision: ReviewPolicyDecision;
  defaultAction: string;
}

const CRITICAL_PATTERNS: RegExp[] = [
  /security-critical\.svg/i,
  /\bcritical(?:\s+severity)?\b/i,
  /\bsev(?:erity)?[\s:=-]*0\b/i,
  /🔴/u,
  /🛑/u,
];

const HIGH_PATTERNS: RegExp[] = [
  /security-high-priority\.svg/i,
  /high-priority\.svg/i,
  /\bhigh(?:\s+severity|\s+priority)\b/i,
  /\bsev(?:erity)?[\s:=-]*1\b/i,
  /🟠/u,
];

const MEDIUM_PATTERNS: RegExp[] = [
  /medium-priority\.svg/i,
  /\bmedium(?:\s+severity|\s+priority)\b/i,
  /\bsev(?:erity)?[\s:=-]*2\b/i,
  /🟡/u,
];

const LOW_PATTERNS: RegExp[] = [
  /low-priority\.svg/i,
  /\blow(?:\s+severity|\s+priority)\b/i,
  /\bsev(?:erity)?[\s:=-]*3\b/i,
  /🟢/u,
  /🔵/u,
];

const ACTIONABLE_PATTERNS: RegExp[] = [
  /\bbreaking change\b/i,
  /\bregression\b/i,
  /\bbypass\b/i,
  /\bvulnerab\w*\b/i,
  /\bunsafe\b/i,
  /\brisk\b/i,
  /\bfailing|failure|failed\b/i,
  /\berror\b/i,
  /\bblocked\b/i,
  /\bmust fix\b/i,
  /\bneeds?\s+fix\b/i,
  /\bshould\b/i,
  /\bsuggestion:\b/i,
  /\bnot ready\b/i,
  /\bmajor issue\b/i,
  /\bdata loss\b/i,
  /\breliability\b/i,
  /\bssrf\b/i,
  /\bsecurity\b/i,
];

const POSITIVE_HINT_PATTERNS: RegExp[] = [
  /this change correctly/i,
  /good addition/i,
  /functionally correct/i,
  /acceptable trade[- ]?off/i,
  /looks good/i,
  /security enhancement/i,
  /well-implemented/i,
  /effectively addresses/i,
  /significantly improves/i,
  /summary of changes/i,
  /verdict:\s*pass/i,
];

const NEGATIVE_HINT_PATTERNS: RegExp[] = [
  /\bwarning\b/i,
  /\bblock(ed|ing)?\b/i,
  /\bfail(?:ed|ing|ure)?\b/i,
  /\bissue\b/i,
  /\bregression\b/i,
  /\bbypass\b/i,
  /\bvulnerab\w*\b/i,
  /\bmust fix\b/i,
  /\bnot ready\b/i,
  /\bbreaking change\b/i,
];

export const REVIEWER_POLICY_MATRIX: ReviewPolicyRow[] = [
  {
    source: "any",
    severity: "critical",
    decision: "block",
    defaultAction: "Fix in current branch before merge.",
  },
  {
    source: "any",
    severity: "high",
    decision: "block",
    defaultAction: "Fix in current branch before merge.",
  },
  {
    source: "bot",
    severity: "medium",
    decision: "address-or-track",
    defaultAction: "Address now or file follow-up issue with rationale.",
  },
  {
    source: "human",
    severity: "medium",
    decision: "address-or-track",
    defaultAction: "Address now or file follow-up issue with rationale.",
  },
  {
    source: "any",
    severity: "low",
    decision: "informational",
    defaultAction: "Optional improvement; capture if repeated.",
  },
  {
    source: "any",
    severity: "none",
    decision: "informational",
    defaultAction: "No action required.",
  },
];

export function classifyReviewSeverity(text: string): ReviewSeverity {
  const normalized = normalizeReviewText(text);

  if (matchesAny(CRITICAL_PATTERNS, text, normalized)) {
    return "critical";
  }
  if (matchesAny(HIGH_PATTERNS, text, normalized)) {
    return "high";
  }
  if (matchesAny(MEDIUM_PATTERNS, text, normalized)) {
    return "medium";
  }
  if (matchesAny(LOW_PATTERNS, text, normalized)) {
    return "low";
  }
  return "none";
}

export function isActionableReviewFinding(text: string): boolean {
  const normalized = normalizeReviewText(text);
  if (!normalized) {
    return false;
  }

  const hasNegativeSignal = NEGATIVE_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasActionableSignal = ACTIONABLE_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasActionableSignal && !hasNegativeSignal) {
    return false;
  }

  const hasPositiveSignal = POSITIVE_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasPositiveSignal && !hasNegativeSignal) {
    return false;
  }

  return true;
}

export function isBotAuthor(login?: string, type?: string): boolean {
  if (type?.toLowerCase() === "bot") {
    return true;
  }

  return /\[bot\]$/i.test(login ?? "");
}

export function decisionForFinding(
  source: ReviewerSource,
  severity: ReviewSeverity
): ReviewPolicyDecision {
  if (severity === "critical" || severity === "high") {
    return "block";
  }

  if (severity === "medium") {
    return "address-or-track";
  }

  return "informational";
}

export function isHardBlockingFinding(
  source: ReviewerSource,
  severity: ReviewSeverity,
  actionable: boolean
): boolean {
  if (!actionable) {
    return false;
  }

  return decisionForFinding(source, severity) === "block";
}

export function reviewerPolicyMatrixLines(): string[] {
  return REVIEWER_POLICY_MATRIX.map(
    (row) =>
      `${row.source.padEnd(5)} | ${row.severity.padEnd(8)} | ${row.decision.padEnd(16)} | ${row.defaultAction}`
  );
}

function normalizeReviewText(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^\)]*\)/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(patterns: RegExp[], ...values: string[]): boolean {
  return patterns.some((pattern) => values.some((value) => pattern.test(value)));
}
