import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRegexOnce(source, regex, to, label) {
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected 1 match, found ${matches.length}`);
  return source.replace(regex, to);
}

// 1) One canonical frontend identity primitive.
write("src/helpers/employeeIdentityId.ts", `export function normalizeEmployeeIdentityId(value: unknown) {
  let id = String(value ?? "").trim();
  if (!id) return "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!/%(?:25|[C-Fc-f][0-9A-Fa-f])/.test(id)) break;

    let decoded = id;
    try {
      decoded = decodeURIComponent(id).trim();
    } catch {
      break;
    }

    if (!decoded || decoded === id) break;
    id = decoded;
  }

  return id;
}

export function isCanonicalEmployeeIdentityId(value: unknown) {
  const id = normalizeEmployeeIdentityId(value);
  return Boolean(
    id &&
      id.length <= 128 &&
      id !== "." &&
      id !== ".." &&
      !id.includes("/") &&
      !id.startsWith("app_user_")
  );
}

export function employeeIdentityEquals(left: unknown, right: unknown) {
  const leftId = normalizeEmployeeIdentityId(left);
  const rightId = normalizeEmployeeIdentityId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

export function normalizeEmployeeIdentityIds(values: readonly unknown[]) {
  return Array.from(
    new Set(values.map(normalizeEmployeeIdentityId).filter(Boolean))
  );
}
`);

// 2) Core HR client boundary always emits/accepts canonical employee ids.
{
  const file = "src/services/CoreHrService.ts";
  let source = read(file);
  source = replaceOnce(
    source,
    `import { buildDateKeysInRange } from "../helpers/hr/workSchedule";\n`,
    `import { buildDateKeysInRange } from "../helpers/hr/workSchedule";\nimport { normalizeEmployeeIdentityId, normalizeEmployeeIdentityIds } from "../helpers/employeeIdentityId";\n`,
    "CoreHrService identity import",
  );
  source = replaceOnce(
    source,
    `function employeeReconciliation(employeeId: unknown) {\n  const value = String(employeeId || "").trim();\n  return value ? { employeeId: value } : undefined;\n}\n`,
    `function employeeReconciliation(employeeId: unknown) {\n  const value = normalizeEmployeeIdentityId(employeeId);\n  return value ? { employeeId: value } : undefined;\n}\n\nfunction normalizeCoreSchedule(row: Record<string, unknown>) {\n  const mapped = camel<CoreHrSchedule>(row);\n  return {\n    ...mapped,\n    employeeId: normalizeEmployeeIdentityId(mapped.employeeId),\n  };\n}\n\nfunction normalizeCoreEmployee(row: Record<string, unknown>) {\n  const mapped = camel<CoreHrEmployee>(row);\n  const employment = mapped.employment && typeof mapped.employment === "object"\n    ? {\n        ...(mapped.employment as Record<string, unknown>),\n        employeeId: normalizeEmployeeIdentityId((mapped.employment as Record<string, unknown>).employeeId),\n      }\n    : mapped.employment;\n  return {\n    ...mapped,\n    id: normalizeEmployeeIdentityId(mapped.id),\n    employeeId: normalizeEmployeeIdentityId((mapped as any).employeeId || mapped.id),\n    employment,\n    schedules: Array.isArray(row.schedules)\n      ? row.schedules.map((item) => normalizeCoreSchedule(item as Record<string, unknown>))\n      : [],\n  };\n}\n`,
    "CoreHrService reconciliation",
  );
  source = replaceOnce(
    source,
    `function normalizeResolvedShiftEmployeeIds(values: readonly unknown[]) {\n  return Array.from(\n    new Set(\n      values\n        .map((value) => String(value || "").trim())\n        .filter(Boolean)\n    )\n  );\n}\n`,
    `function normalizeResolvedShiftEmployeeIds(values: readonly unknown[]) {\n  return normalizeEmployeeIdentityIds(values);\n}\n`,
    "CoreHrService shift id normalization",
  );
  source = replaceOnce(
    source,
    `  const targetEmployeeId = String(employeeId || "").trim();\n`,
    `  const targetEmployeeId = normalizeEmployeeIdentityId(employeeId);\n`,
    "CoreHrService cache invalidation id",
  );
  source = replaceOnce(
    source,
    `    return rows.map((row) => ({ ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] }));\n`,
    `    return rows.map(normalizeCoreEmployee);\n`,
    "CoreHrService listEmployees mapping",
  );
  source = replaceOnce(
    source,
    `    const row = await coreApiRequest<Record<string, unknown>>(\`/api/core/hr/employees/\${encodeURIComponent(id)}\`);\n    return { ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] };\n`,
    `    const employeeId = normalizeEmployeeIdentityId(id);\n    const row = await coreApiRequest<Record<string, unknown>>(\`/api/core/hr/employees/\${encodeURIComponent(employeeId)}\`);\n    return normalizeCoreEmployee(row);\n`,
    "CoreHrService getEmployee mapping",
  );
  const profileMappingPattern = /    return \{\n      \.\.\.camel<CoreHrEmployee>\(row\),\n      schedules: Array\.isArray\(row\.schedules\)\n        \? row\.schedules\.map\(\(item\) => camel<CoreHrSchedule>\(item as Record<string, unknown>\)\)\n        : \[\],\n    \};/g;
  const profileMappingMatches = [...source.matchAll(profileMappingPattern)];
  if (profileMappingMatches.length !== 2) {
    throw new Error("CoreHrService profile mappings: expected 2 matches, found " + profileMappingMatches.length);
  }
  source = source.replace(profileMappingPattern, "    return normalizeCoreEmployee(row);");
  write(file, source);
}

