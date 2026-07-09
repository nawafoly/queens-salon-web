export type PartnerStatus = "draft" | "active" | "suspended" | "ended";

export type PartnerBusinessCategory =
  | "hair"
  | "makeup"
  | "nails"
  | "pedicure"
  | "lashes"
  | "skin"
  | "massage"
  | "retail"
  | "other";

export type RentalResourceType =
  | "hair_station"
  | "makeup_station"
  | "manicure_station"
  | "pedicure_station"
  | "lash_bed"
  | "private_room"
  | "retail_space"
  | "custom";

export type RentalResourceStatus =
  | "available"
  | "reserved"
  | "rented"
  | "maintenance"
  | "inactive";

export type PartnerContractStatus =
  | "draft"
  | "active"
  | "expired"
  | "terminated"
  | "cancelled";

export type PartnerBillingModel =
  | "fixed_rent"
  | "revenue_share"
  | "hybrid"
  | "hourly"
  | "daily";

export type RevenueShareBasis =
  | "gross_before_tax"
  | "net_after_discount"
  | "collected_amount"
  | "net_excluding_tax";

export type PartnerMemberType = "owner" | "employee" | "contractor";

export type PartnerMemberStatus = "active" | "inactive" | "suspended";

export type PartnerAuditFields = {
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid?: string;
  updatedByUid?: string;
};

export type Partner = PartnerAuditFields & {
  id: string;
  salonId: string;
  displayName: string;
  legalName?: string;
  ownerName: string;
  ownerUid?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  commercialRegistration?: string;
  taxNumber?: string;
  businessCategories: PartnerBusinessCategory[];
  status: PartnerStatus;
  notes?: string;
};

export type RentalResource = PartnerAuditFields & {
  id: string;
  salonId: string;
  code: string;
  name: string;
  type: RentalResourceType;
  status: RentalResourceStatus;
  branchId?: string;
  floor?: string;
  zone?: string;
  description?: string;
  currentPartnerId?: string;
  currentContractId?: string;
  equipmentNotes?: string;
};

export type PartnerContract = PartnerAuditFields & {
  id: string;
  salonId: string;
  partnerId: string;
  resourceIds: string[];
  contractNumber: string;
  status: PartnerContractStatus;
  billingModel: PartnerBillingModel;
  startDate: string;
  endDate?: string;
  currency: string;
  fixedRentAmount?: number;
  hourlyRate?: number;
  dailyRate?: number;
  partnerSharePercent?: number;
  salonSharePercent?: number;
  revenueShareBasis?: RevenueShareBasis;
  minimumSalonShareAmount?: number;
  depositAmount?: number;
  paymentDueDay?: number;
  timeOffMonthlyHours?: number;
  timeOffMaxHoursPerRolling14Days?: number;
  notes?: string;
};

export type PartnerMember = PartnerAuditFields & {
  id: string;
  salonId: string;
  partnerId: string;
  memberType: PartnerMemberType;
  status: PartnerMemberStatus;
  displayName: string;
  userUid?: string;
  employeeId?: string;
  email?: string;
  phone?: string;
  canWorkAsProvider: boolean;
  canManageTeam: boolean;
  canManageInventory: boolean;
  canViewFinancials: boolean;
  notes?: string;
};

export type CreatePartnerInput = Omit<
  Partner,
  "id" | "salonId" | keyof PartnerAuditFields
>;

export type UpdatePartnerInput = Partial<CreatePartnerInput>;

export type CreateRentalResourceInput = Omit<
  RentalResource,
  "id" | "salonId" | keyof PartnerAuditFields
>;

export type UpdateRentalResourceInput = Partial<CreateRentalResourceInput>;

export type CreatePartnerContractInput = Omit<
  PartnerContract,
  "id" | "salonId" | keyof PartnerAuditFields
>;

export type UpdatePartnerContractInput = Partial<CreatePartnerContractInput>;

export type CreatePartnerMemberInput = Omit<
  PartnerMember,
  "id" | "salonId" | keyof PartnerAuditFields
>;

export type UpdatePartnerMemberInput = Partial<CreatePartnerMemberInput>;

export type PartnerPortalMember = Omit<
  PartnerMember,
  "userUid" | "createdByUid" | "updatedByUid"
> & {
  hasLogin: boolean;
};

export type PartnerPortalPermissions = {
  canManageTeam: boolean;
  canManageInventory: boolean;
  canViewFinancials: boolean;
  canWorkAsProvider: boolean;
};

export type PartnerPortalSession =
  | {
      kind: "admin";
      identity: { uid: string; email?: string; name?: string };
    }
  | {
      kind: "partner";
      identity: { uid: string; email?: string; name?: string };
      partner: Partner;
      member: PartnerPortalMember;
    };

export type PartnerPortalOverview = {
  partner: Partner;
  member: PartnerPortalMember;
  contracts: PartnerContract[];
  resources: RentalResource[];
  team: PartnerPortalMember[];
  permissions: PartnerPortalPermissions;
};
