import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const journeys = [
  {
    name: "employee workspace",
    file: "workers/employee-workspace-dsv2-ux-guard.test.mjs",
  },
  {
    name: "employee concurrency",
    file: "workers/employee-concurrency-idempotency.test.mjs",
  },
  {
    name: "shift authority",
    file: "workers/malikat-core-scheduling-contract.test.mjs",
  },
  {
    name: "attendance security",
    file: "workers/attendance-security.test.mjs",
  },
  {
    name: "leave lifecycle",
    file: "workers/admin-partial-leave-policy.test.mjs",
  },
  {
    name: "employee requests",
    file: "workers/employee-request-convergence.test.mjs",
  },
  {
    name: "payroll approval",
    file: "workers/payroll-stage1-approval-controls.test.mjs",
  },
  {
    name: "payroll payment and reversal",
    file: "workers/payroll-stage1-payment-controls.test.mjs",
  },
  {
    name: "employee termination safety",
    file: "workers/authority-destructive-safety.test.mjs",
  },
];

const missing = journeys.filter(
  ({ file }) => !existsSync(resolve(root, file))
);

if (missing.length) {
  throw new Error(
    [
      "Critical journey regression coverage is incomplete.",
      ...missing.map(
        ({ name, file }) => "- " + name + ": " + file
      ),
    ].join("\n")
  );
}

console.log(
  "Critical journeys: " +
    journeys.map(({ name }) => name).join(", ")
);

const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...journeys.map(({ file }) => file),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "true",
    },
    shell: false,
  }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    "Critical journey regression suite failed: " +
      result.status
  );
}

console.log(
  "CRITICAL JOURNEY REGRESSION = PASS"
);
