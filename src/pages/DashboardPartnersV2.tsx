import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faBriefcase,
  faBuilding,
  faCalendarDays,
  faChair,
  faCircleCheck,
  faCircleExclamation,
  faClock,
  faFileContract,
  faEnvelope,
  faKey,
  faLink,
  faMagnifyingGlass,
  faMoneyBillTransfer,
  faPercent,
  faPhone,
  faPlus,
  faStore,
  faUserPlus,
  faUserShield,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { auth } from "../services/firebase";
import { PartnerService } from "../services/partnerService";
import { PartnerAccountService } from "../services/partnerAccountService";
import { listEmployeeDirectory } from "../services/employeeDirectory";
import type { EmployeeDirectoryEntry } from "../services/employeeHub";
import type {
  Partner,
  PartnerBillingModel,
  PartnerBusinessCategory,
  PartnerContract,
  PartnerContractStatus,
  PartnerMember,
  PartnerStatus,
  RentalResource,
  RentalResourceStatus,
  RentalResourceType,
  RevenueShareBasis,
} from "../types/partner";
import "../styles/dashboard-v2/dashboard-v2.css";

type ActiveTab = "partners" | "resources" | "team" | "contracts";
type CreateModal =
  | "partner"
  | "resource"
  | "member"
  | "account"
  | "employeeLink"
  | "employeeImport"
  | "contract"
  | null;

type PartnerFormState = {
  displayName: string;
  ownerName: string;
  phone: string;
  email: string;
  category: PartnerBusinessCategory;
  status: PartnerStatus;
  notes: string;
};

type ResourceFormState = {
  code: string;
  name: string;
  type: RentalResourceType;
  status: RentalResourceStatus;
  zone: string;
  floor: string;
  description: string;
  equipmentNotes: string;
};

type MemberFormState = {
  partnerId: string;
  displayName: string;
  email: string;
  phone: string;
  memberType: "employee" | "contractor";
  createLogin: boolean;
  password: string;
  canWorkAsProvider: boolean;
  canManageTeam: boolean;
  canManageInventory: boolean;
  canViewFinancials: boolean;
};

type AccountFormState = {
  email: string;
  password: string;
};

type ContractFormState = {
  partnerId: string;
  resourceIds: string[];
  contractNumber: string;
  status: "draft" | "active";
  billingModel: PartnerBillingModel;
  startDate: string;
  endDate: string;
  fixedRentAmount: string;
  hourlyRate: string;
  dailyRate: string;
  partnerSharePercent: string;
  salonSharePercent: string;
  revenueShareBasis: RevenueShareBasis;
  minimumSalonShareAmount: string;
  depositAmount: string;
  paymentDueDay: string;
  timeOffMonthlyHours: string;
  timeOffMaxHoursPerRolling14Days: string;
  notes: string;
};

const PARTNER_CATEGORY_LABELS: Record<PartnerBusinessCategory, string> = {
  hair: "الشعر والاستشوار",
  makeup: "المكياج",
  nails: "المناكير",
  pedicure: "البديكير",
  lashes: "الرموش",
  skin: "البشرة",
  massage: "المساج",
  retail: "بيع المنتجات",
  other: "نشاط آخر",
};

const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  draft: "مسودة",
  active: "نشطة",
  suspended: "موقوفة",
  ended: "منتهية",
};

const RESOURCE_TYPE_LABELS: Record<RentalResourceType, string> = {
  hair_station: "مقعد شعر واستشوار",
  makeup_station: "محطة مكياج",
  manicure_station: "طاولة مناكير",
  pedicure_station: "كرسي بديكير",
  lash_bed: "سرير رموش",
  private_room: "غرفة خاصة",
  retail_space: "مساحة بيع منتجات",
  custom: "مساحة مخصصة",
};

const RESOURCE_STATUS_LABELS: Record<RentalResourceStatus, string> = {
  available: "متاحة",
  reserved: "محجوزة",
  rented: "مؤجرة",
  maintenance: "صيانة",
  inactive: "غير نشطة",
};

const CONTRACT_STATUS_LABELS: Record<PartnerContractStatus, string> = {
  draft: "مسودة",
  active: "نشط",
  expired: "منتهي",
  terminated: "مُنهي",
  cancelled: "ملغي",
};

const BILLING_MODEL_LABELS: Record<PartnerBillingModel, string> = {
  fixed_rent: "إيجار شهري ثابت",
  revenue_share: "نسبة من الإيرادات",
  hybrid: "إيجار ثابت + نسبة",
  hourly: "إيجار بالساعة",
  daily: "إيجار يومي",
};

const REVENUE_BASIS_LABELS: Record<RevenueShareBasis, string> = {
  gross_before_tax: "إجمالي الخدمة قبل الضريبة",
  net_after_discount: "الصافي بعد الخصم",
  collected_amount: "المبلغ المحصل فعليًا",
  net_excluding_tax: "الصافي بدون الضريبة",
};

const EMPTY_PARTNER_FORM: PartnerFormState = {
  displayName: "",
  ownerName: "",
  phone: "",
  email: "",
  category: "hair",
  status: "active",
  notes: "",
};

const EMPTY_MEMBER_FORM: MemberFormState = {
  partnerId: "",
  displayName: "",
  email: "",
  phone: "",
  memberType: "employee",
  createLogin: true,
  password: "",
  canWorkAsProvider: true,
  canManageTeam: false,
  canManageInventory: false,
  canViewFinancials: false,
};

const EMPTY_ACCOUNT_FORM: AccountFormState = {
  email: "",
  password: "",
};

const EMPTY_RESOURCE_FORM: ResourceFormState = {
  code: "",
  name: "",
  type: "hair_station",
  status: "available",
  zone: "",
  floor: "",
  description: "",
  equipmentNotes: "",
};

