export type EmployeeEditorMasterSnapshot = Record<string, unknown>;

export type EmployeeSaveCommandPlanInput = {
  isCreatingEmployee: boolean;
  baselineEmployeeMasterSnapshot: EmployeeEditorMasterSnapshot;
  desiredEmployeeMasterSnapshot: EmployeeEditorMasterSnapshot;
  workingHourOverridesChanged: boolean;
  scheduleChanged: boolean;
};

function stableSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSnapshotValue);

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((result, key) => {
        const normalized = stableSnapshotValue(
          (value as Record<string, unknown>)[key]
        );
        if (normalized !== undefined) result[key] = normalized;
        return result;
      }, {});
  }

  return value;
}

export function employeeMasterSnapshotsEqual(
  baseline: EmployeeEditorMasterSnapshot,
  desired: EmployeeEditorMasterSnapshot
) {
  return (
    JSON.stringify(stableSnapshotValue(baseline)) ===
    JSON.stringify(stableSnapshotValue(desired))
  );
}

export function resolveEmployeeSaveCommandPlan({
  isCreatingEmployee,
  baselineEmployeeMasterSnapshot,
  desiredEmployeeMasterSnapshot,
  workingHourOverridesChanged,
  scheduleChanged,
}: EmployeeSaveCommandPlanInput) {
  const employeeMasterChanged =
    isCreatingEmployee ||
    !employeeMasterSnapshotsEqual(
      baselineEmployeeMasterSnapshot,
      desiredEmployeeMasterSnapshot
    );

  return {
    employeeMasterChanged,
    writeEmployeeMaster: employeeMasterChanged,
    requiresEmployeeMasterRevision:
      employeeMasterChanged && !isCreatingEmployee,
    syncWorkingHourExceptions: workingHourOverridesChanged,
    replaceSchedules: scheduleChanged,
  };
}
