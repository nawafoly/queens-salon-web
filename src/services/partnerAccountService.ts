import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import { app } from "./firebase";
import { PartnerService } from "./partnerService";
import { linkExistingEmployeeRecordToPartner, syncPartnerEmployeeRecord } from "./employeeHub";
import type { CreatePartnerMemberInput } from "../types/partner";

const PROVISIONING_APP_NAME = "partner-account-provisioning";

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getProvisioningAuth() {
  const secondaryApp = getApps().some((candidate) => candidate.name === PROVISIONING_APP_NAME)
    ? getApp(PROVISIONING_APP_NAME)
    : initializeApp(app.options, PROVISIONING_APP_NAME);
  return getAuth(secondaryApp);
}

async function createFirebaseAccount(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const email = cleanEmail(input.email);
  const password = String(input.password || "");
  const displayName = String(input.displayName || "").trim();

  if (!email || !email.includes("@")) {
    throw new Error("partner_account:email_invalid");
  }
  if (password.length < 8) {
    throw new Error("partner_account:password_too_short");
  }

  const provisioningAuth = getProvisioningAuth();
  await setPersistence(provisioningAuth, inMemoryPersistence);
  await signOut(provisioningAuth).catch(() => undefined);
  const credential = await createUserWithEmailAndPassword(
    provisioningAuth,
    email,
    password
  );
  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }
  return { provisioningAuth, user: credential.user, email };
}

async function rollbackUser(user: User) {
  try {
    await deleteUser(user);
  } catch (error) {
    console.warn("[partnerAccount] failed to rollback Firebase user", error);
  }
}

