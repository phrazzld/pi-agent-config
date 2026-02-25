export interface BootstrapArgs {
  domain: string;
  force: boolean;
  quick: boolean;
}

export function parseBootstrapArgs(raw: string, defaultDomain: string): BootstrapArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let force = false;
  let quick = false;
  let domain = "";

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === "--force") {
      force = true;
      continue;
    }

    if (token === "--quick") {
      quick = true;
      continue;
    }

    if (token === "--domain" && tokens[index + 1]) {
      domain = tokens[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--domain=")) {
      domain = token.slice("--domain=".length);
      continue;
    }

    if (!token.startsWith("--") && !domain) {
      domain = token;
      continue;
    }
  }

  return {
    domain: sanitizeDomain(domain || defaultDomain),
    force,
    quick,
  };
}

export function sanitizeDomain(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  return cleaned || "project";
}
