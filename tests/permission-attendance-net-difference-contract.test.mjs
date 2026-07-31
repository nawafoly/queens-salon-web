import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, "src/helpers/hr/attendanceDiscipline.ts"),
  "utf8"
);

test("approved permission coverage is included in net hour difference", () => {
  assert.match(
    source,
    /netHourDifference:\s*roundHours\(\s*actualMinutes\s*\+\s*permissionCoverage\.coveredMissingMinutes\s*-\s*scheduledMinutes\s*\)/s
  );
});

test("raw actual minus scheduled formula is no longer used for a permission-covered day", () => {
  assert.doesNotMatch(
    source,
    /netHourDifference:\s*roundHours\(actualMinutes\s*-\s*scheduledMinutes\)/
  );
});
