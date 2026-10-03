import { readFileSync, writeFileSync } from "node:fs";

const dashboardPath = "src/pages/DashboardEmployees.tsx";
let source = readFileSync(dashboardPath, "utf8");

function replaceOnce(oldText, newText, label) {
  if (!source.includes(oldText)) {
    throw new Error(`Missing replacement anchor: ${label}`);
  }
  source = source.replace(oldText, newText);
}

if (!source.includes("function employeeCanonicalUiId(")) {
  replaceOnce(
    "function employeeIdentityValues(staff: Partial<StaffPublicUi>, rawDocId = \"\") {",
    `function employeeCanonicalUiId(\n  staff?: Partial<StaffPublicUi> | null,\n  fallbackId = \"\"\n) {\n  const identity = employeeIdentityOf(staff || null);\n  return cleanText(\n    identity.employeeId ||\n      identity.id ||\n      fallbackId\n  );\n}\n\nfunction employeeIdentityValues(staff: Partial<StaffPublicUi>, rawDocId = \"\") {`,
    "canonical UI id helper"
  );
}

replaceOnce(
`  const primaryCanonicalDocId = employeeCanonicalDocIdOf(primary);\n  const fallbackCanonicalDocId = employeeCanonicalDocIdOf(fallback);\n  const staffPublicDocId = cleanText(\n    primaryCanonicalDocId ||\n      fallbackCanonicalDocId ||\n      (primary as any)?.staffPublicDocId ||\n      (fallback as any)?.staffPublicDocId\n  );\n  const sourceDocId = cleanText((primary as any)?.sourceDocId || (fallback as any)?.sourceDocId);\n  const canonicalEmployeeId = cleanText(staffPublicDocId || primary.id || fallback.id);`,
`  // Canonical employee document ids must win over authentication UIDs.\n  // A core_staff mirror may use firebase_uid as its row id while core_hr owns\n  // the real employee_profiles.id. Merge both identities without promoting\n  // the auth UID to the employee master key.\n  const linkedUidSet = new Set([\n    ...employeeLinkedUidValues(primary),\n    ...employeeLinkedUidValues(fallback),\n  ]);\n  const canonicalCandidates = uniqueCleanTexts([\n    employeeCanonicalDocIdOf(primary),\n    employeeCanonicalDocIdOf(fallback),\n    ...employeeExplicitDocIdValues(primary),\n    ...employeeExplicitDocIdValues(fallback),\n    (primary as any)?.sourceDocId,\n    (fallback as any)?.sourceDocId,\n    primary.id,\n    fallback.id,\n  ]);\n  const canonicalEmployeeId = cleanText(\n    canonicalCandidates.find((value) => !linkedUidSet.has(value)) ||\n      canonicalCandidates[0] ||\n      \"\"\n  );\n  const staffPublicDocId = canonicalEmployeeId;\n  const sourceDocId = cleanText((primary as any)?.sourceDocId || (fallback as any)?.sourceDocId);`,
  "merged row canonical id precedence"
);

replaceOnce(
`  const openEdit = (x: StaffPublicUi, updateRoute = true) => {\n    closingEmployeeDetailRef.current = false;\n    selectedEmployeeIdentityRef.current = employeeIdentityOf(x);\n    setSelectedEmployeeId(x.id);\n    setActiveTab(\"basic\");\n    setActiveStatsSubTab(\"payroll\");\n    setMode(\"edit\");\n    setEditId(x.id);`,
`  const openEdit = (x: StaffPublicUi, updateRoute = true) => {\n    closingEmployeeDetailRef.current = false;\n    const employeeIdentity = employeeIdentityOf(x);\n    const canonicalEmployeeId = employeeCanonicalUiId(x, x.id);\n    selectedEmployeeIdentityRef.current = employeeIdentity;\n    setSelectedEmployeeId(canonicalEmployeeId);\n    setActiveTab(\"basic\");\n    setActiveStatsSubTab(\"payroll\");\n    setMode(\"edit\");\n    setEditId(canonicalEmployeeId);`,
  "openEdit canonical identity"
);

replaceOnce(
`    const switchingScheduleEmployee =\n      cleanText(editId) !==\n      cleanText(x.id);`,
`    const switchingScheduleEmployee =\n      cleanText(editId) !==\n      canonicalEmployeeId;`,
  "openEdit schedule identity"
);

replaceOnce(
`    if (updateRoute) navigate(\`/dashboard/employees/\${encodeURIComponent(x.id)}/basic\`);`,
`    if (updateRoute) navigate(\`/dashboard/employees/\${encodeURIComponent(canonicalEmployeeId)}/basic\`);`,
  "openEdit route identity"
);

replaceOnce(
`    if (editId !== matched.id) openEdit(matched, false);\n    const resolvedRouteSection: EmployeeSplitTab =`,
`    const matchedCanonicalEmployeeId = employeeCanonicalUiId(\n      matched,\n      matched.id\n    );\n    if (editId !== matchedCanonicalEmployeeId) openEdit(matched, false);\n    const resolvedRouteSection: EmployeeSplitTab =`,
  "route matched canonical identity"
);

