import { describe, expect, test } from "bun:test";

import {
  buildRepoMemoryKey,
  normalizeMemoryScope,
  parseMemoryScopeFromArgs,
  parseRepoSlugFromRemote,
  selectAndRankMemoryResults,
  stripMemoryScopeFlag,
} from "../memory-utils";

describe("organic-workflows memory utils", () => {
  test("normalizes memory scope with safe fallback", () => {
    expect(normalizeMemoryScope("local")).toBe("local");
    expect(normalizeMemoryScope("global")).toBe("global");
    expect(normalizeMemoryScope("both")).toBe("both");
    expect(normalizeMemoryScope("invalid")).toBe("both");
    expect(normalizeMemoryScope(undefined)).toBe("both");
  });

  test("parses scope flags from command args", () => {
    expect(parseMemoryScopeFromArgs("--scope local", "both")).toBe("local");
    expect(parseMemoryScopeFromArgs("query --scope=global", "both")).toBe("global");
    expect(parseMemoryScopeFromArgs("query", "local")).toBe("local");
  });

  test("strips scope flags while preserving query text", () => {
    expect(stripMemoryScopeFlag("--scope local onboarding flow")).toBe("onboarding flow");
    expect(stripMemoryScopeFlag("onboarding --scope=global flow")).toBe("onboarding flow");
  });

  test("parses repo slug from common git remote formats", () => {
    expect(parseRepoSlugFromRemote("git@github.com:misty-step/vox-cloud.git")).toBe("misty-step/vox-cloud");
    expect(parseRepoSlugFromRemote("https://github.com/misty-step/vox-cloud.git")).toBe("misty-step/vox-cloud");
    expect(parseRepoSlugFromRemote("/tmp/local/repo")).toBe("local/repo");
  });

  test("builds stable repo memory keys with uniqueness by root", () => {
    const first = buildRepoMemoryKey("/Users/a/dev/vox-cloud", "misty-step/vox-cloud");
    const second = buildRepoMemoryKey("/Users/a/dev/vox-cloud", "misty-step/vox-cloud");
    const differentRoot = buildRepoMemoryKey("/Users/a/dev/vox-cloud-copy", "misty-step/vox-cloud");

    expect(first).toBe(second);
    expect(first).not.toBe(differentRoot);
    expect(first.startsWith("misty-step-vox-cloud-")).toBe(true);
  });

  test("ranks local hits ahead when scores are close", () => {
    const ranked = selectAndRankMemoryResults(
      [
        {
          scope: "global" as const,
          collection: "pi-memory",
          docid: "g1",
          score: 0.6,
          adjustedScore: 0.6,
          file: "qmd://pi-memory/global.md",
          title: "Global",
          context: "",
          snippet: "same idea",
        },
        {
          scope: "local" as const,
          collection: "pi-memory-local-repo",
          docid: "l1",
          score: 0.5,
          adjustedScore: 0.5,
          file: "qmd://pi-memory-local-repo/local.md",
          title: "Local",
          context: "",
          snippet: "local nuance",
        },
      ],
      5,
      0.15,
    );

    expect(ranked[0]?.scope).toBe("local");
    expect(ranked[0]?.adjustedScore).toBeCloseTo(0.65, 5);
  });

  test("dedupes same file+snippet and keeps strongest adjusted score", () => {
    const ranked = selectAndRankMemoryResults(
      [
        {
          scope: "global" as const,
          collection: "pi-memory",
          docid: "g1",
          score: 0.7,
          adjustedScore: 0.7,
          file: "qmd://pi-memory/shared.md",
          title: "Global",
          context: "",
          snippet: "duplicate snippet",
        },
        {
          scope: "local" as const,
          collection: "pi-memory-local-repo",
          docid: "l1",
          score: 0.62,
          adjustedScore: 0.62,
          file: "qmd://pi-memory/shared.md",
          title: "Local",
          context: "",
          snippet: "duplicate snippet",
        },
      ],
      5,
      0.2,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.scope).toBe("local");
    expect(ranked[0]?.adjustedScore).toBeCloseTo(0.82, 5);
  });
});
