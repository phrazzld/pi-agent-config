import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

const SOURCES = [
  path.resolve(import.meta.dir, "..", "..", "orchestration", "index.ts"),
  path.resolve(import.meta.dir, "..", "..", "bootstrap", "engine.ts"),
  path.resolve(import.meta.dir, "..", "..", "subagent", "index.ts"),
];

describe("extension source integrity", () => {
  for (const sourcePath of SOURCES) {
    test(`${path.basename(sourcePath)} parses as TypeScript`, () => {
      const source = readFileSync(sourcePath, "utf8");
      const transpiler = new Bun.Transpiler({ loader: "ts" });
      expect(() => transpiler.transformSync(source)).not.toThrow();
    });
  }
});