// 3) Core staff projection is canonical and deduped before any dashboard/booking consumer sees it.
write("src/services/CoreStaffService.ts", `import { coreApiRequest } from "./coreApiClient";
import { mapCoreStaff } from "./coreBookingMappers";
import { normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";
import type { CoreStaff } from "../types/coreApi";

function mergeCanonicalStaffRows(rows: CoreStaff[]) {
  const byId = new Map<string, CoreStaff>();

  for (const row of rows) {
    const id = normalizeEmployeeIdentityId(row.id);
    if (!id) continue;
    const candidate = { ...row, id };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, candidate);
      continue;
    }

    const specialties = Array.from(new Set([
      ...(existing.specialties || []),
      ...(candidate.specialties || []),
    ]));
    const schedulesById = new Map<string, any>();
    for (const schedule of [...(existing.schedules || []), ...(candidate.schedules || [])]) {
      const key = String((schedule as any)?.id || JSON.stringify(schedule));
      if (!schedulesById.has(key)) schedulesById.set(key, schedule);
    }

    byId.set(id, {
      ...existing,
      ...candidate,
      id,
      firebaseUid: candidate.firebaseUid || existing.firebaseUid,
      name: candidate.name || existing.name,
      phoneNormalized: candidate.phoneNormalized || existing.phoneNormalized,
      avatarUrl: candidate.avatarUrl || existing.avatarUrl,
      active: existing.active || candidate.active,
      showOnBooking: existing.showOnBooking || candidate.showOnBooking,
      specialties,
      schedules: Array.from(schedulesById.values()),
    });
  }

  return Array.from(byId.values());
}

export const CoreStaffService = {
  async list(
    query: { activeOnly?: boolean; serviceId?: string } = {}
  ): Promise<CoreStaff[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/staff",
      {
        query: {
          active: query.activeOnly === false ? undefined : true,
          serviceId: query.serviceId,
        },
      }
    );
    return mergeCanonicalStaffRows(rows.map(mapCoreStaff));
  },

  async get(id: string): Promise<CoreStaff> {
    const employeeId = normalizeEmployeeIdentityId(id);
    const row = await coreApiRequest<Record<string, unknown>>(
      \`/api/core/staff/\${encodeURIComponent(employeeId)}\`
    );
    return { ...mapCoreStaff(row), id: employeeId || normalizeEmployeeIdentityId(row.id) };
  },

  async update(
    id: string,
    input: Record<string, unknown>
  ): Promise<CoreStaff> {
    const employeeId = normalizeEmployeeIdentityId(id);
    const row = await coreApiRequest<Record<string, unknown>>(
      \`/api/core/staff/\${encodeURIComponent(employeeId)}\`,
      { method: "PATCH", body: input }
    );
    return { ...mapCoreStaff(row), id: employeeId || normalizeEmployeeIdentityId(row.id) };
  },
};
`);

