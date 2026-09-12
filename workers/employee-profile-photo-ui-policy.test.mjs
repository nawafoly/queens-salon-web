import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dashboard = fs.readFileSync(
  "src/pages/DashboardEmployees.tsx",
  "utf8"
);

test("employee profile photo UI preserves canonical file pointer and permission boundaries", () => {
  assert.match(
    dashboard,
    /avatarFileId:\s*pickEditableText\("avatarFileId"\)/
  );

  assert.match(
    dashboard,
    /avatarFileId:\s*hasCoreField\("avatarFileId"\)[\s\S]*?cleanText\(core\.avatarFileId\)[\s\S]*?cleanText\(row\.avatarFileId\)/
  );

  assert.match(
    dashboard,
    /hasPermission\("employees\.files\.manage"\)/
  );

  assert.match(
    dashboard,
    /!canUpdateEmployees\s*\|\|\s*!canManageEmployeeFiles/
  );

  assert.match(
    dashboard,
    /photoManagementEnabled=\{Boolean\([\s\S]*?canUpdateEmployees[\s\S]*?canManageEmployeeFiles/
  );
});

test("employee profile photo pointer mutation refreshes concurrency baseline", () => {
  const matches = dashboard.match(
    /coreEmployeeUpdatedAtBaselineRef\.current\s*=\s*nextUpdatedAt/g
  ) || [];

  assert.ok(
    matches.length >= 2,
    "upload and removal must both refresh the employee concurrency baseline"
  );
});

test("employee profile photo upload never archives canonical file after pointer commit", () => {
  assert.match(
    dashboard,
    /if \(uploadedFileId && !pointerCommitted\)[\s\S]*?archiveCoreEmployeeProfilePhoto\(uploadedFileId\)/
  );

  assert.match(
    dashboard,
    /pointerCommitted\s*=\s*true[\s\S]*?markCoreEmployeeProfilePhotoReplaced/
  );
});

test("employee profile photo removal clears pointer before archival", () => {
  const saveIndex = dashboard.indexOf("avatarFileId: null");
  const archiveIndex = dashboard.indexOf(
    "await archiveCoreEmployeeProfilePhoto(currentFileId)",
    saveIndex
  );

  assert.ok(saveIndex >= 0, "avatar pointer clear is missing");
  assert.ok(archiveIndex > saveIndex, "old photo must archive only after pointer clear");
});
