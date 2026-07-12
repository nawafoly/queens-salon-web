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
import type { EmployeeDirectoryEntry } from "./employeeHub";
import {
  buildPartnerMemberOperationalProfile,
  getEmployeeDirectoryEntry,
} from "./employeeDirectory";
import type {
  CreatePartnerMemberInput,
  PartnerMember,
} from "../types/partner";

const PROVISIONING_APP_NAME = "partner-account-provisioning";

type PartnerEmployeeContext = {
  partnerName?: string;
  contractId?: string;
  resourceIds?: string[];
};

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown) {
  return String(value || "").trim();
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
  const displayName = cleanText(input.displayName);

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

async function syncOperationalProfile(input: {
  memberId: string;
  employeeId: string;
  employee?: EmployeeDirectoryEntry | null;
  context?: PartnerEmployeeContext;
  syncIdentity?: boolean;
}) {
  const employee = input.employee || (await getEmployeeDirectoryEntry(input.employeeId));
  if (!employee) {
    return { synced: false as const, employee: null };
  }

  const patch = {
    ...(input.syncIdentity && cleanText(employee.name)
      ? { displayName: cleanText(employee.name) }
      : {}),
    ...(input.syncIdentity && cleanEmail(employee.email)
      ? { email: cleanEmail(employee.email) }
      : {}),
    ...(input.syncIdentity && cleanText(employee.phone)
      ? { phone: cleanText(employee.phone) }
      : {}),
    operationalProfile: buildPartnerMemberOperationalProfile(employee, input.context),
  };

  await PartnerService.updatePartnerMember(input.memberId, patch);
  return { synced: true as const, employee };
}

export const PartnerAccountService = {
  async createMemberWithAccount(
    member: CreatePartnerMemberInput,
    password: string,
    context?: PartnerEmployeeContext
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
        await syncOperationalProfile({ memberId, employeeId, context });
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
        await PartnerService.updatePartnerMember(input.memberId, {
          employeeId: linkedEmployee.employeeId,
        });
        await syncOperationalProfile({
          memberId: input.memberId,
          employeeId: linkedEmployee.employeeId,
          context: input,
        });
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
    context?: PartnerEmployeeContext
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
    await syncOperationalProfile({ memberId, employeeId: linked.employeeId, context });
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
    context?: PartnerEmployeeContext
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
    await syncOperationalProfile({
      memberId: member.id,
      employeeId: linked.employeeId,
      context,
    });
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
    await syncOperationalProfile({
      memberId: input.memberId,
      employeeId: linked.employeeId,
      context: input,
      syncIdentity: true,
    });
    return linked;
  },

  async createMemberFromExistingEmployee(input: {
    partnerId: string;
    employee: EmployeeDirectoryEntry;
    partnerName?: string;
    contractId?: string;
    resourceIds?: string[];
  }) {
    const operationalProfile = buildPartnerMemberOperationalProfile(input.employee, input);
    const memberId = await PartnerService.createPartnerMember({
      partnerId: input.partnerId,
      memberType: "employee",
      status: "active",
      displayName: input.employee.name,
      userUid: input.employee.linkedUid || input.employee.employeeUid,
      employeeId: input.employee.employeeId,
      email: input.employee.email,
      phone: input.employee.phone,
      canWorkAsProvider: true,
      canManageTeam: false,
      canManageInventory: false,
      canViewFinancials: false,
      operationalProfile,
    });
    await linkExistingEmployeeRecordToPartner({
      employeeId: input.employee.employeeId,
      employeeUid: input.employee.linkedUid || input.employee.employeeUid,
      partnerId: input.partnerId,
      partnerMemberId: memberId,
      partnerName: input.partnerName,
      contractId: input.contractId,
      resourceIds: input.resourceIds,
    });
    return { memberId, employeeId: input.employee.employeeId };
  },

  async syncMemberOperationalProfile(
    member: Pick<PartnerMember, "id" | "employeeId" | "displayName">,
    context?: PartnerEmployeeContext & { employee?: EmployeeDirectoryEntry | null }
  ) {
    if (!member.employeeId) {
      return { synced: false as const, employee: null };
    }
    return syncOperationalProfile({
      memberId: member.id,
      employeeId: member.employeeId,
      employee: context?.employee,
      context,
      syncIdentity: true,
    });
  },
};