// 4) Staff mapper normalizes nested staff identity too.
{
  const file = "src/services/coreBookingMappers.ts";
  let source = read(file);
  source = replaceOnce(
    source,
    `import type { StaffPublicWithId } from "./firestoreStaffPublic";\n`,
    `import type { StaffPublicWithId } from "./firestoreStaffPublic";\nimport { normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";\n`,
    "coreBookingMappers identity import",
  );
  source = replaceOnce(
    source,
    `  return { ...mapped, active: Number(row.active) === 1 };\n}\n\nexport function mapCoreStaff`,
    `  return {\n    ...mapped,\n    staffId: normalizeEmployeeIdentityId(mapped.staffId),\n    active: Number(row.active) === 1,\n  };\n}\n\nexport function mapCoreStaff`,
    "core staff schedule id",
  );
  source = replaceOnce(
    source,
    `  return {\n    ...mapped,\n    active: Number(row.active) === 1,\n`,
    `  return {\n    ...mapped,\n    id: normalizeEmployeeIdentityId(mapped.id),\n    active: Number(row.active) === 1,\n`,
    "core staff id",
  );
  write(file, source);
}

// 5) Canonical employee directory: every join key uses the same primitive.
{
  const file = "src/services/employeeDirectory.ts";
  let source = read(file);
  source = replaceOnce(
    source,
    `import type { PartnerMemberOperationalProfile } from "../types/partner";\n`,
    `import type { PartnerMemberOperationalProfile } from "../types/partner";\nimport { employeeIdentityEquals, normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";\n`,
    "employeeDirectory identity import",
  );
  source = replaceOnce(
    source,
    `  const staffById = new Map(staffRows.map((row) => [cleanText(row.id), row] as const));\n`,
    `  const staffById = new Map(staffRows.map((row) => [normalizeEmployeeIdentityId(row.id), row] as const));\n`,
    "employeeDirectory staff keys",
  );
  source = replaceOnce(
    source,
    `    const employeeId = cleanText(account.employeeLink?.employeeId);\n`,
    `    const employeeId = normalizeEmployeeIdentityId(account.employeeLink?.employeeId);\n`,
    "employeeDirectory account key",
  );
  source = replaceOnce(
    source,
    `      const employeeId = cleanText(employee.id);\n`,
    `      const employeeId = normalizeEmployeeIdentityId(employee.id);\n`,
    "employeeDirectory employee id",
  );
  source = replaceOnce(
    source,
    `  const normalizedId = cleanText(employeeId);\n`,
    `  const normalizedId = normalizeEmployeeIdentityId(employeeId);\n`,
    "employeeDirectory lookup id",
  );
  source = source.replace(/cleanText\(row\.(employeeId|employeeDocId|linkedEmployeeDocId|employeeUid|linkedUid)\) === normalizedId/g, `employeeIdentityEquals(row.$1, normalizedId)`);
  write(file, source);
}