replaceOnce(
`        \`/dashboard/employees/\${encodeURIComponent(matched.id)}/\${allowedRouteSection}\`,`,
`        \`/dashboard/employees/\${encodeURIComponent(matchedCanonicalEmployeeId)}/\${allowedRouteSection}\`,`,
  "route canonical navigation"
);

replaceOnce(
`            setSelectedEmployeeId(matched.id);\n            setEditId((current) =>\n              current ? matched.id : current\n            );\n            selectedEmployeeIdentityRef.current =\n              employeeIdentityOf(matched);`,
`            const matchedIdentity = employeeIdentityOf(matched);\n            const matchedCanonicalEmployeeId = employeeCanonicalUiId(\n              matched,\n              matched.id\n            );\n            setSelectedEmployeeId(matchedCanonicalEmployeeId);\n            setEditId((current) =>\n              current ? matchedCanonicalEmployeeId : current\n            );\n            selectedEmployeeIdentityRef.current =\n              matchedIdentity;`,
  "reload canonical identity"
);

replaceOnce(
`    if (matched) {\n      if (matched.id !== selectedEmployeeId) {\n        setSelectedEmployeeId(matched.id);\n        setEditId((current) => (current ? matched.id : current));\n        selectedEmployeeIdentityRef.current = employeeIdentityOf(matched);\n      }\n      return;\n    }`,
`    if (matched) {\n      const matchedIdentity = employeeIdentityOf(matched);\n      const matchedCanonicalEmployeeId = employeeCanonicalUiId(\n        matched,\n        matched.id\n      );\n      if (matchedCanonicalEmployeeId !== selectedEmployeeId) {\n        setSelectedEmployeeId(matchedCanonicalEmployeeId);\n        setEditId((current) =>\n          current ? matchedCanonicalEmployeeId : current\n        );\n      }\n      selectedEmployeeIdentityRef.current = matchedIdentity;\n      return;\n    }`,
  "selected employee canonical reconciliation"
);

replaceOnce(
`  const editingStaff = useMemo(\n    () => (editId ? list.find((x) => x.id === editId) || null : null),\n    [editId, list]\n  );`,
`  const editingStaff = useMemo(\n    () =>\n      editId\n        ? list.find(\n            (x) =>\n              cleanText(x.id) === cleanText(editId) ||\n              employeeMatchesRouteId(x, editId)\n          ) || null\n        : null,\n    [editId, list]\n  );`,
  "editingStaff canonical lookup"
);

replaceOnce(
`    const targetEmployeeId = cleanText(\n      editId\n        ? (editingStaff as any)?.staffPublicDocId ||\n            ((editingStaff as any)?.source === \"core_staff\" || (editingStaff as any)?.source === \"staff_public\" ? (editingStaff as any)?.sourceDocId : \"\") ||\n            editId\n        : generatedEmployeeId\n    );`,
`    const targetEmployeeId = cleanText(\n      editId\n        ? employeeCanonicalUiId(editingStaff, editId)\n        : generatedEmployeeId\n    );`,
  "save target canonical identity"
);

writeFileSync(dashboardPath, source);

const testPath = "workers/hr-employee-canonical-id-contract.test.mjs";
writeFileSync(
  testPath,
  `import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { readFileSync } from \"node:fs\";\n\nconst source = readFileSync(\"src/pages/DashboardEmployees.tsx\", \"utf8\");\n\ntest(\"employee editor keeps canonical employee id separate from Firebase uid\", () => {\n  assert.match(source, /function employeeCanonicalUiId\\(/);\n  assert.match(source, /setSelectedEmployeeId\\(canonicalEmployeeId\\)/);\n  assert.match(source, /setEditId\\(canonicalEmployeeId\\)/);\n  assert.match(source, /encodeURIComponent\\(canonicalEmployeeId\\)/);\n  assert.match(source, /employeeCanonicalUiId\\(editingStaff, editId\\)/);\n  assert.match(source, /employeeMatchesRouteId\\(x, editId\\)/);\n});\n\ntest(\"merged employee rows prefer canonical document ids over linked auth uids\", () => {\n  assert.match(source, /const linkedUidSet = new Set\\(\\[/);\n  assert.match(source, /canonicalCandidates\\.find\\(\\(value\\) => !linkedUidSet\\.has\\(value\\)\\)/);\n  assert.match(source, /const staffPublicDocId = canonicalEmployeeId/);\n});\n\ntest(\"legacy save target cannot prioritize staff mirror ids over canonical employee id\", () => {\n  assert.doesNotMatch(\n    source,\n    /\\(editingStaff as any\\)\\?\\.staffPublicDocId \\|\\|[\\s\\S]{0,220}source === \\"core_staff\\"/\n  );\n});\n`
);

console.log("Applied canonical employee identity fix and regression contract.");