const partnerCategoryOptions = Object.entries(PARTNER_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const partnerStatusOptions = [
  { value: "active", label: "نشطة" },
  { value: "draft", label: "مسودة" },
  { value: "suspended", label: "موقوفة" },
] as const;
const resourceTypeOptions = Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const resourceStatusOptions = [
  { value: "available", label: "متاحة" },
  { value: "reserved", label: "محجوزة" },
  { value: "maintenance", label: "صيانة" },
  { value: "inactive", label: "غير نشطة" },
] as const;
const memberTypeOptions = [
  { value: "employee", label: "موظفة" },
  { value: "contractor", label: "متعاقدة" },
] as const;
const contractStatusOptions = [
  { value: "active", label: "نشط — المساحات تصبح مؤجرة" },
  { value: "draft", label: "مسودة — المساحات تصبح محجوزة" },
] as const;
const billingModelOptions = Object.entries(BILLING_MODEL_LABELS).map(([value, label]) => ({ value, label }));
const revenueBasisOptions = Object.entries(REVENUE_BASIS_LABELS).map(([value, label]) => ({ value, label }));

function localIsoDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function createEmptyContractForm(contractNumber = ""): ContractFormState {
  return {
    partnerId: "",
    resourceIds: [],
    contractNumber,
    status: "active",
    billingModel: "revenue_share",
    startDate: localIsoDate(),
    endDate: "",
    fixedRentAmount: "",
    hourlyRate: "",
    dailyRate: "",
    partnerSharePercent: "40",
    salonSharePercent: "60",
    revenueShareBasis: "net_after_discount",
    minimumSalonShareAmount: "",
    depositAmount: "",
    paymentDueDay: "1",
    timeOffMonthlyHours: "32",
    timeOffMaxHoursPerRolling14Days: "16",
    notes: "",
  };
}

function normalizeSearch(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function optionalNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatMoney(value: number | undefined, currency = "SAR") {
  if (value === undefined) return "—";
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatContractDate(value?: string) {
  if (!value) return "مفتوح";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function suggestContractNumber(contracts: PartnerContract[]) {
  const year = new Date().getFullYear();
  const used = new Set(contracts.map((contract) => contract.contractNumber.toUpperCase()));
  let sequence = 1;
  while (used.has(`MKT-P-${year}-${String(sequence).padStart(3, "0")}`)) {
    sequence += 1;
  }
  return `MKT-P-${year}-${String(sequence).padStart(3, "0")}`;
}

function translatePartnerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("partner_api:not_configured")) {
    return "رابط Cloudflare Worker غير مضبوط في VITE_PARTNERS_WORKER_URL.";
  }
  if (message.includes("partner_api:d1_not_configured")) {
    return "قاعدة D1 غير مربوطة بالـWorker. أنشئ القاعدة وحدّث ملف Wrangler.";
  }
  if (message.includes("partner_api:migrations_not_applied")) {
    return "جداول نظام الشريكات غير منشأة في D1. طبّق migrations أولًا.";
  }
  if (message.includes("partner_auth:login_required")) {
    return "انتهت جلسة الدخول. سجّل الدخول من جديد.";
  }
  if (message.includes("partner_auth:admin_access_required")) {
    return "الحساب الحالي غير مصرح له بإدارة نظام الشريكات.";
  }
  if (message.includes("partner_auth:")) {
    return "تعذر التحقق من جلسة الدخول لدى Cloudflare. حدّث الصفحة وحاول مجددًا.";
  }
  if (message.includes("Failed to fetch")) {
    return "تعذر الاتصال بخدمة الشريكات في Cloudflare. تأكد أن Wrangler يعمل على المنفذ 8787.";
  }
  if (message.includes("displayName_required")) return "اسم النشاط مطلوب.";
  if (message.includes("ownerName_required")) return "اسم مالكة النشاط مطلوب.";
  if (message.includes("code_required")) return "رمز المساحة مطلوب.";
  if (message.includes("name_required")) return "اسم المساحة مطلوب.";
  if (message.includes("partnerId_required")) return "اختر الشريكة المرتبطة بالعقد.";
  if (message.includes("contractNumber_required")) return "رقم العقد مطلوب.";
  if (message.includes("startDate_required")) return "تاريخ بداية العقد مطلوب.";
  if (message.includes("resource_required")) return "اختر مساحة واحدة على الأقل للعقد.";
  if (message.includes("create_contract_status_invalid")) return "حالة إنشاء العقد يجب أن تكون مسودة أو نشطة.";
  if (message.includes("contract_number_exists")) return "رقم العقد مستخدم مسبقًا. غيّر رقم العقد.";
  if (message.includes("partner_not_found")) return "تعذر العثور على الشريكة المحددة.";
  if (message.includes("partner_not_available")) return "الشريكة موقوفة أو منتهية ولا يمكن إنشاء عقد لها.";
  if (message.includes("active_contract_requires_active_partner")) {
    return "العقد النشط يتطلب أن تكون حالة الشريكة نشطة.";
  }
  if (message.includes("resource_not_found")) return "إحدى المساحات المحددة لم تعد موجودة.";
  if (message.includes("resource_already_assigned") || message.includes("resource_not_available_or_assigned")) {
    return "إحدى المساحات مرتبطة بعقد آخر أو لم تعد متاحة. حدّث الصفحة واختر مساحة متاحة.";
  }
  if (message.includes("resource_not_available")) {
    return "لا يمكن ربط مساحة تحت الصيانة أو غير نشطة بالعقد.";
  }
  if (message.includes("end_date_before_start_date")) {
    return "تاريخ نهاية العقد لا يمكن أن يسبق تاريخ البداية.";
  }
  if (message.includes("payment_due_day_invalid")) {
    return "يوم الاستحقاق يجب أن يكون من 1 إلى 28.";
  }
  if (message.includes("rolling_time_off_exceeds_monthly")) {
    return "حد ساعات الأوف خلال 14 يومًا لا يمكن أن يتجاوز الرصيد الشهري.";
  }
  if (message.includes("revenue_shares_required")) return "أدخل نسبة الشريكة ونسبة الصالون.";
  if (message.includes("revenue_shares_must_equal_100")) {
    return "مجموع نسبة الشريكة ونسبة الصالون يجب أن يساوي 100%.";
  }
  if (message.includes("revenue_share_basis_required")) return "حدد أساس احتساب النسبة.";
  if (message.includes("fixed_rent_required")) return "أدخل قيمة الإيجار الثابت.";
  if (message.includes("hourly_rate_required")) return "أدخل قيمة الإيجار بالساعة.";
  if (message.includes("daily_rate_required")) return "أدخل قيمة الإيجار اليومي.";
  if (message.includes("partner_account:email_invalid")) return "أدخل بريدًا إلكترونيًا صحيحًا للحساب.";
  if (message.includes("partner_account:password_too_short")) return "كلمة المرور المؤقتة يجب ألا تقل عن 8 أحرف.";
  if (message.includes("auth/email-already-in-use")) return "البريد الإلكتروني مستخدم في حساب آخر.";
  if (message.includes("account_already_linked")) return "هذا الحساب مرتبط بعضوة أخرى بالفعل.";
  if (message.includes("member_account_exists")) return "يوجد حساب دخول مرتبط بهذه العضوة بالفعل.";
  if (message.includes("email_required")) return "البريد الإلكتروني مطلوب لإنشاء الحساب.";
  if (message.includes("member_not_found")) return "تعذر العثور على عضوة الفريق المحددة.";

  return message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

function contractFinancialSummary(contract: PartnerContract) {
  if (contract.billingModel === "fixed_rent") {
    return formatMoney(contract.fixedRentAmount, contract.currency);
  }
  if (contract.billingModel === "hourly") {
    return `${formatMoney(contract.hourlyRate, contract.currency)} / ساعة`;
  }
  if (contract.billingModel === "daily") {
    return `${formatMoney(contract.dailyRate, contract.currency)} / يوم`;
  }
  const shares = `${contract.partnerSharePercent ?? 0}% للشريكة · ${contract.salonSharePercent ?? 0}% لملكات`;
  if (contract.billingModel === "hybrid") {
    return `${formatMoney(contract.fixedRentAmount, contract.currency)} + ${shares}`;
  }
  return shares;
}

function partnerBadgeClass(status: PartnerStatus) {
  if (status === "active") return "dsv2-badge--success";
  if (status === "draft") return "dsv2-badge--gold";
  if (status === "suspended") return "dsv2-badge--danger";
  return "";
}

function resourceBadgeClass(status: RentalResourceStatus) {
  if (status === "available") return "dsv2-badge--success";
  if (status === "reserved") return "dsv2-badge--gold";
  if (status === "maintenance") return "dsv2-badge--danger";
  if (status === "rented") return "dsv2-badge--gold";
  return "";
}

function contractBadgeClass(status: PartnerContractStatus) {
  if (status === "active") return "dsv2-badge--success";
  if (status === "draft") return "dsv2-badge--gold";
  if (status === "terminated" || status === "cancelled") return "dsv2-badge--danger";
  return "";
}

export default function DashboardPartnersV2() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [resources, setResources] = useState<RentalResource[]>([]);
  const [contracts, setContracts] = useState<PartnerContract[]>([]);
  const [members, setMembers] = useState<PartnerMember[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("partners");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [createModal, setCreateModal] = useState<CreateModal>(null);
  const [partnerForm, setPartnerForm] = useState<PartnerFormState>(EMPTY_PARTNER_FORM);
  const [resourceForm, setResourceForm] = useState<ResourceFormState>(EMPTY_RESOURCE_FORM);
  const [contractForm, setContractForm] = useState<ContractFormState>(() => createEmptyContractForm());
  const [memberForm, setMemberForm] = useState<MemberFormState>(EMPTY_MEMBER_FORM);
  const [employeeDirectory, setEmployeeDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [selectedExistingEmployeeId, setSelectedExistingEmployeeId] = useState("");
  const [importPartnerId, setImportPartnerId] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [accountForm, setAccountForm] = useState<AccountFormState>(EMPTY_ACCOUNT_FORM);
  const [selectedMember, setSelectedMember] = useState<PartnerMember | null>(null);

  const loadData = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError("");

    try {
      const [partnerRows, resourceRows, contractRows, memberRows] = await Promise.all([
        PartnerService.listPartners(),
        PartnerService.listRentalResources(),
        PartnerService.listPartnerContracts(),
        PartnerService.listPartnerMembers(),
      ]);

      setPartners(partnerRows);
      setResources(resourceRows);
      setContracts(contractRows);
      setMembers(memberRows);
    } catch (loadError) {
      console.error("DashboardPartners.loadData error:", loadError);
      setError(translatePartnerError(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData("initial");
  }, [loadData]);

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const activePartners = useMemo(
    () => partners.filter((partner) => partner.status === "active").length,
    [partners]
  );

  const availableResources = useMemo(
    () => resources.filter((resource) => resource.status === "available").length,
    [resources]
  );

  const rentedResources = useMemo(
    () => resources.filter((resource) => resource.status === "rented").length,
    [resources]
  );

  const activeContracts = useMemo(
    () => contracts.filter((contract) => contract.status === "active").length,
    [contracts]
  );

  const eligibleResources = useMemo(
    () =>
      resources.filter(
        (resource) =>
          !resource.currentContractId &&
          !resource.currentPartnerId &&
          (resource.status === "available" || resource.status === "reserved")
      ),
    [resources]
  );

  const eligiblePartners = useMemo(
    () => partners.filter((partner) => partner.status === "active" || partner.status === "draft"),
    [partners]
  );

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    partners.forEach((partner) => map.set(partner.id, partner.displayName));
    return map;
  }, [partners]);

  const resourceById = useMemo(() => {
    const map = new Map<string, RentalResource>();
    resources.forEach((resource) => map.set(resource.id, resource));
    return map;
  }, [resources]);

  const memberCountByPartner = useMemo(() => {
    const map = new Map<string, number>();
    members.forEach((member) => {
      if (member.status !== "active") return;
      map.set(member.partnerId, (map.get(member.partnerId) || 0) + 1);
    });
    return map;
  }, [members]);

  const resourceCountByPartner = useMemo(() => {
    const map = new Map<string, number>();
    resources.forEach((resource) => {
      if (!resource.currentPartnerId) return;
      map.set(resource.currentPartnerId, (map.get(resource.currentPartnerId) || 0) + 1);
    });
    return map;
  }, [resources]);

  const activeContractByPartner = useMemo(() => {
    const map = new Map<string, PartnerContract>();
    contracts.forEach((contract) => {
      if (contract.status === "active" && !map.has(contract.partnerId)) {
        map.set(contract.partnerId, contract);
      }
    });
    return map;
  }, [contracts]);

  const filteredPartners = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return partners;

    return partners.filter((partner) =>
      normalizeSearch(
        `${partner.displayName} ${partner.ownerName} ${partner.phone || ""} ${partner.email || ""}`
      ).includes(query)
    );
  }, [partners, search]);

  const filteredResources = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return resources;

    return resources.filter((resource) =>
      normalizeSearch(
        `${resource.code} ${resource.name} ${resource.zone || ""} ${resource.floor || ""} ${
          resource.currentPartnerId ? partnerNameById.get(resource.currentPartnerId) || "" : ""
        }`
      ).includes(query)
    );
  }, [partnerNameById, resources, search]);

  const filteredContracts = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return contracts;

    return contracts.filter((contract) => {
      const resourceNames = contract.resourceIds
        .map((resourceId) => {
          const resource = resourceById.get(resourceId);
          return resource ? `${resource.code} ${resource.name}` : resourceId;
        })
        .join(" ");
      return normalizeSearch(
        `${contract.contractNumber} ${partnerNameById.get(contract.partnerId) || ""} ${
          BILLING_MODEL_LABELS[contract.billingModel]
        } ${resourceNames}`
      ).includes(query);
    });
  }, [contracts, partnerNameById, resourceById, search]);

  const filteredMembers = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return members;
    return members.filter((member) =>
      normalizeSearch(
        `${member.displayName} ${member.email || ""} ${member.phone || ""} ${
          partnerNameById.get(member.partnerId) || ""
        }`
      ).includes(query)
    );
  }, [members, partnerNameById, search]);

  const openCreateModal = (modal: Exclude<CreateModal, null>) => {
    setError("");
    setSuccessMessage("");
    if (modal === "partner") setPartnerForm(EMPTY_PARTNER_FORM);
    if (modal === "resource") setResourceForm(EMPTY_RESOURCE_FORM);
    if (modal === "member") {
      setSelectedMember(null);
      setMemberForm({
        ...EMPTY_MEMBER_FORM,
        partnerId: eligiblePartners[0]?.id || "",
      });
    }
    if (modal === "account") setAccountForm(EMPTY_ACCOUNT_FORM);
    if (modal === "contract") {
      setContractForm(createEmptyContractForm(suggestContractNumber(contracts)));
    }
    setCreateModal(modal);
  };

  const closeCreateModal = () => {
    if (saving) return;
    setCreateModal(null);
    setSelectedMember(null);
  };

  const handleCreatePartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    try {
      await PartnerService.createPartnerWithOwnerMember(
        {
          displayName: partnerForm.displayName,
          ownerName: partnerForm.ownerName,
          phone: partnerForm.phone || undefined,
          email: partnerForm.email || undefined,
          businessCategories: [partnerForm.category],
          status: partnerForm.status,
          notes: partnerForm.notes || undefined,
        },
        auth.currentUser?.uid
      );

      setCreateModal(null);
      setSuccessMessage(
        `تم إنشاء الشريكة «${partnerForm.displayName.trim()}» وإضافة المالكة إلى فريقها.`
      );
      await loadData("refresh");
    } catch (saveError) {
      console.error("DashboardPartners.createPartner error:", saveError);
      setError(translatePartnerError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    try {
      await PartnerService.createRentalResource(
        {
          code: resourceForm.code,
          name: resourceForm.name,
          type: resourceForm.type,
          status: resourceForm.status,
          zone: resourceForm.zone || undefined,
          floor: resourceForm.floor || undefined,
          description: resourceForm.description || undefined,
          equipmentNotes: resourceForm.equipmentNotes || undefined,
        },
        auth.currentUser?.uid
      );

      setCreateModal(null);
      setSuccessMessage(`تم إنشاء المساحة «${resourceForm.name.trim()}» بنجاح.`);
      await loadData("refresh");
    } catch (saveError) {
      console.error("DashboardPartners.createResource error:", saveError);
      setError(translatePartnerError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateContract = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    try {
      const usesShare =
        contractForm.billingModel === "revenue_share" || contractForm.billingModel === "hybrid";
      await PartnerService.createPartnerContract(
        {
          partnerId: contractForm.partnerId,
          resourceIds: contractForm.resourceIds,
          contractNumber: contractForm.contractNumber,
          status: contractForm.status,
          billingModel: contractForm.billingModel,
          startDate: contractForm.startDate,
          endDate: contractForm.endDate || undefined,
          currency: "SAR",
          fixedRentAmount:
            contractForm.billingModel === "fixed_rent" || contractForm.billingModel === "hybrid"
              ? optionalNumber(contractForm.fixedRentAmount)
              : undefined,
          hourlyRate:
            contractForm.billingModel === "hourly"
              ? optionalNumber(contractForm.hourlyRate)
              : undefined,
          dailyRate:
            contractForm.billingModel === "daily"
              ? optionalNumber(contractForm.dailyRate)
              : undefined,
          partnerSharePercent: usesShare
            ? optionalNumber(contractForm.partnerSharePercent)
            : undefined,
          salonSharePercent: usesShare
            ? optionalNumber(contractForm.salonSharePercent)
            : undefined,
          revenueShareBasis: usesShare ? contractForm.revenueShareBasis : undefined,
          minimumSalonShareAmount: usesShare
            ? optionalNumber(contractForm.minimumSalonShareAmount)
            : undefined,
          depositAmount: optionalNumber(contractForm.depositAmount),
          paymentDueDay: optionalNumber(contractForm.paymentDueDay),
          timeOffMonthlyHours: optionalNumber(contractForm.timeOffMonthlyHours),
          timeOffMaxHoursPerRolling14Days: optionalNumber(
            contractForm.timeOffMaxHoursPerRolling14Days
          ),
          notes: contractForm.notes || undefined,
        },
        auth.currentUser?.uid
      );

      const partnerName = partnerNameById.get(contractForm.partnerId) || "الشريكة";
      setCreateModal(null);
      setActiveTab("contracts");
      setSearch("");
      setSuccessMessage(
        `تم إنشاء العقد «${contractForm.contractNumber.trim()}» وربط ${contractForm.resourceIds.length} مساحة مع ${partnerName}.`
      );
      await loadData("refresh");
    } catch (saveError) {
      console.error("DashboardPartners.createContract error:", saveError);
      setError(translatePartnerError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    try {
      const memberInput = {
        partnerId: memberForm.partnerId,
        memberType: memberForm.memberType,
        status: "active" as const,
        displayName: memberForm.displayName,
        email: memberForm.email || undefined,
        phone: memberForm.phone || undefined,
        canWorkAsProvider: memberForm.canWorkAsProvider,
        canManageTeam: memberForm.canManageTeam,
        canManageInventory: memberForm.canManageInventory,
        canViewFinancials: memberForm.canViewFinancials,
      };
      const memberContract =
        contracts.find((contract) => contract.partnerId === memberForm.partnerId && contract.status === "active") ||
        contracts.find((contract) => contract.partnerId === memberForm.partnerId);
      const employeeContext = {
        partnerName: partnerNameById.get(memberForm.partnerId),
        contractId: memberContract?.id,
        resourceIds: memberContract?.resourceIds || [],
      };

      if (memberForm.createLogin) {
        await PartnerAccountService.createMemberWithAccount(memberInput, memberForm.password, employeeContext);
      } else {
        await PartnerAccountService.createOperationalMemberWithoutAccount(memberInput, employeeContext);
      }

      setCreateModal(null);
      setActiveTab("team");
      setSuccessMessage(
        memberForm.createLogin
          ? `تمت إضافة «${memberForm.displayName.trim()}» وإنشاء حساب دخول لها.`
          : `تمت إضافة «${memberForm.displayName.trim()}» إلى فريق الشريكة.`
      );
      await loadData("refresh");
    } catch (saveError) {
      console.error("DashboardPartners.createMember error:", saveError);
      setError(translatePartnerError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const openAccountModal = (member: PartnerMember) => {
    setError("");
    setSuccessMessage("");
    setSelectedMember(member);
    setAccountForm({
      email: member.email || "",
      password: "",
    });
    setCreateModal("account");
  };

  const openExistingEmployeeModal = async (member: PartnerMember) => {
    setError("");
    setSuccessMessage("");
    setSelectedMember(member);
    setSelectedExistingEmployeeId("");
    setCreateModal("employeeLink");
    setDirectoryLoading(true);
    try {
      const rows = await listEmployeeDirectory();
      setEmployeeDirectory(
        rows.filter((row) => row.active !== false && row.employmentSource !== "partner")
      );
    } catch (directoryError) {
      console.error("DashboardPartners.loadEmployeeDirectory error:", directoryError);
      setError("تعذر تحميل قائمة الموظفين الحاليين.");
    } finally {
      setDirectoryLoading(false);
    }
  };

  const openEmployeeImportModal = async () => {
    setError("");
    setSuccessMessage("");
    setSelectedMember(null);
    setSelectedExistingEmployeeId("");
    setImportPartnerId(eligiblePartners[0]?.id || "");
    setCreateModal("employeeImport");
    setDirectoryLoading(true);
    try {
      const rows = await listEmployeeDirectory();
      setEmployeeDirectory(rows.filter((row) => row.active !== false && row.employmentSource !== "partner"));
    } catch (directoryError) {
      console.error("DashboardPartners.loadEmployeeDirectory error:", directoryError);
      setError("تعذر تحميل قائمة الموظفين الحاليين.");
    } finally {
      setDirectoryLoading(false);
    }
  };

  const handleImportExistingEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !importPartnerId || !selectedExistingEmployeeId) return;
    const employee = employeeDirectory.find((row) => row.employeeId === selectedExistingEmployeeId);
    if (!employee) return;
    setSaving(true);
    setError("");
    try {
      const memberContract =
        contracts.find((contract) => contract.partnerId === importPartnerId && contract.status === "active") ||
        contracts.find((contract) => contract.partnerId === importPartnerId);
      await PartnerAccountService.createMemberFromExistingEmployee({
        partnerId: importPartnerId,
        employee: {
          ...employee,
          employeeUid: employee.linkedUid || employee.employeeUid,
        },
        partnerName: partnerNameById.get(importPartnerId),
        contractId: memberContract?.id,
        resourceIds: memberContract?.resourceIds || [],
      });
      setCreateModal(null);
      setActiveTab("team");
      setSuccessMessage(`تم ربط الموظف «${employee.name}» بفريق «${partnerNameById.get(importPartnerId) || "الشريكة"}».`);
      await loadData("refresh");
    } catch (importError) {
      console.error("DashboardPartners.importExistingEmployee error:", importError);
      setError(translatePartnerError(importError));
    } finally {
      setSaving(false);
    }
  };

  const handleLinkExistingEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !selectedMember || !selectedExistingEmployeeId) return;
    const employee = employeeDirectory.find((row) => row.employeeId === selectedExistingEmployeeId);
    if (!employee) return;

    setSaving(true);
    setError("");
    try {
      const memberContract =
        contracts.find((contract) => contract.partnerId === selectedMember.partnerId && contract.status === "active") ||
        contracts.find((contract) => contract.partnerId === selectedMember.partnerId);
      await PartnerAccountService.linkMemberToExistingEmployee({
        memberId: selectedMember.id,
        partnerId: selectedMember.partnerId,
        employeeId: employee.employeeId,
        employeeUid: employee.linkedUid || employee.employeeUid,
        employeeEmail: employee.email,
        partnerName: partnerNameById.get(selectedMember.partnerId),
        contractId: memberContract?.id,
        resourceIds: memberContract?.resourceIds || [],
      });
      setCreateModal(null);
      setSelectedMember(null);
      setSuccessMessage(`تم ربط «${selectedMember.displayName}» بملف الموظف «${employee.name}» دون إنشاء سجل مكرر.`);
      await loadData("refresh");
    } catch (linkError) {
      console.error("DashboardPartners.linkExistingEmployee error:", linkError);
      setError(translatePartnerError(linkError));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMemberAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !selectedMember) return;

    setSaving(true);
    setError("");
    try {
      await PartnerAccountService.linkExistingMemberAccount({
        memberId: selectedMember.id,
        partnerId: selectedMember.partnerId,
        memberType: selectedMember.memberType,
        displayName: selectedMember.displayName,
        email: accountForm.email,
        phone: selectedMember.phone,
        password: accountForm.password,
        partnerName: partnerNameById.get(selectedMember.partnerId),
        contractId: contracts.find((contract) => contract.partnerId === selectedMember.partnerId && contract.status === "active")?.id,
        resourceIds: contracts.find((contract) => contract.partnerId === selectedMember.partnerId && contract.status === "active")?.resourceIds || [],
      });
      setCreateModal(null);
      setSelectedMember(null);
      setSuccessMessage(`تم إنشاء حساب دخول لـ «${selectedMember.displayName}».`);
      await loadData("refresh");
    } catch (saveError) {
      console.error("DashboardPartners.createMemberAccount error:", saveError);
      setError(translatePartnerError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncMemberToHr = async (member: PartnerMember) => {
    if (saving || member.memberType === "owner") return;
    setSaving(true);
    setError("");
    try {
      const memberContract =
        contracts.find((contract) => contract.partnerId === member.partnerId && contract.status === "active") ||
        contracts.find((contract) => contract.partnerId === member.partnerId);
      await PartnerAccountService.syncExistingOperationalMember(member, {
        partnerName: partnerNameById.get(member.partnerId),
        contractId: memberContract?.id,
        resourceIds: memberContract?.resourceIds || [],
      });
      setSuccessMessage(`تم ربط «${member.displayName.trim()}» بإدارة الموظفين وHR.`);
      await loadData("refresh");
    } catch (syncError) {
      console.error("DashboardPartners.syncMemberToHr error:", syncError);
      setError(translatePartnerError(syncError));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAllMemberProfiles = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const directory = await listEmployeeDirectory();
      const directoryById = new Map(
        directory.map((employee) => [String(employee.employeeId || "").trim(), employee])
      );

      let syncedCount = 0;
      let missingCount = 0;

      for (const member of members) {
        if (member.memberType === "owner" || !member.employeeId) continue;

        const employee = directoryById.get(String(member.employeeId || "").trim()) || null;
        if (!employee) {
          missingCount += 1;
          continue;
        }

        const memberContract =
          contracts.find(
            (contract) =>
              contract.partnerId === member.partnerId && contract.status === "active"
          ) || contracts.find((contract) => contract.partnerId === member.partnerId);

        const result = await PartnerAccountService.syncMemberOperationalProfile(member, {
          employee,
          partnerName: partnerNameById.get(member.partnerId),
          contractId: memberContract?.id,
          resourceIds: memberContract?.resourceIds || [],
        });

        if (result.synced) syncedCount += 1;
      }

      setSuccessMessage(
        missingCount > 0
          ? `تمت مزامنة ${syncedCount} ملف موظفة. تعذر العثور على ${missingCount} ملف مرتبط.`
          : `تمت مزامنة ${syncedCount} ملف موظفة مع بوابة الشريكات.`
      );
      await loadData("refresh");
    } catch (syncError) {
      console.error("DashboardPartners.syncAllMemberProfiles error:", syncError);
      setError(translatePartnerError(syncError));
    } finally {
      setSaving(false);
    }
  };

  const toggleContractResource = (resourceId: string) => {
    setContractForm((previous) => ({
      ...previous,
      resourceIds: previous.resourceIds.includes(resourceId)
        ? previous.resourceIds.filter((id) => id !== resourceId)
        : [...previous.resourceIds, resourceId],
    }));
  };

  const updatePartnerShare = (value: string) => {
    const parsed = Number(value);
    setContractForm((previous) => ({
      ...previous,
      partnerSharePercent: value,
      salonSharePercent:
        value.trim() && Number.isFinite(parsed) ? String(Math.max(0, 100 - parsed)) : "",
    }));
  };

  const searchPlaceholder =
    activeTab === "partners"
      ? "بحث باسم الشريكة أو المالكة..."
      : activeTab === "resources"
        ? "بحث بالرمز أو اسم المساحة..."
        : activeTab === "team"
          ? "بحث باسم العضوة أو البريد أو الشريكة..."
          : "بحث برقم العقد أو الشريكة أو المساحة...";

  const partnerOptions = [
    { value: "", label: "اختر الشريكة" },
    ...eligiblePartners.map((partner) => ({ value: partner.id, label: partner.displayName })),
  ];
  const contractPartnerOptions = [
    { value: "", label: "اختر الشريكة" },
    ...eligiblePartners.map((partner) => ({
      value: partner.id,
      label: `${partner.displayName} — ${PARTNER_STATUS_LABELS[partner.status]}`,
    })),
  ];
  const employeeOptions = [
    { value: "", label: directoryLoading ? "جاري تحميل الموظفين..." : "اختر الموظف" },
    ...employeeDirectory.map((employee) => ({
      value: employee.employeeId,
      label: `${employee.name || employee.email || employee.employeeId}${employee.email ? ` — ${employee.email}` : ""}`,
    })),
  ];

  const tabCounts: Record<ActiveTab, number> = {
    partners: partners.length,
    resources: resources.length,
    team: members.length,
    contracts: contracts.length,
  };

  const selectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setSearch("");
  };

  return (
    <main className="dsv2-page partners-v2-page" dir="rtl">
      <section className="dsv2-card partners-v2-hero">
        <div className="partners-v2-hero__copy">
          <span className="dsv2-badge dsv2-badge--gold">إدارة الشريكات</span>
          <h1 className="dsv2-page-title">الشريكات ومساحات العمل</h1>
          <p className="dsv2-page-subtitle">
            إدارة المستأجرات وفرقهن والمساحات والعقود التشغيلية من نقطة واحدة، مع ربط واضح بين كل عقد ومساحاته ونموذجه المالي.
          </p>
        </div>

        <div className="partners-v2-hero__actions" aria-label="إجراءات نظام الشريكات">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={() => void loadData("refresh")}
            disabled={refreshing || loading}
          >
            <FontAwesomeIcon icon={faArrowRotateRight} spin={refreshing} />
            تحديث
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={() => void handleSyncAllMemberProfiles()}
            disabled={saving || members.every((member) => !member.employeeId)}
            title="نسخ البيانات التشغيلية الآمنة من ملفات الموظفات إلى بوابة الشريكات"
          >
            <FontAwesomeIcon icon={faArrowRotateRight} spin={saving} />
            مزامنة ملفات الفريق
          </button>
          <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => openCreateModal("partner")}>
            <FontAwesomeIcon icon={faPlus} /> إضافة شريكة
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--accent"
            onClick={() => openCreateModal("member")}
            disabled={eligiblePartners.length === 0}
          >
            <FontAwesomeIcon icon={faUserPlus} /> إضافة عضوة
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            onClick={() => void openEmployeeImportModal()}
            disabled={eligiblePartners.length === 0}
          >
            <FontAwesomeIcon icon={faLink} /> ربط موظف موجود
          </button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => openCreateModal("resource")}>
            <FontAwesomeIcon icon={faChair} /> إضافة مساحة
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            onClick={() => openCreateModal("contract")}
            disabled={eligiblePartners.length === 0 || eligibleResources.length === 0}
            title={
              eligiblePartners.length === 0 || eligibleResources.length === 0
                ? "أضف شريكة ومساحة متاحة أولًا"
                : "إنشاء عقد وربط المساحات"
            }
          >
            <FontAwesomeIcon icon={faFileContract} /> إنشاء عقد
          </button>
        </div>
      </section>

      {(error || successMessage) ? (
        <section className="partners-v2-notices" aria-live="polite">
          {error ? (
            <div className="partners-v2-notice partners-v2-notice--error" role="alert">
              <FontAwesomeIcon icon={faCircleExclamation} />
              <span>{error}</span>
            </div>
          ) : null}
          {successMessage ? (
            <div className="partners-v2-notice partners-v2-notice--success" role="status">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>{successMessage}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="partners-v2-metrics" aria-label="ملخص نظام الشريكات">
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faStore} /></span>
          <p className="dsv2-metric-card__label">الشريكات النشطات</p>
          <p className="dsv2-metric-card__value">{activePartners}</p>
          <p className="dsv2-metric-card__meta">من أصل {partners.length} شريكة</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faChair} /></span>
          <p className="dsv2-metric-card__label">المساحات المتاحة</p>
          <p className="dsv2-metric-card__value">{availableResources}</p>
          <p className="dsv2-metric-card__meta">جاهزة للربط بعقد</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faBuilding} /></span>
          <p className="dsv2-metric-card__label">المساحات المؤجرة</p>
          <p className="dsv2-metric-card__value">{rentedResources}</p>
          <p className="dsv2-metric-card__meta">مرتبطة بعقود تشغيل</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faBriefcase} /></span>
          <p className="dsv2-metric-card__label">العقود النشطة</p>
          <p className="dsv2-metric-card__value">{activeContracts}</p>
          <p className="dsv2-metric-card__meta">من أصل {contracts.length} عقد</p>
        </article>
      </section>

      <section className="dsv2-card partners-v2-workspace">
        <header className="partners-v2-workspace__head">
          <div className="partners-v2-tabs" role="tablist" aria-label="أقسام الشريكات والمساحات">
            {([
              ["partners", faUsers, "الشريكات"],
              ["resources", faChair, "المساحات"],
              ["team", faUserShield, "الفريق والحسابات"],
              ["contracts", faFileContract, "العقود"],
            ] as const).map(([tab, icon, label]) => (
              <button
                key={tab}
                type="button"
                className={activeTab === tab ? "is-active" : ""}
                onClick={() => selectTab(tab)}
                role="tab"
                aria-selected={activeTab === tab}
              >
                <FontAwesomeIcon icon={icon} />
                <span>{label}</span>
                <b>{tabCounts[tab]}</b>
              </button>
            ))}
          </div>

          <label className="partners-v2-search">
            <span className="dsv2-sr-only">بحث</span>
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              className="dsv2-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
        </header>

        <div className="partners-v2-workspace__body">
          {loading ? (
            <div className="partners-v2-loading" role="status" aria-label="جاري تحميل نظام الشريكات">
              {Array.from({ length: 6 }, (_, index) => (
                <article className="partners-v2-skeleton-card" key={index}>
                  <DashboardSkeletonV2 variant="title" width="44%" />
                  <DashboardSkeletonV2 lines={4} />
                </article>
              ))}
            </div>
          ) : activeTab === "partners" ? (
            filteredPartners.length ? (
              <div className="partners-v2-partner-grid">
                {filteredPartners.map((partner) => {
                  const categories = partner.businessCategories.length
                    ? partner.businessCategories.map((item) => PARTNER_CATEGORY_LABELS[item]).join("، ")
                    : "لم يحدد النشاط";
                  const memberCount = memberCountByPartner.get(partner.id) || 0;
                  const resourceCount = resourceCountByPartner.get(partner.id) || 0;
                  const activeContract = activeContractByPartner.get(partner.id);

                  return (
                    <article className="dsv2-card partners-v2-partner-card" key={partner.id}>
                      <header className="partners-v2-partner-card__head">
                        <span className="partners-v2-avatar">{partner.displayName.trim().slice(0, 1) || "ش"}</span>
                        <div>
                          <h3>{partner.displayName}</h3>
                          <p>{partner.ownerName}</p>
                        </div>
                        <span className={`dsv2-badge ${partnerBadgeClass(partner.status)}`}>
                          {PARTNER_STATUS_LABELS[partner.status]}
                        </span>
                      </header>

                      <div className="partners-v2-category">{categories}</div>

                      <dl className="partners-v2-mini-metrics">
                        <div><dt>أعضاء الفريق</dt><dd>{memberCount}</dd></div>
                        <div><dt>المساحات المرتبطة</dt><dd>{resourceCount}</dd></div>
                      </dl>

                      <div className="partners-v2-contact">
                        <span><FontAwesomeIcon icon={faPhone} /> {partner.phone || "لا يوجد رقم جوال"}</span>
                        <span><FontAwesomeIcon icon={faEnvelope} /> {partner.email || "لا يوجد بريد إلكتروني"}</span>
                      </div>

                      <footer className="partners-v2-partner-card__footer">
                        <span>{activeContract ? BILLING_MODEL_LABELS[activeContract.billingModel] : "لا يوجد عقد نشط"}</span>
                        <strong dir="ltr">{activeContract?.contractNumber || "—"}</strong>
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : (
              <DashboardEmptyStateV2
                compact
                tone="gold"
                title={search ? "لا توجد نتائج مطابقة" : "لم تتم إضافة أي شريكة"}
                description={search ? "غيّر عبارة البحث وحاول مجددًا." : "ابدأ بإضافة أول مستأجرة أو مالكة مساحة داخل ملكات."}
                action={!search ? <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => openCreateModal("partner")}>إضافة أول شريكة</button> : undefined}
              />
            )
          ) : activeTab === "resources" ? (
            filteredResources.length ? (
              <div className="partners-v2-table-wrap">
                <table className="partners-v2-table">
                  <thead>
                    <tr>
                      <th>المساحة</th>
                      <th>النوع</th>
                      <th>الموقع</th>
                      <th>الحالة</th>
                      <th>الشريكة الحالية</th>
                      <th>العقد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResources.map((resource) => (
                      <tr key={resource.id}>
                        <td data-label="المساحة">
                          <div className="partners-v2-resource-name">
                            <span><FontAwesomeIcon icon={faChair} /></span>
                            <div><strong>{resource.name}</strong><small dir="ltr">{resource.code}</small></div>
                          </div>
                        </td>
                        <td data-label="النوع">{RESOURCE_TYPE_LABELS[resource.type]}</td>
                        <td data-label="الموقع">{[resource.zone, resource.floor].filter(Boolean).join(" — ") || "غير محدد"}</td>
                        <td data-label="الحالة">
                          <span className={`dsv2-badge ${resourceBadgeClass(resource.status)}`}>
                            {RESOURCE_STATUS_LABELS[resource.status]}
                          </span>
                        </td>
                        <td data-label="الشريكة الحالية">
                          {resource.currentPartnerId
                            ? partnerNameById.get(resource.currentPartnerId) || "شريكة غير معروفة"
                            : "غير مرتبطة"}
                        </td>
                        <td data-label="العقد">
                          {resource.currentContractId
                            ? contracts.find((contract) => contract.id === resource.currentContractId)?.contractNumber || "عقد مرتبط"
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <DashboardEmptyStateV2
                compact
                tone="gold"
                title={search ? "لا توجد نتائج مطابقة" : "لم تتم إضافة أي مساحة"}
                description={search ? "غيّر عبارة البحث وحاول مجددًا." : "أضف المقاعد والغرف ومحطات العمل المتاحة للتأجير."}
                action={!search ? <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => openCreateModal("resource")}>إضافة أول مساحة</button> : undefined}
              />
            )
          ) : activeTab === "team" ? (
            filteredMembers.length ? (
              <div className="partners-v2-team-grid">
                {filteredMembers.map((member) => (
                  <article className="dsv2-card partners-v2-team-card" key={member.id}>
                    <header className="partners-v2-team-card__head">
                      <span className="partners-v2-avatar">{member.displayName.trim().slice(0, 1) || "م"}</span>
                      <div>
                        <h3>{member.displayName}</h3>
                        <p>{partnerNameById.get(member.partnerId) || "شريكة غير معروفة"}</p>
                      </div>
                      <span className={`dsv2-badge ${member.status === "active" ? "dsv2-badge--success" : member.status === "suspended" ? "dsv2-badge--danger" : ""}`}>
                        {member.status === "active" ? "نشطة" : member.status === "suspended" ? "موقوفة" : "غير نشطة"}
                      </span>
                    </header>

                    <div className="partners-v2-team-card__meta">
                      <span><FontAwesomeIcon icon={faUserShield} /> {member.memberType === "owner" ? "مالكة النشاط" : member.memberType === "contractor" ? "متعاقدة" : "موظفة"}</span>
                      <span><FontAwesomeIcon icon={faEnvelope} /> {member.email || "لا يوجد بريد"}</span>
                      <span><FontAwesomeIcon icon={faPhone} /> {member.phone || "لا يوجد جوال"}</span>
                    </div>

                    <div className="partners-v2-permissions" aria-label="صلاحيات العضوة">
                      <span data-enabled={member.canWorkAsProvider}>تنفيذ خدمات</span>
                      <span data-enabled={member.canManageTeam}>إدارة فريق</span>
                      <span data-enabled={member.canManageInventory}>إدارة مخزون</span>
                      <span data-enabled={member.canViewFinancials}>عرض المالية</span>
                    </div>

                    <footer className="partners-v2-team-card__actions">
                      {member.userUid ? (
                        <span className="partners-v2-linked"><FontAwesomeIcon icon={faCircleCheck} /> حساب دخول مرتبط</span>
                      ) : (
                        <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => openAccountModal(member)}>
                          <FontAwesomeIcon icon={faKey} /> إنشاء حساب دخول
                        </button>
                      )}
                      {member.memberType !== "owner" ? (
                        member.employeeId ? (
                          <span className="partners-v2-linked"><FontAwesomeIcon icon={faCircleCheck} /> مرتبط بإدارة الموظفين</span>
                        ) : (
                          <>
                            <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => void handleSyncMemberToHr(member)} disabled={saving}>
                              <FontAwesomeIcon icon={faUserPlus} /> إنشاء ملف موظف
                            </button>
                            <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => void openExistingEmployeeModal(member)} disabled={saving}>
                              <FontAwesomeIcon icon={faLink} /> ربط بموظف موجود
                            </button>
                          </>
                        )
                      ) : null}
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <DashboardEmptyStateV2
                compact
                tone="gold"
                title={search ? "لا توجد نتائج مطابقة" : "لا يوجد أعضاء فريق"}
                description={search ? "غيّر عبارة البحث وحاول مجددًا." : "أضف موظفات أو متعاقدات واربط لهن حسابات دخول مستقلة."}
                action={!search && eligiblePartners.length ? <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => openCreateModal("member")}>إضافة أول عضوة</button> : undefined}
              />
            )
          ) : filteredContracts.length ? (
            <div className="partners-v2-contract-grid">
              {filteredContracts.map((contract) => {
                const contractResources = contract.resourceIds
                  .map((resourceId) => resourceById.get(resourceId))
                  .filter((resource): resource is RentalResource => Boolean(resource));

                return (
                  <article className="dsv2-card partners-v2-contract-card" key={contract.id}>
                    <header className="partners-v2-contract-card__head">
                      <span className="partners-v2-contract-card__icon"><FontAwesomeIcon icon={faFileContract} /></span>
                      <div>
                        <small dir="ltr">{contract.contractNumber}</small>
                        <h3>{partnerNameById.get(contract.partnerId) || "شريكة غير معروفة"}</h3>
                      </div>
                      <span className={`dsv2-badge ${contractBadgeClass(contract.status)}`}>
                        {CONTRACT_STATUS_LABELS[contract.status]}
                      </span>
                    </header>

                    <div className="partners-v2-contract-model">
                      <FontAwesomeIcon icon={faMoneyBillTransfer} />
                      <div><small>نموذج الاتفاق</small><strong>{BILLING_MODEL_LABELS[contract.billingModel]}</strong></div>
                    </div>

                    <div className="partners-v2-contract-financial">
                      <small>القيمة المالية</small>
                      <strong>{contractFinancialSummary(contract)}</strong>
                      {contract.revenueShareBasis ? <span>{REVENUE_BASIS_LABELS[contract.revenueShareBasis]}</span> : null}
                    </div>

                    <div className="partners-v2-contract-dates">
                      <span><FontAwesomeIcon icon={faCalendarDays} /> من {formatContractDate(contract.startDate)}</span>
                      <span><FontAwesomeIcon icon={faCalendarDays} /> إلى {formatContractDate(contract.endDate)}</span>
                    </div>

                    <div className="partners-v2-contract-resources">
                      <small>المساحات المرتبطة</small>
                      <div>
                        {contractResources.length
                          ? contractResources.map((resource) => <span key={resource.id}>{resource.code} · {resource.name}</span>)
                          : <span>لا توجد مساحات ظاهرة</span>}
                      </div>
                    </div>

                    <footer className="partners-v2-contract-card__footer">
                      <span><FontAwesomeIcon icon={faClock} /> {contract.timeOffMonthlyHours ?? 0} ساعة أوف شهريًا</span>
                      <strong>{contract.timeOffMaxHoursPerRolling14Days ?? 0} ساعة / 14 يومًا</strong>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <DashboardEmptyStateV2
              compact
              tone="gold"
              title={search ? "لا توجد نتائج مطابقة" : "لم يتم إنشاء أي عقد"}
              description={search ? "غيّر عبارة البحث وحاول مجددًا." : "أنشئ عقدًا لربط الشريكة بمساحتها ونموذج الاتفاق المالي."}
              action={!search && eligiblePartners.length && eligibleResources.length ? <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => openCreateModal("contract")}>إنشاء أول عقد</button> : undefined}
            />
          )}
        </div>
      </section>

      <DashboardModalV2
        open={createModal === "partner"}
        onClose={closeCreateModal}
        title="إضافة شريكة جديدة"
        description="سيتم إنشاء سجل الشريكة وإضافة المالكة تلقائيًا كأول عضو في فريقها."
        eyebrow="شريكة جديدة"
        size="lg"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleCreatePartner}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field">
              <span>اسم النشاط أو الاسم الظاهر *</span>
              <input className="dsv2-input" value={partnerForm.displayName} onChange={(event) => setPartnerForm((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="مثال: حنان بيوتي" required autoFocus />
            </label>
            <label className="partners-v2-field">
              <span>اسم مالكة النشاط *</span>
              <input className="dsv2-input" value={partnerForm.ownerName} onChange={(event) => setPartnerForm((prev) => ({ ...prev, ownerName: event.target.value }))} placeholder="مثال: حنان محمد" required />
            </label>
            <label className="partners-v2-field">
              <span>رقم الجوال</span>
              <input className="dsv2-input" value={partnerForm.phone} onChange={(event) => setPartnerForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="05xxxxxxxx" inputMode="tel" dir="ltr" />
            </label>
            <label className="partners-v2-field">
              <span>البريد الإلكتروني</span>
              <input className="dsv2-input" type="email" value={partnerForm.email} onChange={(event) => setPartnerForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="partner@example.com" dir="ltr" />
            </label>
            <label className="partners-v2-field">
              <span>النشاط الأساسي</span>
              <DashboardSelectV2 options={partnerCategoryOptions} value={partnerForm.category} onChange={(value) => setPartnerForm((prev) => ({ ...prev, category: value as PartnerBusinessCategory }))} />
            </label>
            <label className="partners-v2-field">
              <span>حالة الشريكة</span>
              <DashboardSelectV2 options={partnerStatusOptions} value={partnerForm.status} onChange={(value) => setPartnerForm((prev) => ({ ...prev, status: value as PartnerStatus }))} />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>ملاحظات داخلية</span>
              <textarea className="dsv2-textarea" value={partnerForm.notes} onChange={(event) => setPartnerForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="أي تفاصيل أولية عن الشريكة أو النشاط..." rows={4} />
            </label>
          </div>
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving}>{saving ? "جاري الإنشاء..." : "إنشاء الشريكة"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "resource"}
        onClose={closeCreateModal}
        title="إضافة مقعد أو مساحة"
        description="أنشئ المساحة الآن، ثم اربطها بالشريكة من خلال عقد التشغيل."
        eyebrow="مساحة عمل جديدة"
        size="lg"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleCreateResource}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field">
              <span>رمز المساحة *</span>
              <input className="dsv2-input" value={resourceForm.code} onChange={(event) => setResourceForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))} placeholder="مثال: H-01" required autoFocus dir="ltr" />
            </label>
            <label className="partners-v2-field">
              <span>اسم المساحة *</span>
              <input className="dsv2-input" value={resourceForm.name} onChange={(event) => setResourceForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="مثال: مقعد الاستشوار الأول" required />
            </label>
            <label className="partners-v2-field">
              <span>نوع المساحة</span>
              <DashboardSelectV2 options={resourceTypeOptions} value={resourceForm.type} onChange={(value) => setResourceForm((prev) => ({ ...prev, type: value as RentalResourceType }))} />
            </label>
            <label className="partners-v2-field">
              <span>الحالة الأولية</span>
              <DashboardSelectV2 options={resourceStatusOptions} value={resourceForm.status} onChange={(value) => setResourceForm((prev) => ({ ...prev, status: value as RentalResourceStatus }))} />
            </label>
            <label className="partners-v2-field">
              <span>المنطقة داخل الصالون</span>
              <input className="dsv2-input" value={resourceForm.zone} onChange={(event) => setResourceForm((prev) => ({ ...prev, zone: event.target.value }))} placeholder="مثال: قسم الشعر" />
            </label>
            <label className="partners-v2-field">
              <span>الدور أو الموقع</span>
              <input className="dsv2-input" value={resourceForm.floor} onChange={(event) => setResourceForm((prev) => ({ ...prev, floor: event.target.value }))} placeholder="مثال: الدور الأرضي" />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>وصف المساحة</span>
              <textarea className="dsv2-textarea" value={resourceForm.description} onChange={(event) => setResourceForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="الموقع، المقاس، والخدمات المتوفرة للمساحة..." rows={3} />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>التجهيزات المسلّمة</span>
              <textarea className="dsv2-textarea" value={resourceForm.equipmentNotes} onChange={(event) => setResourceForm((prev) => ({ ...prev, equipmentNotes: event.target.value }))} placeholder="كرسي، مرآة، درج، جهاز، إضاءة..." rows={3} />
            </label>
          </div>
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving}>{saving ? "جاري الإنشاء..." : "إنشاء المساحة"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "member"}
        onClose={closeCreateModal}
        title="إضافة عضوة إلى فريق شريكة"
        description="يمكن إضافتها كسجل فقط أو إنشاء حساب دخول مستقل لها مباشرة."
        eyebrow="عضوة فريق جديدة"
        size="lg"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleCreateMember}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field">
              <span>الشريكة التابعة لها *</span>
              <DashboardSelectV2 options={partnerOptions} value={memberForm.partnerId} required onChange={(value) => setMemberForm((previous) => ({ ...previous, partnerId: value }))} />
            </label>
            <label className="partners-v2-field">
              <span>نوع العضوة</span>
              <DashboardSelectV2 options={memberTypeOptions} value={memberForm.memberType} onChange={(value) => setMemberForm((previous) => ({ ...previous, memberType: value as "employee" | "contractor" }))} />
            </label>
            <label className="partners-v2-field">
              <span>الاسم الكامل *</span>
              <input className="dsv2-input" value={memberForm.displayName} onChange={(event) => setMemberForm((previous) => ({ ...previous, displayName: event.target.value }))} placeholder="مثال: سارة أحمد" required />
            </label>
            <label className="partners-v2-field">
              <span>رقم الجوال</span>
              <input className="dsv2-input" value={memberForm.phone} onChange={(event) => setMemberForm((previous) => ({ ...previous, phone: event.target.value }))} placeholder="05xxxxxxxx" inputMode="tel" />
            </label>

            <label className="partners-v2-toggle-card partners-v2-field--wide">
              <input type="checkbox" checked={memberForm.createLogin} onChange={(event) => setMemberForm((previous) => ({ ...previous, createLogin: event.target.checked }))} />
              <span><strong>إنشاء حساب دخول الآن</strong><small>تستطيع العضوة الدخول من صفحة بوابة الشريكات بنفس البريد وكلمة المرور.</small></span>
            </label>

            <label className="partners-v2-field">
              <span>البريد الإلكتروني {memberForm.createLogin ? "*" : ""}</span>
              <input className="dsv2-input" type="email" value={memberForm.email} onChange={(event) => setMemberForm((previous) => ({ ...previous, email: event.target.value }))} placeholder="employee@example.com" required={memberForm.createLogin} />
            </label>
            {memberForm.createLogin ? (
              <label className="partners-v2-field">
                <span>كلمة مرور مؤقتة *</span>
                <input className="dsv2-input" type="text" minLength={8} value={memberForm.password} onChange={(event) => setMemberForm((previous) => ({ ...previous, password: event.target.value }))} placeholder="8 أحرف أو أكثر" required />
              </label>
            ) : null}

            <div className="partners-v2-form-section partners-v2-field--wide">
              <FontAwesomeIcon icon={faUserShield} />
              <div><strong>صلاحيات العضوة</strong><span>يمكن تعديلها لاحقًا من نظام الفريق.</span></div>
            </div>

            <div className="partners-v2-permission-grid partners-v2-field--wide">
              {([
                ["canWorkAsProvider", "تنفيذ الخدمات", "تظهر كمنفذة للخدمة في الحجوزات"],
                ["canManageTeam", "إدارة الفريق", "إضافة وتعديل أعضاء فريق الشريكة"],
                ["canManageInventory", "إدارة المخزون", "الوصول إلى مخزون الشريكة"],
                ["canViewFinancials", "عرض المالية", "مشاهدة العقد والمستحقات والنسب"],
              ] as const).map(([field, title, description]) => (
                <label key={field} className="partners-v2-toggle-card">
                  <input type="checkbox" checked={Boolean(memberForm[field])} onChange={(event) => setMemberForm((previous) => ({ ...previous, [field]: event.target.checked }))} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                </label>
              ))}
            </div>
          </div>
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving || !memberForm.partnerId}>{saving ? "جاري إنشاء العضوة..." : memberForm.createLogin ? "إضافة العضوة وإنشاء الحساب" : "إضافة العضوة"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "employeeImport"}
        onClose={closeCreateModal}
        title="ربط موظف موجود بفريق شريكة"
        description="اختر الشريكة والموظف السابق. لن يتم إنشاء حساب أو ملف HR جديد."
        eyebrow="ربط موظف موجود"
        size="lg"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleImportExistingEmployee}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field">
              <span>الشريكة *</span>
              <DashboardSelectV2 options={partnerOptions} value={importPartnerId} required onChange={setImportPartnerId} />
            </label>
            <label className="partners-v2-field">
              <span>الموظف الموجود *</span>
              <DashboardSelectV2 options={employeeOptions} value={selectedExistingEmployeeId} disabled={directoryLoading} required onChange={setSelectedExistingEmployeeId} />
            </label>
          </div>
          {!directoryLoading && employeeDirectory.length === 0 ? <div className="partners-v2-account-note">لا توجد ملفات موظفين متاحة للربط.</div> : null}
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving || !importPartnerId || !selectedExistingEmployeeId}>{saving ? "جاري الربط..." : "ربط الموظف بالشريكة"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "employeeLink"}
        onClose={closeCreateModal}
        title="ربط بموظف موجود"
        description="سيتم الاحتفاظ بحساب الموظف وبصمته وسجلاته ورواتبه، وإضافة علاقة الشريك إلى ملفه الحالي."
        eyebrow="ربط ملف موظف"
        size="lg"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleLinkExistingEmployee}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field partners-v2-field--wide">
              <span>عضو فريق الشريك</span>
              <input className="dsv2-input" value={selectedMember?.displayName || ""} disabled />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>اختر الموظف الموجود *</span>
              <DashboardSelectV2 options={employeeOptions} value={selectedExistingEmployeeId} disabled={directoryLoading} required onChange={setSelectedExistingEmployeeId} />
            </label>
          </div>
          {!directoryLoading && employeeDirectory.length === 0 ? <div className="partners-v2-account-note">لا توجد ملفات موظفين متاحة للربط حاليًا.</div> : null}
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving || !selectedExistingEmployeeId}>{saving ? "جاري الربط..." : "ربط الملف الحالي"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "account"}
        onClose={closeCreateModal}
        title="إنشاء حساب دخول"
        description={`سيتم ربط الحساب مباشرة بـ ${selectedMember?.displayName || "عضوة الفريق"} دون تغيير حساب الإدارة الحالي.`}
        eyebrow="حساب دخول"
        size="md"
        tone="gold"
        className="partners-v2-modal"
      >
        <form className="partners-v2-form" onSubmit={handleCreateMemberAccount}>
          <div className="partners-v2-form-grid">
            <label className="partners-v2-field partners-v2-field--wide">
              <span>البريد الإلكتروني *</span>
              <input className="dsv2-input" type="email" value={accountForm.email} onChange={(event) => setAccountForm((previous) => ({ ...previous, email: event.target.value }))} placeholder="partner@example.com" required autoFocus />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>كلمة مرور مؤقتة *</span>
              <input className="dsv2-input" type="text" minLength={8} value={accountForm.password} onChange={(event) => setAccountForm((previous) => ({ ...previous, password: event.target.value }))} placeholder="8 أحرف أو أكثر" required />
            </label>
          </div>
          <div className="partners-v2-account-note"><FontAwesomeIcon icon={faKey} /><span>رابط الدخول الخاص بالشريكات: <strong dir="ltr">/partner/login</strong></span></div>
          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving}>{saving ? "جاري إنشاء الحساب..." : "إنشاء وربط الحساب"}</button>
          </div>
        </form>
      </DashboardModalV2>

      <DashboardModalV2
        open={createModal === "contract"}
        onClose={closeCreateModal}
        title="إنشاء عقد وربط المساحات"
        description="العقد والمساحات المحددة تحفظ في عملية واحدة، لمنع أي ربط مالي أو تشغيلي ناقص."
        eyebrow="عقد شريكة جديد"
        size="xl"
        tone="gold"
        className="partners-v2-modal partners-v2-contract-modal"
      >
        <form className="partners-v2-form" onSubmit={handleCreateContract}>
          <div className="partners-v2-form-grid partners-v2-contract-form">
            <div className="partners-v2-form-section partners-v2-field--wide">
              <FontAwesomeIcon icon={faFileContract} />
              <div><strong>بيانات العقد</strong><span>الشريكة، رقم العقد، والحالة الزمنية.</span></div>
            </div>

            <label className="partners-v2-field">
              <span>الشريكة *</span>
              <DashboardSelectV2
                options={contractPartnerOptions}
                value={contractForm.partnerId}
                required
                onChange={(partnerId) => {
                  const selectedPartner = partners.find((partner) => partner.id === partnerId);
                  setContractForm((prev) => ({
                    ...prev,
                    partnerId,
                    status: selectedPartner?.status === "draft" ? "draft" : prev.status,
                  }));
                }}
              />
            </label>

            <label className="partners-v2-field">
              <span>رقم العقد *</span>
              <input className="dsv2-input" value={contractForm.contractNumber} onChange={(event) => setContractForm((prev) => ({ ...prev, contractNumber: event.target.value.toUpperCase() }))} required dir="ltr" />
            </label>

            <label className="partners-v2-field">
              <span>حالة العقد</span>
              <DashboardSelectV2 options={contractStatusOptions} value={contractForm.status} onChange={(value) => setContractForm((prev) => ({ ...prev, status: value as "draft" | "active" }))} />
            </label>

            <label className="partners-v2-field">
              <span>نموذج الاتفاق المالي</span>
              <DashboardSelectV2 options={billingModelOptions} value={contractForm.billingModel} onChange={(value) => setContractForm((prev) => ({ ...prev, billingModel: value as PartnerBillingModel }))} />
            </label>

            <label className="partners-v2-field">
              <span>تاريخ البداية *</span>
              <DashboardDatePickerV2 value={contractForm.startDate} required clearable={false} onChange={(value) => setContractForm((prev) => ({ ...prev, startDate: value }))} />
            </label>

            <label className="partners-v2-field">
              <span>تاريخ النهاية</span>
              <DashboardDatePickerV2 value={contractForm.endDate} min={contractForm.startDate || undefined} onChange={(value) => setContractForm((prev) => ({ ...prev, endDate: value }))} />
            </label>

            <div className="partners-v2-form-section partners-v2-field--wide">
              <FontAwesomeIcon icon={faChair} />
              <div><strong>المقاعد والمساحات</strong><span>اختر مساحة واحدة أو عدة مساحات ضمن العقد نفسه.</span></div>
            </div>

            <div className="partners-v2-resource-picker partners-v2-field--wide">
              {eligibleResources.length ? (
                eligibleResources.map((resource) => {
                  const selected = contractForm.resourceIds.includes(resource.id);
                  return (
                    <button
                      type="button"
                      className={selected ? "is-selected" : ""}
                      key={resource.id}
                      onClick={() => toggleContractResource(resource.id)}
                      aria-pressed={selected}
                    >
                      <span className="partners-v2-resource-picker__icon">
                        <FontAwesomeIcon icon={selected ? faCircleCheck : faChair} />
                      </span>
                      <div><strong>{resource.name}</strong><small>{resource.code} · {RESOURCE_TYPE_LABELS[resource.type]}</small></div>
                      <em>{RESOURCE_STATUS_LABELS[resource.status]}</em>
                    </button>
                  );
                })
              ) : (
                <div className="partners-v2-resource-picker__empty">لا توجد مساحة متاحة للربط حاليًا.</div>
              )}
            </div>

            <div className="partners-v2-form-section partners-v2-field--wide">
              <FontAwesomeIcon icon={faMoneyBillTransfer} />
              <div><strong>الشروط المالية</strong><span>تظهر الحقول المناسبة حسب نموذج الاتفاق.</span></div>
            </div>

            {(contractForm.billingModel === "fixed_rent" || contractForm.billingModel === "hybrid") ? (
              <label className="partners-v2-field">
                <span>الإيجار الثابت بالريال *</span>
                <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.01" value={contractForm.fixedRentAmount} onChange={(event) => setContractForm((prev) => ({ ...prev, fixedRentAmount: event.target.value }))} placeholder="مثال: 1500" required />
              </label>
            ) : null}

            {contractForm.billingModel === "hourly" ? (
              <label className="partners-v2-field">
                <span>سعر الساعة بالريال *</span>
                <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.01" value={contractForm.hourlyRate} onChange={(event) => setContractForm((prev) => ({ ...prev, hourlyRate: event.target.value }))} required />
              </label>
            ) : null}

            {contractForm.billingModel === "daily" ? (
              <label className="partners-v2-field">
                <span>سعر اليوم بالريال *</span>
                <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.01" value={contractForm.dailyRate} onChange={(event) => setContractForm((prev) => ({ ...prev, dailyRate: event.target.value }))} required />
              </label>
            ) : null}

            {(contractForm.billingModel === "revenue_share" || contractForm.billingModel === "hybrid") ? (
              <>
                <label className="partners-v2-field">
                  <span>نسبة الشريكة % *</span>
                  <div className="partners-v2-input-icon"><FontAwesomeIcon icon={faPercent} /><DashboardNumberInputV2 className="dsv2-input" min="0" max="100" step="0.01" value={contractForm.partnerSharePercent} onChange={(event) => updatePartnerShare(event.target.value)} required /></div>
                </label>
                <label className="partners-v2-field">
                  <span>نسبة ملكات % *</span>
                  <div className="partners-v2-input-icon"><FontAwesomeIcon icon={faPercent} /><DashboardNumberInputV2 className="dsv2-input" min="0" max="100" step="0.01" value={contractForm.salonSharePercent} onChange={(event) => setContractForm((prev) => ({ ...prev, salonSharePercent: event.target.value }))} required /></div>
                </label>
                <label className="partners-v2-field">
                  <span>أساس احتساب النسبة</span>
                  <DashboardSelectV2 options={revenueBasisOptions} value={contractForm.revenueShareBasis} onChange={(value) => setContractForm((prev) => ({ ...prev, revenueShareBasis: value as RevenueShareBasis }))} />
                </label>
                <label className="partners-v2-field">
                  <span>الحد الأدنى لحصة ملكات</span>
                  <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.01" value={contractForm.minimumSalonShareAmount} onChange={(event) => setContractForm((prev) => ({ ...prev, minimumSalonShareAmount: event.target.value }))} placeholder="اختياري" />
                </label>
              </>
            ) : null}

            <label className="partners-v2-field">
              <span>مبلغ التأمين</span>
              <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.01" value={contractForm.depositAmount} onChange={(event) => setContractForm((prev) => ({ ...prev, depositAmount: event.target.value }))} placeholder="اختياري" />
            </label>
            <label className="partners-v2-field">
              <span>يوم الاستحقاق الشهري</span>
              <DashboardNumberInputV2 className="dsv2-input" min="1" max="28" step="1" value={contractForm.paymentDueDay} onChange={(event) => setContractForm((prev) => ({ ...prev, paymentDueDay: event.target.value }))} />
            </label>

            <div className="partners-v2-form-section partners-v2-field--wide">
              <FontAwesomeIcon icon={faClock} />
              <div><strong>سياسة ساعات الأوف</strong><span>تُحفظ من الآن داخل العقد لتطبيقها على فريق الشريكة لاحقًا.</span></div>
            </div>

            <label className="partners-v2-field">
              <span>الرصيد الشهري بالساعات</span>
              <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.5" value={contractForm.timeOffMonthlyHours} onChange={(event) => setContractForm((prev) => ({ ...prev, timeOffMonthlyHours: event.target.value }))} />
            </label>
            <label className="partners-v2-field">
              <span>الحد الأقصى خلال 14 يومًا</span>
              <DashboardNumberInputV2 className="dsv2-input" min="0" step="0.5" value={contractForm.timeOffMaxHoursPerRolling14Days} onChange={(event) => setContractForm((prev) => ({ ...prev, timeOffMaxHoursPerRolling14Days: event.target.value }))} />
            </label>
            <label className="partners-v2-field partners-v2-field--wide">
              <span>ملاحظات العقد</span>
              <textarea className="dsv2-textarea" value={contractForm.notes} onChange={(event) => setContractForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="الشروط الخاصة، التجهيزات، أو أي ملاحظات تعاقدية..." rows={4} />
            </label>
          </div>

          <div className="partners-v2-contract-summary">
            <div><span>المساحات المحددة</span><strong>{contractForm.resourceIds.length}</strong></div>
            <div><span>نموذج الاتفاق</span><strong>{BILLING_MODEL_LABELS[contractForm.billingModel]}</strong></div>
            <div><span>حالة الربط</span><strong>{contractForm.status === "active" ? "مؤجرة فورًا" : "محجوزة كمسودة"}</strong></div>
          </div>

          <div className="partners-v2-form-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeCreateModal} disabled={saving}>إلغاء</button>
            <button type="submit" className="dsv2-btn dsv2-btn--primary" disabled={saving || !contractForm.partnerId || !contractForm.contractNumber.trim() || contractForm.resourceIds.length === 0}>{saving ? "جاري حفظ العقد والربط..." : "إنشاء العقد وربط المساحات"}</button>
          </div>
        </form>
      </DashboardModalV2>
    </main>
  );
}
