import { readFileSync } from "node:fs";

const RUNNER = "scripts/_apply-canonical-weekly-rest-effective-shift.mjs";
const HELPER = "scripts/_run-canonical-weekly-rest-v2.mjs";
const POLICY_TEST = "workers/leave-rest-workflows-policy.test.mjs";

let source = readFileSync(RUNNER, "utf8").replace(/\r\n/g, "\n");

function mustReplace(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`runner v2 anchor not found: ${label}`);
  }
  source = source.replace(before, after);
}

source = source.replace(
  /function edit\(path, transform\) \{\n[\s\S]*?\n\}/,
  `function edit(path, transform) {
  const original = readFileSync(path, "utf8");
  const hadCrlf = original.includes("\\r\\n");
  const before = original.replace(/\\r\\n/g, "\\n");
  const after = transform(before);

  if (after === before) {
    fail(\`no change produced for \${path}\`);
  }

  const output = hadCrlf
    ? after.replace(/\\n/g, "\\r\\n")
    : after;

  writeFileSync(path, output, "utf8");
  console.log(\`patched \${path}\`);
}`
);

mustReplace(
  "      `Attendance must expose canonical label: ${label}`",
  '      "Attendance must expose canonical label: " + label',
  "contract-test template literal"
);

mustReplace(
  'run("npm", ["run", "build"]);',
  'if (process.platform === "win32") { run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"]); } else { run("npm", ["run", "build"]); }',
  "Windows npm executable"
);

mustReplace(
  'if (netFiles.length !== 1 || netFiles[0] !== SELF) {',
  `if (
    netFiles.length !== 3 ||
    !netFiles.includes(SELF) ||
    !netFiles.includes("${HELPER}") ||
    !netFiles.includes("${POLICY_TEST}")
  ) {`,
  "pre-patch branch diff gate"
);

const oldAttendanceKindAnchor = [
  'String.raw`export type AttendanceSpecialDayKind =',
  '  | "leave"',
  '  | "partial_leave"',
  '  | "rest"',
  '  | "weekly_off"',
  '  | "exception_off";`,'
].join("\n");

const realAttendanceKindAnchor =
  'String.raw`export type AttendanceSpecialDayKind = "leave" | "partial_leave" | "rest" | "weekly_off" | "exception_off";`,';

mustReplace(
  oldAttendanceKindAnchor,
  realAttendanceKindAnchor,
  "attendance special-day one-line source shape"
);

const schedulingTestEditAnchor =
  '  edit("workers/malikat-core-scheduling-contract.test.mjs", (text) => {\n    const testBlock = String.raw`';

const schedulingTestEditReplacement =
  '  edit("workers/malikat-core-scheduling-contract.test.mjs", (text) => {\n' +
  '    text = replaceOnce(\n' +
  '      text,\n' +
  '      String.raw`\\s*assignments,\\s*employmentRows`,\n' +
  '      String.raw`\\s*assignments,\\s*weeklyRestWorkAssignments,\\s*employmentRows`,\n' +
  '      "legacy batch contract includes weekly-rest assignments"\n' +
  '    );\n' +
  '    const testBlock = String.raw`';

mustReplace(
  schedulingTestEditAnchor,
  schedulingTestEditReplacement,
  "legacy scheduling batch contract"
);

mustReplace(
  "  unlinkSync(SELF);",
  `  unlinkSync(SELF);\n  unlinkSync("${HELPER}");`,
  "remove temporary runners"
);

mustReplace(
  "  const expected = [...TARGETS].sort();",
  `  const expected = [...TARGETS, SELF, "${HELPER}"].sort();`,
  "staged-file gate"
);

await import(
  "data:text/javascript;base64," +
  Buffer.from(source).toString("base64")
);
