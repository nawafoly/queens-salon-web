import { isPayrollSnapshotLocked, type PayrollStatus } from "./payrollCalculations.ts";

export type PayrollActionVisibilityInput = {
  status: PayrollStatus | string;
  payrollSetupComplete: boolean;
  canManage: boolean;
  role?: string | null;
};

function isAdminRole(role?: string | null) {
  return role === "owner" || role === "admin";
}

export function payrollActionVisibility(input: PayrollActionVisibilityInput) {
  const status = String(input.status || "draft");
  const locked = isPayrollSnapshotLocked(status);
  const canManageComplete = input.canManage && input.payrollSetupComplete;
  const canReopenApproved = canManageComplete && status === "approved" && isAdminRole(input.role);

  return {
    showApprove: status !== "approved" && status !== "paid",
    canApprove: canManageComplete && status !== "approved" && status !== "paid",
    showMarkPaid: status === "approved",
    canMarkPaid: canManageComplete && status === "approved",
    showReopen: canReopenApproved,
    canReopen: canReopenApproved,
    canRecalculate: input.canManage && !locked,
    canEditAdjustments: input.canManage && !locked,
  };
}