export const PartnerAccountService = {
  async createMemberWithAccount(
    member: CreatePartnerMemberInput,
    password: string,
    context?: { partnerName?: string; contractId?: string; resourceIds?: string[] }
  ) {
    const provisioned = await createFirebaseAccount({
      email: member.email || "",
      password,
      displayName: member.displayName,
    });

    try {
      const memberId = await PartnerService.createPartnerMember({
        ...member,
        email: provisioned.email,
        userUid: provisioned.user.uid,
      });
      let employeeId: string | undefined;
      if (member.memberType !== "owner") {
        const linked = await syncPartnerEmployeeRecord({
          partnerId: member.partnerId,
          partnerMemberId: memberId,
          partnerName: context?.partnerName,
          displayName: member.displayName,
          email: provisioned.email,
          phone: member.phone,
          userUid: provisioned.user.uid,
          contractId: context?.contractId,
          resourceIds: context?.resourceIds,
        });
        employeeId = linked.employeeId;
        await PartnerService.updatePartnerMember(memberId, { employeeId });
      }
      return { memberId, userUid: provisioned.user.uid, email: provisioned.email, employeeId };
    } catch (error) {
      await rollbackUser(provisioned.user);
      throw error;
    } finally {
      await signOut(provisioned.provisioningAuth).catch(() => undefined);
    }
  },

  async linkExistingMemberAccount(input: {
    memberId: string;
    partnerId: string;
    memberType: CreatePartnerMemberInput["memberType"];
    displayName: string;
    email: string;
    phone?: string;
    password: string;
    partnerName?: string;
    contractId?: string;
    resourceIds?: string[];
  }) {
    const provisioned = await createFirebaseAccount(input);

    try {
      const linkedAccount = await PartnerService.linkPartnerMemberAccount(input.memberId, {
        userUid: provisioned.user.uid,
        email: provisioned.email,
      });
      if (input.memberType !== "owner") {
        const linkedEmployee = await syncPartnerEmployeeRecord({
          partnerId: input.partnerId,
          partnerMemberId: input.memberId,
          partnerName: input.partnerName,
          displayName: input.displayName,
          email: provisioned.email,
          phone: input.phone,
          userUid: provisioned.user.uid,
          contractId: input.contractId,
          resourceIds: input.resourceIds,
        });
        await PartnerService.updatePartnerMember(input.memberId, { employeeId: linkedEmployee.employeeId });
        return { ...linkedAccount, employeeId: linkedEmployee.employeeId };
      }
      return linkedAccount;
    } catch (error) {
      await rollbackUser(provisioned.user);
      throw error;
    } finally {
      await signOut(provisioned.provisioningAuth).catch(() => undefined);
    }
  },

  async createOperationalMemberWithoutAccount(
    member: CreatePartnerMemberInput,
    context?: { partnerName?: string; contractId?: string; resourceIds?: string[] }
  ) {
    const memberId = await PartnerService.createPartnerMember(member);
    if (member.memberType === "owner") return { memberId };

    const linked = await syncPartnerEmployeeRecord({
      partnerId: member.partnerId,
      partnerMemberId: memberId,
      partnerName: context?.partnerName,
      displayName: member.displayName,
      email: member.email,
      phone: member.phone,
      contractId: context?.contractId,
      resourceIds: context?.resourceIds,
    });
    await PartnerService.updatePartnerMember(memberId, { employeeId: linked.employeeId });
    return { memberId, employeeId: linked.employeeId };
  },

  async syncExistingOperationalMember(
    member: {
      id: string;
      partnerId: string;
      memberType: CreatePartnerMemberInput["memberType"];
      displayName: string;
      email?: string;
      phone?: string;
      userUid?: string;
      status?: string;
    },
    context?: { partnerName?: string; contractId?: string; resourceIds?: string[] }
  ) {
    if (member.memberType === "owner") throw new Error("partner_employee:owner_not_operational");
    const linked = await syncPartnerEmployeeRecord({
      partnerId: member.partnerId,
      partnerMemberId: member.id,
      partnerName: context?.partnerName,
      displayName: member.displayName,
      email: member.email,
      phone: member.phone,
      userUid: member.userUid,
      active: member.status === "active",
      contractId: context?.contractId,
      resourceIds: context?.resourceIds,
    });
    await PartnerService.updatePartnerMember(member.id, { employeeId: linked.employeeId });
    return linked;
  },

  async linkMemberToExistingEmployee(input: {
    memberId: string;
    partnerId: string;
    employeeId: string;
    employeeUid?: string;
    employeeEmail?: string;
    partnerName?: string;
    contractId?: string;
    resourceIds?: string[];
  }) {
    const linked = await linkExistingEmployeeRecordToPartner({
      employeeId: input.employeeId,
      employeeUid: input.employeeUid,
      partnerId: input.partnerId,
      partnerMemberId: input.memberId,
      partnerName: input.partnerName,
      contractId: input.contractId,
      resourceIds: input.resourceIds,
    });
    await PartnerService.updatePartnerMember(input.memberId, {
      employeeId: linked.employeeId,
      ...(linked.employeeUid ? { userUid: linked.employeeUid } : {}),
      ...(input.employeeEmail ? { email: input.employeeEmail } : {}),
    });
    return linked;
  },

  async createMemberFromExistingEmployee(input: {
    partnerId: string;
    employee: {
      employeeId: string;
      employeeUid?: string;
      name: string;
      email?: string;
      phone?: string;
    };
    partnerName?: string;
    contractId?: string;
    resourceIds?: string[];
  }) {
    const memberId = await PartnerService.createPartnerMember({
      partnerId: input.partnerId,
      memberType: "employee",
      status: "active",
      displayName: input.employee.name,
      userUid: input.employee.employeeUid,
      employeeId: input.employee.employeeId,
      email: input.employee.email,
      phone: input.employee.phone,
      canWorkAsProvider: true,
      canManageTeam: false,
      canManageInventory: false,
      canViewFinancials: false,
    });
    await linkExistingEmployeeRecordToPartner({
      employeeId: input.employee.employeeId,
      employeeUid: input.employee.employeeUid,
      partnerId: input.partnerId,
      partnerMemberId: memberId,
      partnerName: input.partnerName,
      contractId: input.contractId,
      resourceIds: input.resourceIds,
    });
    return { memberId, employeeId: input.employee.employeeId };
  },
};
