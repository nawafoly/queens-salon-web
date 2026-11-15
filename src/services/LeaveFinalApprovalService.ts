import { coreApiRequest } from "./coreApiClient";

export type LeaveFinalApprovalAuthority = {
  salon_id: string;
  authority_key: string;
  approver_user_id: string;
  approver_uid: string;
  approver_name: string;
  approver_email: string;
  approver_status: string;
};

export const LeaveFinalApprovalService = {
  get: () => coreApiRequest<LeaveFinalApprovalAuthority | null>("/api/core/hr/approval-authorities/leaves"),
  assign: (approverUserId: string) => coreApiRequest<LeaveFinalApprovalAuthority>(
    "/api/core/hr/approval-authorities/leaves",
    { method: "PUT", body: { approverUserId } }
  ),
};
