import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveEmployeeSaveCommandPlan } from "../src/pages/dashboardEmployees/employeeSaveCommandOwnership.ts";
import { upsertHrEmployee } from "./core/repositories/hr-employees.js";

const read = (path) => readFileSync(path, "utf8");

test("schedule-exception-only edits do not issue an unrelated employee master write", () => {
  const openedEmployeeMaster = {
    name: "عايدة السيد",
    active: true,
    specialties: [
      "active-service",
      "inactive-legacy-service",
    ],
  };

  const plan = resolveEmployeeSaveCommandPlan({
    isCreatingEmployee: false,
    baselineEmployeeMasterSnapshot: openedEmployeeMaster,
    desiredEmployeeMasterSnapshot: { ...openedEmployeeMaster },
    workingHourOverridesChanged: true,
    scheduleChanged: false,
  });

  assert.equal(plan.employeeMasterChanged, false);
  assert.equal(plan.writeEmployeeMaster, false);
  assert.equal(plan.requiresEmployeeMasterRevision, false);
  assert.equal(plan.syncWorkingHourExceptions, true);
});

test("a real concurrent employee master edit still returns 409", async () => {
  const openedEmployeeMaster = {
    name: "عايدة السيد",
    active: true,
  };

  const plan = resolveEmployeeSaveCommandPlan({
    isCreatingEmployee: false,
    baselineEmployeeMasterSnapshot: openedEmployeeMaster,
    desiredEmployeeMasterSnapshot: {
      ...openedEmployeeMaster,
      name: "عايدة السيد - تعديل",
    },
    workingHourOverridesChanged: true,
    scheduleChanged: false,
  });

  assert.equal(plan.employeeMasterChanged, true);
  assert.equal(plan.writeEmployeeMaster, true);
  assert.equal(plan.requiresEmployeeMasterRevision, true);

  const expectedUpdatedAt = "2026-09-17T20:26:00.033Z";
  const concurrentlyUpdatedAt = "2026-10-03T03:00:00.000Z";
  assert.notEqual(expectedUpdatedAt, concurrentlyUpdatedAt);

  const existingProfile = {
    id: "employee-1",
    salon_id: "main",
    firebase_uid: "employee-1",
    name: "عايدة السيد",
    email: "aidasalim@malikat.com",
    phone_normalized: null,
    avatar_file_id: null,
    avatar_url: null,
    bio: null,
    cv_url: null,
    show_on_about: 1,
    include_in_employee_management: 1,
    rating: 0,
    reviews_count: 0,
    status: "active",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: concurrentlyUpdatedAt,
  };
  const existingStaff = {
    id: "employee-1",
    salon_id: "main",
    firebase_uid: "employee-1",
    name: "عايدة السيد",
    phone_normalized: null,
    active: 1,
    employment_status: "active",
    avatar_url: null,
    show_on_booking: 0,
    specialties_json: "[]",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: concurrentlyUpdatedAt,
  };
  const fakeDb = {
    __fakeD1: true,
    async first(sql) {
      if (sql.includes("FROM employee_profiles")) return existingProfile;
      if (sql.includes("FROM employee_employment")) return null;
      if (sql.includes("FROM staff")) return existingStaff;
      if (sql.includes("FROM employee_offboarding_fences")) return null;
      throw new Error(`Unexpected first query: ${sql}`);
    },
    async all() {
      return [];
    },
    async batch() {
      throw new Error("Concurrent employee master edit must fail before writes");
    },
  };

  await assert.rejects(
    upsertHrEmployee(
      fakeDb,
      "main",
      {
        id: "employee-1",
        name: "عايدة السيد - تعديل",
        enforceConcurrency: true,
        expectedUpdatedAt,
      },
      {}
    ),
    (error) =>
      error?.status === 409 &&
      error?.code === "core_hr:employee_changed"
  );
});

test("Dashboard routes independent schedule commands around employee master ownership", () => {
  const source = read("src/pages/DashboardEmployees.tsx");
  const masterGuard = source.indexOf("if (employeeSavePlan.writeEmployeeMaster)");
  const masterWrite = source.indexOf("await CoreHrService.saveEmployee({", masterGuard);
  const exceptionGuard = source.indexOf("if (employeeSavePlan.syncWorkingHourExceptions)");
  const exceptionWrite = source.indexOf(".syncWorkingHourScheduleExceptions({", exceptionGuard);

  assert.ok(masterGuard >= 0 && masterWrite > masterGuard);
  assert.ok(exceptionGuard > masterWrite && exceptionWrite > exceptionGuard);
  assert.match(
    source,
    /employeeSavePlan\.requiresEmployeeMasterRevision[\s\S]*!expectedUpdatedAt/
  );
  assert.match(
    source,
    /if \(employeeSavePlan\.writeEmployeeMaster\) \{[\s\S]*verifyEmployeeSaveSnapshot\([\s\S]*"core_employee_master"/
  );

  const repository = read("workers/core/repositories/hr-employees.js");
  assert.match(repository, /EMPLOYEE_OPTIMISTIC_CONCURRENCY_V1/);
  assert.match(
    repository,
    /cleanText\(existing\?\.updated_at\)\s*!==\s*expectedUpdatedAt/
  );
  assert.match(repository, /'core_hr:employee_changed'/);
});

test("exception work-start and work-end fields use the V2 time picker bridge", () => {
  const editor = read("src/pages/dashboardEmployees/WorkHourOverridesEditor.tsx");
  const bridge = read("src/components/dashboard-v2/DashboardNativeControlBridgeV2.tsx");
  const picker = read("src/components/dashboard-v2/DashboardTimePickerV2.tsx");

  assert.match(
    editor,
    /id="employee-live-v2-override-start"[\s\S]*<DashboardTimeInputV2/
  );
  assert.match(
    editor,
    /id="employee-live-v2-override-end"[\s\S]*<DashboardTimeInputV2/
  );
  assert.match(bridge, /<DashboardTimePickerV2/);
  assert.match(picker, /type="time"/);
});
