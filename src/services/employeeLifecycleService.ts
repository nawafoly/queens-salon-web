import { CoreHrService } from "./CoreHrService";
import { CoreStaffService } from "./CoreStaffService";

export type ArchiveEmployeeInput = {
  employeeId: string;
  linkedUids?: Array<string | null | undefined>;
  deletedBy?: string | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function archiveEmployee(input: ArchiveEmployeeInput) {
  const employeeId = clean(input.employeeId);
  if (!employeeId) throw new Error("معرّف الموظفة مفقود؛ لم تتم الأرشفة.");

  // HR and booking staff are both canonical Core D1 projections. No Firestore
  // mirror is written; failures surface so a half-archived employee is visible.
  await CoreHrService.saveEmployee({
    id: employeeId,
    status: "deleted",
    employment: { employmentStatus: "deleted" },
  });
  try {
    await CoreStaffService.update(employeeId, {
      active: false,
      employmentStatus: "deleted",
      showOnBooking: false,
    });
  } catch (error: any) {
    if (Number(error?.status) !== 404 && !String(error?.message || "").includes("not_found")) throw error;
  }
}
