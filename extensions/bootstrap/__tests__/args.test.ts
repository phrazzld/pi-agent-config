import { describe, expect, test } from "bun:test";

import { parseBootstrapArgs, sanitizeDomain } from "../args";

describe("bootstrap args", () => {
  test("parses positional domain and force flag", () => {
    const parsed = parseBootstrapArgs("vox --force", "default");
    expect(parsed.domain).toBe("vox");
    expect(parsed.force).toBe(true);
    expect(parsed.quick).toBe(false);
    expect(parsed.max).toBe(false);
  });

  test("parses --domain forms", () => {
    expect(parseBootstrapArgs("--domain cerberus", "default").domain).toBe("cerberus");
    expect(parseBootstrapArgs("--domain=cerberus-cloud", "default").domain).toBe("cerberus-cloud");
  });

  test("parses deprecated quick flag", () => {
    expect(parseBootstrapArgs("--quick", "default").quick).toBe(true);
  });

  test("parses deprecated max flag", () => {
    expect(parseBootstrapArgs("--max", "default").max).toBe(true);
  });

  test("falls back to default domain", () => {
    const parsed = parseBootstrapArgs("", "my-repo");
    expect(parsed.domain).toBe("my-repo");
  });

  test("sanitizes invalid domain chars", () => {
    expect(sanitizeDomain(" Vox Cloud ")).toBe("vox-cloud");
    expect(sanitizeDomain("***")).toBe("project");
  });
});
