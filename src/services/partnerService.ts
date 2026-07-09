import {
  addDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import type {
  CreatePartnerContractInput,
  CreatePartnerInput,
  CreatePartnerMemberInput,
  CreateRentalResourceInput,
  Partner,
  PartnerBusinessCategory,
  PartnerContract,
  PartnerContractStatus,
  PartnerMember,
  PartnerMemberStatus,
  PartnerMemberType,
  PartnerStatus,
  RentalResource,
  RentalResourceStatus,
  RentalResourceType,
  UpdatePartnerContractInput,
  UpdatePartnerInput,
  UpdatePartnerMemberInput,
  UpdateRentalResourceInput,
} from "../types/partner";
import {
  PARTNER_SALON_ID,
  partnerCollection,
  partnerDoc,
} from "./partnerCollections";

const PARTNER_STATUSES = new Set<PartnerStatus>([
  "draft",
  "active",
  "suspended",
  "ended",
]);

const PARTNER_CATEGORIES = new Set<PartnerBusinessCategory>([
  "hair",
  "makeup",
  "nails",
  "pedicure",
  "lashes",
  "skin",
  "massage",
  "retail",
  "other",
]);

const RESOURCE_TYPES = new Set<RentalResourceType>([
  "hair_station",
  "makeup_station",
  "manicure_station",
  "pedicure_station",
  "lash_bed",
  "private_room",
  "retail_space",
  "custom",
]);

const RESOURCE_STATUSES = new Set<RentalResourceStatus>([
  "available",
  "reserved",
  "rented",
  "maintenance",
  "inactive",
]);

const CONTRACT_STATUSES = new Set<PartnerContractStatus>([
  "draft",
  "active",
  "expired",
  "terminated",
  "cancelled",
]);

const MEMBER_TYPES = new Set<PartnerMemberType>([
  "owner",
  "employee",
  "contractor",
]);

const MEMBER_STATUSES = new Set<PartnerMemberStatus>([
  "active",
  "inactive",
  "suspended",
]);

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanOptionalText(value: unknown) {
  const text = cleanText(value);
  return text || undefined;
}

function cleanNumber(value: unknown, minimum = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(minimum, numberValue) : minimum;
}

function cleanOptionalNumber(value: unknown, minimum = 0) {
  if (value === null || value === undefined || value === "") return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(minimum, numberValue);
}

function cleanPercent(value: unknown) {
  const normalized = cleanOptionalNumber(value, 0);
  return normalized === undefined ? undefined : Math.min(100, normalized);
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((item) => {
    const normalized = cleanText(item);
    if (normalized) unique.add(normalized);
  });
  return [...unique];
}

function cleanCategories(value: unknown): PartnerBusinessCategory[] {
  return cleanStringList(value).filter((item): item is PartnerBusinessCategory =>
    PARTNER_CATEGORIES.has(item as PartnerBusinessCategory)
  );
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function requireText(value: unknown, fieldName: string) {
  const text = cleanText(value);
  if (!text) throw new Error(`partner_validation:${fieldName}_required`);
  return text;
}

function normalizePartner(raw: Record<string, unknown>, id: string, salonId: string): Partner {
  const rawStatus = cleanText(raw.status) as PartnerStatus;
  return {
    id,
    salonId,
    displayName: cleanText(raw.displayName),
    legalName: cleanOptionalText(raw.legalName),
    ownerName: cleanText(raw.ownerName),
    ownerUid: cleanOptionalText(raw.ownerUid),
    email: cleanOptionalText(raw.email)?.toLowerCase(),
    phone: cleanOptionalText(raw.phone),
    nationalId: cleanOptionalText(raw.nationalId),
    commercialRegistration: cleanOptionalText(raw.commercialRegistration),
    taxNumber: cleanOptionalText(raw.taxNumber),
    businessCategories: cleanCategories(raw.businessCategories),
    status: PARTNER_STATUSES.has(rawStatus) ? rawStatus : "draft",
    notes: cleanOptionalText(raw.notes),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdByUid: cleanOptionalText(raw.createdByUid),
    updatedByUid: cleanOptionalText(raw.updatedByUid),
  };
}

function normalizeResource(
  raw: Record<string, unknown>,
  id: string,
  salonId: string
): RentalResource {
  const rawType = cleanText(raw.type) as RentalResourceType;
  const rawStatus = cleanText(raw.status) as RentalResourceStatus;
  return {
    id,
    salonId,
    code: cleanText(raw.code),
    name: cleanText(raw.name),
    type: RESOURCE_TYPES.has(rawType) ? rawType : "custom",
    status: RESOURCE_STATUSES.has(rawStatus) ? rawStatus : "available",
    branchId: cleanOptionalText(raw.branchId),
    floor: cleanOptionalText(raw.floor),
    zone: cleanOptionalText(raw.zone),
    description: cleanOptionalText(raw.description),
    currentPartnerId: cleanOptionalText(raw.currentPartnerId),
    currentContractId: cleanOptionalText(raw.currentContractId),
    equipmentNotes: cleanOptionalText(raw.equipmentNotes),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdByUid: cleanOptionalText(raw.createdByUid),
    updatedByUid: cleanOptionalText(raw.updatedByUid),
  };
}

function normalizeContract(
  raw: Record<string, unknown>,
  id: string,
  salonId: string
): PartnerContract {
  const rawStatus = cleanText(raw.status) as PartnerContractStatus;
  return {
    id,
    salonId,
    partnerId: cleanText(raw.partnerId),
    resourceIds: cleanStringList(raw.resourceIds),
    contractNumber: cleanText(raw.contractNumber),
    status: CONTRACT_STATUSES.has(rawStatus) ? rawStatus : "draft",
    billingModel:
      raw.billingModel === "revenue_share" ||
      raw.billingModel === "hybrid" ||
      raw.billingModel === "hourly" ||
      raw.billingModel === "daily"
        ? raw.billingModel
        : "fixed_rent",
    startDate: cleanText(raw.startDate),
    endDate: cleanOptionalText(raw.endDate),
    currency: cleanText(raw.currency) || "SAR",
    fixedRentAmount: cleanOptionalNumber(raw.fixedRentAmount),
    hourlyRate: cleanOptionalNumber(raw.hourlyRate),
    dailyRate: cleanOptionalNumber(raw.dailyRate),
    partnerSharePercent: cleanPercent(raw.partnerSharePercent),
    salonSharePercent: cleanPercent(raw.salonSharePercent),
    revenueShareBasis:
      raw.revenueShareBasis === "gross_before_tax" ||
      raw.revenueShareBasis === "net_after_discount" ||
      raw.revenueShareBasis === "net_excluding_tax"
        ? raw.revenueShareBasis
        : raw.revenueShareBasis === "collected_amount"
          ? "collected_amount"
          : undefined,
    minimumSalonShareAmount: cleanOptionalNumber(raw.minimumSalonShareAmount),
    depositAmount: cleanOptionalNumber(raw.depositAmount),
    paymentDueDay: cleanOptionalNumber(raw.paymentDueDay, 1),
    timeOffMonthlyHours: cleanOptionalNumber(raw.timeOffMonthlyHours),
    timeOffMaxHoursPerRolling14Days: cleanOptionalNumber(
      raw.timeOffMaxHoursPerRolling14Days
    ),
    notes: cleanOptionalText(raw.notes),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdByUid: cleanOptionalText(raw.createdByUid),
    updatedByUid: cleanOptionalText(raw.updatedByUid),
  };
}

function normalizeMember(
  raw: Record<string, unknown>,
  id: string,
  salonId: string
): PartnerMember {
  const rawType = cleanText(raw.memberType) as PartnerMemberType;
  const rawStatus = cleanText(raw.status) as PartnerMemberStatus;
  return {
    id,
    salonId,
    partnerId: cleanText(raw.partnerId),
    memberType: MEMBER_TYPES.has(rawType) ? rawType : "employee",
    status: MEMBER_STATUSES.has(rawStatus) ? rawStatus : "active",
    displayName: cleanText(raw.displayName),
    userUid: cleanOptionalText(raw.userUid),
    employeeId: cleanOptionalText(raw.employeeId),
    email: cleanOptionalText(raw.email)?.toLowerCase(),
    phone: cleanOptionalText(raw.phone),
    canWorkAsProvider: raw.canWorkAsProvider !== false,
    canManageTeam: raw.canManageTeam === true,
    canManageInventory: raw.canManageInventory === true,
    canViewFinancials: raw.canViewFinancials === true,
    notes: cleanOptionalText(raw.notes),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdByUid: cleanOptionalText(raw.createdByUid),
    updatedByUid: cleanOptionalText(raw.updatedByUid),
  };
}

function buildContractDocumentId(contractNumber: string) {
  const normalized = requireText(contractNumber, "contractNumber").toLocaleLowerCase("en-US");
  return `contract_${encodeURIComponent(normalized).replace(/%/g, "_")}`;
}

function buildContractCreatePayload(
  input: CreatePartnerContractInput,
  actorUid?: string
) {
  const partnerId = requireText(input.partnerId, "partnerId");
  const resourceIds = cleanStringList(input.resourceIds);
  const contractNumber = requireText(input.contractNumber, "contractNumber");
  const startDate = requireText(input.startDate, "startDate");
  const endDate = cleanOptionalText(input.endDate);
  const status = CONTRACT_STATUSES.has(input.status) ? input.status : "draft";
  const billingModel = input.billingModel;
  const partnerSharePercent = cleanPercent(input.partnerSharePercent);
  const salonSharePercent = cleanPercent(input.salonSharePercent);
  const fixedRentAmount = cleanOptionalNumber(input.fixedRentAmount);
  const hourlyRate = cleanOptionalNumber(input.hourlyRate);
  const dailyRate = cleanOptionalNumber(input.dailyRate);
  const paymentDueDay = cleanOptionalNumber(input.paymentDueDay, 1);
  const timeOffMonthlyHours = cleanOptionalNumber(input.timeOffMonthlyHours);
  const timeOffMaxHoursPerRolling14Days = cleanOptionalNumber(
    input.timeOffMaxHoursPerRolling14Days
  );

  if (resourceIds.length === 0) {
    throw new Error("partner_validation:resource_required");
  }
  if (status !== "draft" && status !== "active") {
    throw new Error("partner_validation:create_contract_status_invalid");
  }
  if (endDate && endDate < startDate) {
    throw new Error("partner_validation:end_date_before_start_date");
  }
  if (paymentDueDay !== undefined && (paymentDueDay < 1 || paymentDueDay > 28)) {
    throw new Error("partner_validation:payment_due_day_invalid");
  }
  if (
    timeOffMonthlyHours !== undefined &&
    timeOffMaxHoursPerRolling14Days !== undefined &&
    timeOffMaxHoursPerRolling14Days > timeOffMonthlyHours
  ) {
    throw new Error("partner_validation:rolling_time_off_exceeds_monthly");
  }

  const usesRevenueShare = billingModel === "revenue_share" || billingModel === "hybrid";
  if (usesRevenueShare) {
    if (partnerSharePercent === undefined || salonSharePercent === undefined) {
      throw new Error("partner_validation:revenue_shares_required");
    }
    if (Math.abs(partnerSharePercent + salonSharePercent - 100) > 0.001) {
      throw new Error("partner_validation:revenue_shares_must_equal_100");
    }
    if (!input.revenueShareBasis) {
      throw new Error("partner_validation:revenue_share_basis_required");
    }
  }
  if ((billingModel === "fixed_rent" || billingModel === "hybrid") && !(fixedRentAmount && fixedRentAmount > 0)) {
    throw new Error("partner_validation:fixed_rent_required");
  }
  if (billingModel === "hourly" && !(hourlyRate && hourlyRate > 0)) {
    throw new Error("partner_validation:hourly_rate_required");
  }
  if (billingModel === "daily" && !(dailyRate && dailyRate > 0)) {
    throw new Error("partner_validation:daily_rate_required");
  }

  const timestamp = serverTimestamp();
  return stripUndefined({
    partnerId,
    resourceIds,
    contractNumber,
    status,
    billingModel,
    startDate,
    endDate,
    currency: cleanText(input.currency) || "SAR",
    fixedRentAmount,
    hourlyRate,
    dailyRate,
    partnerSharePercent,
    salonSharePercent,
    revenueShareBasis: input.revenueShareBasis,
    minimumSalonShareAmount: cleanOptionalNumber(input.minimumSalonShareAmount),
    depositAmount: cleanOptionalNumber(input.depositAmount),
    paymentDueDay,
    timeOffMonthlyHours,
    timeOffMaxHoursPerRolling14Days,
    notes: cleanOptionalText(input.notes),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdByUid: cleanOptionalText(actorUid),
    updatedByUid: cleanOptionalText(actorUid),
  });
}

function buildAuditPatch(actorUid?: string) {
  const uid = cleanOptionalText(actorUid);
  return stripUndefined({
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
}

export const PartnerService = {
  async listPartners(salonId: string = PARTNER_SALON_ID): Promise<Partner[]> {
    const snapshot = await getDocs(partnerCollection("partners", salonId));
    return snapshot.docs
      .map((item) => normalizePartner(item.data(), item.id, salonId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
  },

  async getPartner(id: string, salonId: string = PARTNER_SALON_ID) {
    const normalizedId = requireText(id, "id");
    const snapshot = await getDoc(partnerDoc("partners", normalizedId, salonId));
    return snapshot.exists()
      ? normalizePartner(snapshot.data(), snapshot.id, salonId)
      : null;
  },

  async createPartner(
    input: CreatePartnerInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const payload = stripUndefined({
      displayName: requireText(input.displayName, "displayName"),
      legalName: cleanOptionalText(input.legalName),
      ownerName: requireText(input.ownerName, "ownerName"),
      ownerUid: cleanOptionalText(input.ownerUid),
      email: cleanOptionalText(input.email)?.toLowerCase(),
      phone: cleanOptionalText(input.phone),
      nationalId: cleanOptionalText(input.nationalId),
      commercialRegistration: cleanOptionalText(input.commercialRegistration),
      taxNumber: cleanOptionalText(input.taxNumber),
      businessCategories: cleanCategories(input.businessCategories),
      status: PARTNER_STATUSES.has(input.status) ? input.status : "draft",
      notes: cleanOptionalText(input.notes),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: cleanOptionalText(actorUid),
      updatedByUid: cleanOptionalText(actorUid),
    });
    const reference = await addDoc(partnerCollection("partners", salonId), payload);
    return reference.id;
  },

  async createPartnerWithOwnerMember(
    input: CreatePartnerInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const uid = cleanOptionalText(actorUid);
    const partnerRef = doc(partnerCollection("partners", salonId));
    const ownerMemberRef = doc(partnerCollection("partnerMembers", salonId));
    const timestamp = serverTimestamp();

    const partnerPayload = stripUndefined({
      displayName: requireText(input.displayName, "displayName"),
      legalName: cleanOptionalText(input.legalName),
      ownerName: requireText(input.ownerName, "ownerName"),
      ownerUid: cleanOptionalText(input.ownerUid),
      email: cleanOptionalText(input.email)?.toLowerCase(),
      phone: cleanOptionalText(input.phone),
      nationalId: cleanOptionalText(input.nationalId),
      commercialRegistration: cleanOptionalText(input.commercialRegistration),
      taxNumber: cleanOptionalText(input.taxNumber),
      businessCategories: cleanCategories(input.businessCategories),
      status: PARTNER_STATUSES.has(input.status) ? input.status : "draft",
      notes: cleanOptionalText(input.notes),
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUid: uid,
      updatedByUid: uid,
    });

    const ownerMemberPayload = stripUndefined({
      partnerId: partnerRef.id,
      memberType: "owner" as const,
      status: "active" as const,
      displayName: requireText(input.ownerName, "ownerName"),
      userUid: cleanOptionalText(input.ownerUid),
      email: cleanOptionalText(input.email)?.toLowerCase(),
      phone: cleanOptionalText(input.phone),
      canWorkAsProvider: true,
      canManageTeam: true,
      canManageInventory: true,
      canViewFinancials: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByUid: uid,
      updatedByUid: uid,
    });

    const batch = writeBatch(partnerRef.firestore);
    batch.set(partnerRef, partnerPayload);
    batch.set(ownerMemberRef, ownerMemberPayload);
    await batch.commit();
    return partnerRef.id;
  },

  async updatePartner(
    id: string,
    patch: UpdatePartnerInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    const payload = stripUndefined({
      ...(Object.prototype.hasOwnProperty.call(patch, "displayName")
        ? { displayName: requireText(patch.displayName, "displayName") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "legalName")
        ? { legalName: cleanOptionalText(patch.legalName) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "ownerName")
        ? { ownerName: requireText(patch.ownerName, "ownerName") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "ownerUid")
        ? { ownerUid: cleanOptionalText(patch.ownerUid) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "email")
        ? { email: cleanOptionalText(patch.email)?.toLowerCase() || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "phone")
        ? { phone: cleanOptionalText(patch.phone) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "nationalId")
        ? { nationalId: cleanOptionalText(patch.nationalId) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "commercialRegistration")
        ? { commercialRegistration: cleanOptionalText(patch.commercialRegistration) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "taxNumber")
        ? { taxNumber: cleanOptionalText(patch.taxNumber) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "businessCategories")
        ? { businessCategories: cleanCategories(patch.businessCategories) }
        : {}),
      ...(patch.status && PARTNER_STATUSES.has(patch.status)
        ? { status: patch.status }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "notes")
        ? { notes: cleanOptionalText(patch.notes) || null }
        : {}),
      ...buildAuditPatch(actorUid),
    });
    await setDoc(partnerDoc("partners", normalizedId, salonId), payload, { merge: true });
  },

  async listRentalResources(
    salonId: string = PARTNER_SALON_ID
  ): Promise<RentalResource[]> {
    const snapshot = await getDocs(partnerCollection("rentalResources", salonId));
    return snapshot.docs
      .map((item) => normalizeResource(item.data(), item.id, salonId))
      .sort((a, b) => a.code.localeCompare(b.code, "en"));
  },

  async createRentalResource(
    input: CreateRentalResourceInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const payload = stripUndefined({
      code: requireText(input.code, "code").toUpperCase(),
      name: requireText(input.name, "name"),
      type: RESOURCE_TYPES.has(input.type) ? input.type : "custom",
      status: RESOURCE_STATUSES.has(input.status) ? input.status : "available",
      branchId: cleanOptionalText(input.branchId),
      floor: cleanOptionalText(input.floor),
      zone: cleanOptionalText(input.zone),
      description: cleanOptionalText(input.description),
      currentPartnerId: cleanOptionalText(input.currentPartnerId),
      currentContractId: cleanOptionalText(input.currentContractId),
      equipmentNotes: cleanOptionalText(input.equipmentNotes),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: cleanOptionalText(actorUid),
      updatedByUid: cleanOptionalText(actorUid),
    });
    const reference = await addDoc(partnerCollection("rentalResources", salonId), payload);
    return reference.id;
  },

  async updateRentalResource(
    id: string,
    patch: UpdateRentalResourceInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    const payload = stripUndefined({
      ...(Object.prototype.hasOwnProperty.call(patch, "code")
        ? { code: requireText(patch.code, "code").toUpperCase() }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "name")
        ? { name: requireText(patch.name, "name") }
        : {}),
      ...(patch.type && RESOURCE_TYPES.has(patch.type) ? { type: patch.type } : {}),
      ...(patch.status && RESOURCE_STATUSES.has(patch.status)
        ? { status: patch.status }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "branchId")
        ? { branchId: cleanOptionalText(patch.branchId) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "floor")
        ? { floor: cleanOptionalText(patch.floor) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "zone")
        ? { zone: cleanOptionalText(patch.zone) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "description")
        ? { description: cleanOptionalText(patch.description) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "currentPartnerId")
        ? { currentPartnerId: cleanOptionalText(patch.currentPartnerId) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "currentContractId")
        ? { currentContractId: cleanOptionalText(patch.currentContractId) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "equipmentNotes")
        ? { equipmentNotes: cleanOptionalText(patch.equipmentNotes) || null }
        : {}),
      ...buildAuditPatch(actorUid),
    });
    await setDoc(partnerDoc("rentalResources", normalizedId, salonId), payload, {
      merge: true,
    });
  },

  async listPartnerContracts(
    salonId: string = PARTNER_SALON_ID
  ): Promise<PartnerContract[]> {
    const snapshot = await getDocs(partnerCollection("partnerContracts", salonId));
    return snapshot.docs
      .map((item) => normalizeContract(item.data(), item.id, salonId))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  },

  async createPartnerContract(
    input: CreatePartnerContractInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const payload = buildContractCreatePayload(input, actorUid);
    const contractNumber = requireText(input.contractNumber, "contractNumber");
    const partnerId = requireText(input.partnerId, "partnerId");
    const resourceIds = cleanStringList(input.resourceIds);
    const contractRef = partnerDoc(
      "partnerContracts",
      buildContractDocumentId(contractNumber),
      salonId
    );
    const partnerRef = partnerDoc("partners", partnerId, salonId);
    const resourceRefs = resourceIds.map((resourceId) =>
      partnerDoc("rentalResources", resourceId, salonId)
    );

    await runTransaction(contractRef.firestore, async (transaction) => {
      const [contractSnapshot, partnerSnapshot, ...resourceSnapshots] = await Promise.all([
        transaction.get(contractRef),
        transaction.get(partnerRef),
        ...resourceRefs.map((reference) => transaction.get(reference)),
      ]);

      if (contractSnapshot.exists()) {
        throw new Error("partner_validation:contract_number_exists");
      }
      if (!partnerSnapshot.exists()) {
        throw new Error("partner_validation:partner_not_found");
      }

      const partnerStatus = cleanText(partnerSnapshot.data().status);
      if (partnerStatus === "suspended" || partnerStatus === "ended") {
        throw new Error("partner_validation:partner_not_available");
      }
      if (input.status === "active" && partnerStatus !== "active") {
        throw new Error("partner_validation:active_contract_requires_active_partner");
      }

      resourceSnapshots.forEach((snapshot) => {
        if (!snapshot.exists()) {
          throw new Error("partner_validation:resource_not_found");
        }
        const data = snapshot.data();
        const currentContractId = cleanOptionalText(data.currentContractId);
        const currentPartnerId = cleanOptionalText(data.currentPartnerId);
        const resourceStatus = cleanText(data.status);
        if (currentContractId || currentPartnerId || resourceStatus === "rented") {
          throw new Error("partner_validation:resource_already_assigned");
        }
        if (resourceStatus === "maintenance" || resourceStatus === "inactive") {
          throw new Error("partner_validation:resource_not_available");
        }
      });

      transaction.set(contractRef, payload);
      resourceRefs.forEach((reference) => {
        transaction.set(
          reference,
          stripUndefined({
            currentPartnerId: partnerId,
            currentContractId: contractRef.id,
            status: input.status === "active" ? "rented" : "reserved",
            ...buildAuditPatch(actorUid),
          }),
          { merge: true }
        );
      });
    });

    return contractRef.id;
  },

  async updatePartnerContract(
    id: string,
    patch: UpdatePartnerContractInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    const payload = stripUndefined({
      ...(Object.prototype.hasOwnProperty.call(patch, "partnerId")
        ? { partnerId: requireText(patch.partnerId, "partnerId") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "resourceIds")
        ? { resourceIds: cleanStringList(patch.resourceIds) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "contractNumber")
        ? { contractNumber: requireText(patch.contractNumber, "contractNumber") }
        : {}),
      ...(patch.status && CONTRACT_STATUSES.has(patch.status)
        ? { status: patch.status }
        : {}),
      ...(patch.billingModel ? { billingModel: patch.billingModel } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "startDate")
        ? { startDate: requireText(patch.startDate, "startDate") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "endDate")
        ? { endDate: cleanOptionalText(patch.endDate) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "currency")
        ? { currency: cleanText(patch.currency) || "SAR" }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "fixedRentAmount")
        ? { fixedRentAmount: cleanOptionalNumber(patch.fixedRentAmount) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "hourlyRate")
        ? { hourlyRate: cleanOptionalNumber(patch.hourlyRate) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "dailyRate")
        ? { dailyRate: cleanOptionalNumber(patch.dailyRate) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "partnerSharePercent")
        ? { partnerSharePercent: cleanPercent(patch.partnerSharePercent) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "salonSharePercent")
        ? { salonSharePercent: cleanPercent(patch.salonSharePercent) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "revenueShareBasis")
        ? { revenueShareBasis: patch.revenueShareBasis || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "minimumSalonShareAmount")
        ? {
            minimumSalonShareAmount:
              cleanOptionalNumber(patch.minimumSalonShareAmount) ?? null,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "depositAmount")
        ? { depositAmount: cleanOptionalNumber(patch.depositAmount) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "paymentDueDay")
        ? { paymentDueDay: cleanOptionalNumber(patch.paymentDueDay, 1) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "timeOffMonthlyHours")
        ? { timeOffMonthlyHours: cleanOptionalNumber(patch.timeOffMonthlyHours) ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        patch,
        "timeOffMaxHoursPerRolling14Days"
      )
        ? {
            timeOffMaxHoursPerRolling14Days:
              cleanOptionalNumber(patch.timeOffMaxHoursPerRolling14Days) ?? null,
          }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "notes")
        ? { notes: cleanOptionalText(patch.notes) || null }
        : {}),
      ...buildAuditPatch(actorUid),
    });
    await setDoc(partnerDoc("partnerContracts", normalizedId, salonId), payload, {
      merge: true,
    });
  },

  async listPartnerMembers(
    salonId: string = PARTNER_SALON_ID
  ): Promise<PartnerMember[]> {
    const snapshot = await getDocs(partnerCollection("partnerMembers", salonId));
    return snapshot.docs
      .map((item) => normalizeMember(item.data(), item.id, salonId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ar"));
  },

  async createPartnerMember(
    input: CreatePartnerMemberInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const payload = stripUndefined({
      partnerId: requireText(input.partnerId, "partnerId"),
      memberType: MEMBER_TYPES.has(input.memberType) ? input.memberType : "employee",
      status: MEMBER_STATUSES.has(input.status) ? input.status : "active",
      displayName: requireText(input.displayName, "displayName"),
      userUid: cleanOptionalText(input.userUid),
      employeeId: cleanOptionalText(input.employeeId),
      email: cleanOptionalText(input.email)?.toLowerCase(),
      phone: cleanOptionalText(input.phone),
      canWorkAsProvider: input.canWorkAsProvider !== false,
      canManageTeam: input.canManageTeam === true,
      canManageInventory: input.canManageInventory === true,
      canViewFinancials: input.canViewFinancials === true,
      notes: cleanOptionalText(input.notes),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: cleanOptionalText(actorUid),
      updatedByUid: cleanOptionalText(actorUid),
    });
    const reference = await addDoc(partnerCollection("partnerMembers", salonId), payload);
    return reference.id;
  },

  async updatePartnerMember(
    id: string,
    patch: UpdatePartnerMemberInput,
    actorUid?: string,
    salonId: string = PARTNER_SALON_ID
  ) {
    const normalizedId = requireText(id, "id");
    const payload = stripUndefined({
      ...(Object.prototype.hasOwnProperty.call(patch, "partnerId")
        ? { partnerId: requireText(patch.partnerId, "partnerId") }
        : {}),
      ...(patch.memberType && MEMBER_TYPES.has(patch.memberType)
        ? { memberType: patch.memberType }
        : {}),
      ...(patch.status && MEMBER_STATUSES.has(patch.status)
        ? { status: patch.status }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "displayName")
        ? { displayName: requireText(patch.displayName, "displayName") }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "userUid")
        ? { userUid: cleanOptionalText(patch.userUid) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "employeeId")
        ? { employeeId: cleanOptionalText(patch.employeeId) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "email")
        ? { email: cleanOptionalText(patch.email)?.toLowerCase() || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "phone")
        ? { phone: cleanOptionalText(patch.phone) || null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "canWorkAsProvider")
        ? { canWorkAsProvider: patch.canWorkAsProvider !== false }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "canManageTeam")
        ? { canManageTeam: patch.canManageTeam === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "canManageInventory")
        ? { canManageInventory: patch.canManageInventory === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "canViewFinancials")
        ? { canViewFinancials: patch.canViewFinancials === true }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "notes")
        ? { notes: cleanOptionalText(patch.notes) || null }
        : {}),
      ...buildAuditPatch(actorUid),
    });
    await setDoc(partnerDoc("partnerMembers", normalizedId, salonId), payload, {
      merge: true,
    });
  },
};
