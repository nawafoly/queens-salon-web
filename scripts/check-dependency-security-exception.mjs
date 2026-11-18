import { execFileSync } from "node:child_process";

const ALLOWED_ADVISORY =
  "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

const EXPIRES_AT = Date.parse("2026-12-03T00:00:00Z");

if (Date.now() >= EXPIRES_AT) {
  console.error("SECURITY_EXCEPTION_EXPIRED");
  process.exit(1);
}

function audit(args = []) {
  try {
    return JSON.parse(
      execFileSync(
        process.platform === "win32"
          ? (process.env.ComSpec || "cmd.exe")
          : "npm",
        process.platform === "win32"
          ? ["/d", "/s", "/c", ["npm.cmd", "audit", "--json", ...args].join(" ")]
          : ["audit", "--json", ...args],
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024
        }
      )
    );
  } catch (error) {
    if (!error.stdout) {
      throw error;
    }

    return JSON.parse(error.stdout.toString());
  }
}

const report = audit();

if (report.error || !report.vulnerabilities) {
  console.error("SECURITY_AUDIT_INVALID");
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
const checked = new Map();

function allowed(name, visiting = new Set()) {
  if (checked.has(name)) {
    return checked.get(name);
  }

  if (visiting.has(name)) {
    return false;
  }

  const vulnerability = vulnerabilities[name];

  if (!vulnerability || !Array.isArray(vulnerability.via)) {
    return false;
  }

  const next = new Set(visiting);
  next.add(name);

  if (vulnerability.via.length === 0) {
    return false;
  }

  const result = vulnerability.via.every((source) => {
    if (typeof source === "string") {
      return allowed(source, next);
    }

    return source &&
      source.url === ALLOWED_ADVISORY &&
      source.severity === "high";
  });

  checked.set(name, result);
  return result;
}

const rejected = Object.keys(vulnerabilities)
  .filter((name) => !allowed(name));

if (rejected.length > 0) {
  console.error("UNAPPROVED_VULNERABILITIES:");
  console.error(rejected.join("\n"));
  process.exit(1);
}

const production = audit(["--omit=dev"]);

if (
  production.error ||
  !production.metadata?.vulnerabilities ||
  production.metadata.vulnerabilities.total !== 0
) {
  console.error("PRODUCTION_SECURITY_FAILED");
  process.exit(1);
}

console.log("SECURITY_GATE_PASSED");
console.log("Temporary advisory:", ALLOWED_ADVISORY);
console.log("Expires: 2026-12-02");
console.log(
  "Affected development packages:",
  Object.keys(vulnerabilities).length
);
console.log("Production vulnerabilities: 0");