// 6) DashboardEmployees must never treat encoded Core staff as a second employee.
{
  const file = "src/pages/DashboardEmployees.tsx";
  let source = read(file);
  source = replaceOnce(
    source,
    `import { resolveEmployeeSaveCommandPlan } from "./dashboardEmployees/employeeSaveCommandOwnership";\n`,
    `import { resolveEmployeeSaveCommandPlan } from "./dashboardEmployees/employeeSaveCommandOwnership";\nimport { normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";\n`,
    "DashboardEmployees identity import",
  );
  source = replaceOnce(
    source,
    `function employeeCanonicalDocIdOf(staff: Partial<StaffPublicUi> | Record<string, unknown>, rawDocId = "") {\n  const sourceDocId = cleanText(rawDocId || (staff as any)?.sourceDocId || (staff as any)?.id);\n  const linkedUidSet = new Set(employeeLinkedUidValues(staff));\n  const explicitDocIds = employeeExplicitDocIdValues(staff);\n`,
    `function employeeCanonicalDocIdOf(staff: Partial<StaffPublicUi> | Record<string, unknown>, rawDocId = "") {\n  const sourceDocId = normalizeEmployeeIdentityId(rawDocId || (staff as any)?.sourceDocId || (staff as any)?.id);\n  const linkedUidSet = new Set(employeeLinkedUidValues(staff).map(normalizeEmployeeIdentityId));\n  const explicitDocIds = employeeExplicitDocIdValues(staff).map(normalizeEmployeeIdentityId);\n`,
    "DashboardEmployees canonical employee id",
  );
  source = replaceOnce(
    source,
    `          const employeeId = cleanText(canonicalEmployeeId);\n`,
    `          const employeeId = normalizeEmployeeIdentityId(canonicalEmployeeId);\n`,
    "DashboardEmployees upsert canonical id",
  );
  source = replaceOnce(
    source,
    `            rawDocId,\n          ]).filter((value) => value !== employeeId);\n`,
    `            normalizeEmployeeIdentityId(rawDocId),\n          ].map(normalizeEmployeeIdentityId)).filter((value) => value !== employeeId);\n`,
    "DashboardEmployees legacy aliases",
  );
  write(file, source);
}

// 7) Attendance + shift control must accept canonical Arabic ids, not an ASCII-only regex.
for (const file of [
  "src/pages/dashboardEmployees/AttendanceSection.tsx",
  "src/pages/dashboardEmployees/ShiftControlSection.tsx",
]) {
  let source = read(file);
  const serviceImport = `import { CoreHrService } from "../../services/CoreHrService";\n`;
  source = replaceOnce(
    source,
    serviceImport,
    `${serviceImport}import { isCanonicalEmployeeIdentityId } from "../../helpers/employeeIdentityId";\n`,
    `${file} identity import`,
  );
  source = replaceRegexOnce(
    source,
    /function isCoreEmployeeIdentifier\(value: unknown\) \{\n  const id = cleanText\(value\);\n  return Boolean\(\n    id &&\n      !id\.startsWith\("app_user_"\) &&\n      \/\^\[A-Za-z0-9_-\]\+\$\/\.test\(id\)\n  \);\n\}/,
    `const isCoreEmployeeIdentifier = isCanonicalEmployeeIdentityId;`,
    `${file} ASCII-only employee id`,
  );
  write(file, source);
}

// 8) Attendance security uses the same canonical validator.
{
  const file = "src/pages/DashboardAttendanceSecurity.tsx";
  let source = read(file);
  source = replaceOnce(
    source,
    `import { permissionIntervalsFromRequests } from "../helpers/hr/permissionAttendance";\n`,
    `import { permissionIntervalsFromRequests } from "../helpers/hr/permissionAttendance";\nimport { isCanonicalEmployeeIdentityId } from "../helpers/employeeIdentityId";\n`,
    "DashboardAttendanceSecurity identity import",
  );
  source = replaceOnce(
    source,
    `                value &&\n                !value.startsWith("app_user_") &&\n                /^[A-Za-z0-9_-]+$/.test(value)\n`,
    `                isCanonicalEmployeeIdentityId(value)\n`,
    "DashboardAttendanceSecurity ASCII-only identity",
  );
  write(file, source);
}

console.log("Employee lifecycle integrity source transformation applied.");
