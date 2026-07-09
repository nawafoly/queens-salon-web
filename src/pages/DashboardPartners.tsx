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
  faMagnifyingGlass,
  faMoneyBillTransfer,
  faPercent,
  faPlus,
  faStore,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import Modal from "../components/Modal";
import { auth } from "../services/firebase";
import { PartnerService } from "../services/partnerService";
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
import "../styles/AdminDashboardPartners.css";

type ActiveTab = "partners" | "resources" | "contracts";
type CreateModal = "partner" | "resource" | "contract" | null;

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
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatContractDate(value?: string) {
  if (!value) return "مفتوح";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ar-SA", {
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

  if (message.includes("permission-denied")) {
    return "لا توجد صلاحية للوصول إلى نظام الشريكات. تأكد من نشر قواعد Firestore الجديدة.";
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
  if (message.includes("resource_already_assigned")) {
    return "إحدى المساحات مرتبطة بعقد آخر. حدّث الصفحة واختر مساحة متاحة.";
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

  return message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

function getPartnerStatusClass(status: PartnerStatus) {
  return `is-${status}`;
}

function getResourceStatusClass(status: RentalResourceStatus) {
  return `is-${status}`;
}

function getContractStatusClass(status: PartnerContractStatus) {
  return `is-${status}`;
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

export default function DashboardPartners() {
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

  const openCreateModal = (modal: Exclude<CreateModal, null>) => {
    setError("");
    setSuccessMessage("");
    if (modal === "partner") setPartnerForm(EMPTY_PARTNER_FORM);
    if (modal === "resource") setResourceForm(EMPTY_RESOURCE_FORM);
    if (modal === "contract") {
      setContractForm(createEmptyContractForm(suggestContractNumber(contracts)));
    }
    setCreateModal(modal);
  };

  const closeCreateModal = () => {
    if (saving) return;
    setCreateModal(null);
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
        : "بحث برقم العقد أو الشريكة أو المساحة...";

  return (
    <div className="partner-admin-page" dir="rtl">
      <header className="partner-admin-hero">
        <div className="partner-admin-hero__copy">
          <span className="partner-admin-kicker">PARTNER WORKSPACE</span>
          <h1>الشريكات ومساحات العمل</h1>
          <p>
            إدارة المستأجرات، فرقهن، المقاعد، والعقود التشغيلية من نقطة واحدة مع ربط آمن
            بين كل عقد ومساحاته ونموذجه المالي.
          </p>
        </div>

        <div className="partner-admin-hero__actions">
          <button
            type="button"
            className="partner-admin-btn partner-admin-btn--secondary"
            onClick={() => void loadData("refresh")}
            disabled={refreshing || loading}
          >
            <FontAwesomeIcon icon={faArrowRotateRight} spin={refreshing} />
            تحديث
          </button>
          <button
            type="button"
            className="partner-admin-btn partner-admin-btn--primary"
            onClick={() => openCreateModal("partner")}
          >
            <FontAwesomeIcon icon={faPlus} />
            إضافة شريكة
          </button>
          <button
            type="button"
            className="partner-admin-btn partner-admin-btn--dark"
            onClick={() => openCreateModal("resource")}
          >
            <FontAwesomeIcon icon={faChair} />
            إضافة مساحة
          </button>
          <button
            type="button"
            className="partner-admin-btn partner-admin-btn--contract"
            onClick={() => openCreateModal("contract")}
            disabled={eligiblePartners.length === 0 || eligibleResources.length === 0}
            title={
              eligiblePartners.length === 0 || eligibleResources.length === 0
                ? "أضف شريكة ومساحة متاحة أولًا"
                : "إنشاء عقد وربط المساحات"
            }
          >
            <FontAwesomeIcon icon={faFileContract} />
            إنشاء عقد
          </button>
        </div>
      </header>

      {error ? (
        <div className="partner-admin-alert partner-admin-alert--error" role="alert">
          <FontAwesomeIcon icon={faCircleExclamation} />
          <span>{error}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="partner-admin-alert partner-admin-alert--success" role="status">
          <FontAwesomeIcon icon={faCircleCheck} />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <section className="partner-admin-stats" aria-label="ملخص نظام الشريكات">
        <article className="partner-admin-stat">
          <span className="partner-admin-stat__icon"><FontAwesomeIcon icon={faStore} /></span>
          <div><small>الشريكات النشطات</small><strong>{activePartners}</strong></div>
        </article>
        <article className="partner-admin-stat">
          <span className="partner-admin-stat__icon"><FontAwesomeIcon icon={faChair} /></span>
          <div><small>المساحات المتاحة</small><strong>{availableResources}</strong></div>
        </article>
        <article className="partner-admin-stat">
          <span className="partner-admin-stat__icon"><FontAwesomeIcon icon={faBuilding} /></span>
          <div><small>المساحات المؤجرة</small><strong>{rentedResources}</strong></div>
        </article>
        <article className="partner-admin-stat">
          <span className="partner-admin-stat__icon"><FontAwesomeIcon icon={faBriefcase} /></span>
          <div><small>العقود النشطة</small><strong>{activeContracts}</strong></div>
        </article>
      </section>

      <section className="partner-admin-panel">
        <div className="partner-admin-toolbar">
          <div className="partner-admin-tabs" role="tablist" aria-label="أقسام الشريكات والمساحات">
            <button
              type="button"
              className={activeTab === "partners" ? "is-active" : ""}
              onClick={() => { setActiveTab("partners"); setSearch(""); }}
              role="tab"
              aria-selected={activeTab === "partners"}
            >
              <FontAwesomeIcon icon={faUsers} />
              الشريكات
              <span>{partners.length}</span>
            </button>
            <button
              type="button"
              className={activeTab === "resources" ? "is-active" : ""}
              onClick={() => { setActiveTab("resources"); setSearch(""); }}
              role="tab"
              aria-selected={activeTab === "resources"}
            >
              <FontAwesomeIcon icon={faChair} />
              المساحات
              <span>{resources.length}</span>
            </button>
            <button
              type="button"
              className={activeTab === "contracts" ? "is-active" : ""}
              onClick={() => { setActiveTab("contracts"); setSearch(""); }}
              role="tab"
              aria-selected={activeTab === "contracts"}
            >
              <FontAwesomeIcon icon={faFileContract} />
              العقود
              <span>{contracts.length}</span>
            </button>
          </div>

          <label className="partner-admin-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
        </div>

        {loading ? (
          <div className="partner-admin-empty">
            <span className="partner-admin-loader" />
            <h3>جاري تحميل نظام الشريكات</h3>
            <p>يتم قراءة الشريكات والمساحات والعقود والفرق.</p>
          </div>
        ) : activeTab === "partners" ? (
          filteredPartners.length > 0 ? (
            <div className="partner-admin-grid">
              {filteredPartners.map((partner) => {
                const categories = partner.businessCategories.length
                  ? partner.businessCategories.map((item) => PARTNER_CATEGORY_LABELS[item]).join("، ")
                  : "لم يحدد النشاط";
                const memberCount = memberCountByPartner.get(partner.id) || 0;
                const resourceCount = resourceCountByPartner.get(partner.id) || 0;
                const activeContract = activeContractByPartner.get(partner.id);

                return (
                  <article className="partner-card" key={partner.id}>
                    <div className="partner-card__head">
                      <span className="partner-card__avatar">
                        {partner.displayName.trim().slice(0, 1) || "ش"}
                      </span>
                      <div className="partner-card__title">
                        <h3>{partner.displayName}</h3>
                        <p>{partner.ownerName}</p>
                      </div>
                      <span className={`partner-status ${getPartnerStatusClass(partner.status)}`}>
                        {PARTNER_STATUS_LABELS[partner.status]}
                      </span>
                    </div>

                    <div className="partner-card__category">{categories}</div>

                    <dl className="partner-card__metrics">
                      <div><dt>أعضاء الفريق</dt><dd>{memberCount}</dd></div>
                      <div><dt>المساحات المرتبطة</dt><dd>{resourceCount}</dd></div>
                    </dl>

                    <div className="partner-card__contact">
                      <span>{partner.phone || "لا يوجد رقم جوال"}</span>
                      <span>{partner.email || "لا يوجد بريد إلكتروني"}</span>
                    </div>

                    <footer className="partner-card__footer">
                      <span>{activeContract ? BILLING_MODEL_LABELS[activeContract.billingModel] : "لا يوجد عقد نشط"}</span>
                      <strong>{activeContract?.contractNumber || "غير مرتبطة"}</strong>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="partner-admin-empty">
              <FontAwesomeIcon icon={faStore} />
              <h3>{search ? "لا توجد نتائج مطابقة" : "لم تتم إضافة أي شريكة"}</h3>
              <p>{search ? "غيّر عبارة البحث وحاول مجددًا." : "ابدأ بإضافة أول مستأجرة أو مالكة مساحة داخل ملكات."}</p>
              {!search ? (
                <button type="button" onClick={() => openCreateModal("partner")}>
                  <FontAwesomeIcon icon={faPlus} /> إضافة أول شريكة
                </button>
              ) : null}
            </div>
          )
        ) : activeTab === "resources" ? (
          filteredResources.length > 0 ? (
            <div className="resource-table-wrap">
              <table className="resource-table">
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
                        <div className="resource-name-cell">
                          <span><FontAwesomeIcon icon={faChair} /></span>
                          <div><strong>{resource.name}</strong><small>{resource.code}</small></div>
                        </div>
                      </td>
                      <td data-label="النوع">{RESOURCE_TYPE_LABELS[resource.type]}</td>
                      <td data-label="الموقع">{[resource.zone, resource.floor].filter(Boolean).join(" — ") || "غير محدد"}</td>
                      <td data-label="الحالة">
                        <span className={`resource-status ${getResourceStatusClass(resource.status)}`}>
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
            <div className="partner-admin-empty">
              <FontAwesomeIcon icon={faChair} />
              <h3>{search ? "لا توجد نتائج مطابقة" : "لم تتم إضافة أي مساحة"}</h3>
              <p>{search ? "غيّر عبارة البحث وحاول مجددًا." : "أضف المقاعد والغرف ومحطات العمل المتاحة للتأجير."}</p>
              {!search ? (
                <button type="button" onClick={() => openCreateModal("resource")}>
                  <FontAwesomeIcon icon={faPlus} /> إضافة أول مساحة
                </button>
              ) : null}
            </div>
          )
        ) : filteredContracts.length > 0 ? (
          <div className="partner-contract-grid">
            {filteredContracts.map((contract) => {
              const contractResources = contract.resourceIds
                .map((resourceId) => resourceById.get(resourceId))
                .filter((resource): resource is RentalResource => Boolean(resource));

              return (
                <article className="partner-contract-card" key={contract.id}>
                  <header className="partner-contract-card__head">
                    <span className="partner-contract-card__icon">
                      <FontAwesomeIcon icon={faFileContract} />
                    </span>
                    <div>
                      <small>{contract.contractNumber}</small>
                      <h3>{partnerNameById.get(contract.partnerId) || "شريكة غير معروفة"}</h3>
                    </div>
                    <span className={`contract-status ${getContractStatusClass(contract.status)}`}>
                      {CONTRACT_STATUS_LABELS[contract.status]}
                    </span>
                  </header>

                  <div className="partner-contract-card__model">
                    <FontAwesomeIcon icon={faMoneyBillTransfer} />
                    <div>
                      <small>نموذج الاتفاق</small>
                      <strong>{BILLING_MODEL_LABELS[contract.billingModel]}</strong>
                    </div>
                  </div>

                  <div className="partner-contract-card__financial">
                    <small>القيمة المالية</small>
                    <strong>{contractFinancialSummary(contract)}</strong>
                    {contract.revenueShareBasis ? (
                      <span>{REVENUE_BASIS_LABELS[contract.revenueShareBasis]}</span>
                    ) : null}
                  </div>

                  <div className="partner-contract-card__dates">
                    <div>
                      <FontAwesomeIcon icon={faCalendarDays} />
                      <span>من {formatContractDate(contract.startDate)}</span>
                    </div>
                    <div>
                      <FontAwesomeIcon icon={faCalendarDays} />
                      <span>إلى {formatContractDate(contract.endDate)}</span>
                    </div>
                  </div>

                  <div className="partner-contract-card__resources">
                    <small>المساحات المرتبطة</small>
                    <div>
                      {contractResources.length > 0 ? (
                        contractResources.map((resource) => (
                          <span key={resource.id}>{resource.code} · {resource.name}</span>
                        ))
                      ) : (
                        <span>لا توجد مساحات ظاهرة</span>
                      )}
                    </div>
                  </div>

                  <footer className="partner-contract-card__footer">
                    <span><FontAwesomeIcon icon={faClock} /> {contract.timeOffMonthlyHours ?? 0} ساعة أوف شهريًا</span>
                    <strong>{contract.timeOffMaxHoursPerRolling14Days ?? 0} ساعة / 14 يومًا</strong>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="partner-admin-empty">
            <FontAwesomeIcon icon={faFileContract} />
            <h3>{search ? "لا توجد نتائج مطابقة" : "لم يتم إنشاء أي عقد"}</h3>
            <p>{search ? "غيّر عبارة البحث وحاول مجددًا." : "أنشئ عقدًا لربط الشريكة بمساحتها ونموذج الاتفاق المالي."}</p>
            {!search && eligiblePartners.length > 0 && eligibleResources.length > 0 ? (
              <button type="button" onClick={() => openCreateModal("contract")}>
                <FontAwesomeIcon icon={faPlus} /> إنشاء أول عقد
              </button>
            ) : null}
          </div>
        )}
      </section>

      <Modal
        open={createModal === "partner"}
        onClose={closeCreateModal}
        ariaLabel="إضافة شريكة جديدة"
        size="lg"
        panelClassName="partner-admin-modal"
      >
        <form onSubmit={handleCreatePartner}>
          <header className="partner-admin-modal__header">
            <div>
              <span>NEW PARTNER</span>
              <h2>إضافة شريكة جديدة</h2>
              <p>سيتم إنشاء سجل الشريكة وإضافة المالكة تلقائيًا كأول عضو في فريقها.</p>
            </div>
            <button type="button" onClick={closeCreateModal} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="partner-admin-form-grid">
            <label>
              <span>اسم النشاط أو الاسم الظاهر *</span>
              <input
                value={partnerForm.displayName}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder="مثال: حنان بيوتي"
                required
                autoFocus
              />
            </label>
            <label>
              <span>اسم مالكة النشاط *</span>
              <input
                value={partnerForm.ownerName}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, ownerName: event.target.value }))}
                placeholder="مثال: حنان محمد"
                required
              />
            </label>
            <label>
              <span>رقم الجوال</span>
              <input
                value={partnerForm.phone}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, phone: event.target.value }))}
                placeholder="05xxxxxxxx"
                inputMode="tel"
                dir="ltr"
              />
            </label>
            <label>
              <span>البريد الإلكتروني</span>
              <input
                type="email"
                value={partnerForm.email}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="partner@example.com"
                dir="ltr"
              />
            </label>
            <label>
              <span>النشاط الأساسي</span>
              <select
                value={partnerForm.category}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, category: event.target.value as PartnerBusinessCategory }))}
              >
                {Object.entries(PARTNER_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>حالة الشريكة</span>
              <select
                value={partnerForm.status}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, status: event.target.value as PartnerStatus }))}
              >
                <option value="active">نشطة</option>
                <option value="draft">مسودة</option>
                <option value="suspended">موقوفة</option>
              </select>
            </label>
            <label className="partner-admin-field--wide">
              <span>ملاحظات داخلية</span>
              <textarea
                value={partnerForm.notes}
                onChange={(event) => setPartnerForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="أي تفاصيل أولية عن الشريكة أو النشاط..."
                rows={4}
              />
            </label>
          </div>

          <footer className="partner-admin-modal__footer">
            <button type="button" className="partner-admin-btn partner-admin-btn--secondary" onClick={closeCreateModal} disabled={saving}>
              إلغاء
            </button>
            <button type="submit" className="partner-admin-btn partner-admin-btn--primary" disabled={saving}>
              {saving ? "جاري الإنشاء..." : "إنشاء الشريكة"}
            </button>
          </footer>
        </form>
      </Modal>

      <Modal
        open={createModal === "resource"}
        onClose={closeCreateModal}
        ariaLabel="إضافة مساحة عمل"
        size="lg"
        panelClassName="partner-admin-modal"
      >
        <form onSubmit={handleCreateResource}>
          <header className="partner-admin-modal__header">
            <div>
              <span>NEW WORKSPACE</span>
              <h2>إضافة مقعد أو مساحة</h2>
              <p>أنشئ المساحة الآن، ثم اربطها بالشريكة من خلال عقد التشغيل.</p>
            </div>
            <button type="button" onClick={closeCreateModal} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="partner-admin-form-grid">
            <label>
              <span>رمز المساحة *</span>
              <input
                value={resourceForm.code}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
                placeholder="مثال: H-01"
                required
                autoFocus
                dir="ltr"
              />
            </label>
            <label>
              <span>اسم المساحة *</span>
              <input
                value={resourceForm.name}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="مثال: مقعد الاستشوار الأول"
                required
              />
            </label>
            <label>
              <span>نوع المساحة</span>
              <select
                value={resourceForm.type}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, type: event.target.value as RentalResourceType }))}
              >
                {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>الحالة الأولية</span>
              <select
                value={resourceForm.status}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, status: event.target.value as RentalResourceStatus }))}
              >
                <option value="available">متاحة</option>
                <option value="reserved">محجوزة</option>
                <option value="maintenance">صيانة</option>
                <option value="inactive">غير نشطة</option>
              </select>
            </label>
            <label>
              <span>المنطقة داخل الصالون</span>
              <input
                value={resourceForm.zone}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, zone: event.target.value }))}
                placeholder="مثال: قسم الشعر"
              />
            </label>
            <label>
              <span>الدور أو الموقع</span>
              <input
                value={resourceForm.floor}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, floor: event.target.value }))}
                placeholder="مثال: الدور الأرضي"
              />
            </label>
            <label className="partner-admin-field--wide">
              <span>وصف المساحة</span>
              <textarea
                value={resourceForm.description}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="الموقع، المقاس، والخدمات المتوفرة للمساحة..."
                rows={3}
              />
            </label>
            <label className="partner-admin-field--wide">
              <span>التجهيزات المسلّمة</span>
              <textarea
                value={resourceForm.equipmentNotes}
                onChange={(event) => setResourceForm((prev) => ({ ...prev, equipmentNotes: event.target.value }))}
                placeholder="كرسي، مرآة، درج، جهاز، إضاءة..."
                rows={3}
              />
            </label>
          </div>

          <footer className="partner-admin-modal__footer">
            <button type="button" className="partner-admin-btn partner-admin-btn--secondary" onClick={closeCreateModal} disabled={saving}>
              إلغاء
            </button>
            <button type="submit" className="partner-admin-btn partner-admin-btn--dark" disabled={saving}>
              {saving ? "جاري الإنشاء..." : "إنشاء المساحة"}
            </button>
          </footer>
        </form>
      </Modal>

      <Modal
        open={createModal === "contract"}
        onClose={closeCreateModal}
        ariaLabel="إنشاء عقد شريكة"
        size="lg"
        panelClassName="partner-admin-modal partner-contract-modal"
      >
        <form onSubmit={handleCreateContract}>
          <header className="partner-admin-modal__header">
            <div>
              <span>NEW CONTRACT</span>
              <h2>إنشاء عقد وربط المساحات</h2>
              <p>العقد والمساحات المحددة تحفظ في عملية واحدة، لمنع أي ربط مالي أو تشغيلي ناقص.</p>
            </div>
            <button type="button" onClick={closeCreateModal} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="partner-admin-form-grid partner-contract-form">
            <div className="partner-admin-form-section partner-admin-field--wide">
              <FontAwesomeIcon icon={faFileContract} />
              <div><strong>بيانات العقد</strong><span>الشريكة، رقم العقد، والحالة الزمنية.</span></div>
            </div>

            <label>
              <span>الشريكة *</span>
              <select
                value={contractForm.partnerId}
                onChange={(event) => {
                  const partnerId = event.target.value;
                  const selectedPartner = partners.find((partner) => partner.id === partnerId);
                  setContractForm((prev) => ({
                    ...prev,
                    partnerId,
                    status: selectedPartner?.status === "draft" ? "draft" : prev.status,
                  }));
                }}
                required
                autoFocus
              >
                <option value="">اختر الشريكة</option>
                {eligiblePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.displayName} — {PARTNER_STATUS_LABELS[partner.status]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>رقم العقد *</span>
              <input
                value={contractForm.contractNumber}
                onChange={(event) => setContractForm((prev) => ({ ...prev, contractNumber: event.target.value.toUpperCase() }))}
                required
                dir="ltr"
              />
            </label>

            <label>
              <span>حالة العقد</span>
              <select
                value={contractForm.status}
                onChange={(event) => setContractForm((prev) => ({ ...prev, status: event.target.value as "draft" | "active" }))}
              >
                <option value="active">نشط — المساحات تصبح مؤجرة</option>
                <option value="draft">مسودة — المساحات تصبح محجوزة</option>
              </select>
            </label>

            <label>
              <span>نموذج الاتفاق المالي</span>
              <select
                value={contractForm.billingModel}
                onChange={(event) => setContractForm((prev) => ({ ...prev, billingModel: event.target.value as PartnerBillingModel }))}
              >
                {Object.entries(BILLING_MODEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>تاريخ البداية *</span>
              <input
                type="date"
                value={contractForm.startDate}
                onChange={(event) => setContractForm((prev) => ({ ...prev, startDate: event.target.value }))}
                required
              />
            </label>

            <label>
              <span>تاريخ النهاية</span>
              <input
                type="date"
                min={contractForm.startDate || undefined}
                value={contractForm.endDate}
                onChange={(event) => setContractForm((prev) => ({ ...prev, endDate: event.target.value }))}
              />
            </label>

            <div className="partner-admin-form-section partner-admin-field--wide">
              <FontAwesomeIcon icon={faChair} />
              <div><strong>المقاعد والمساحات</strong><span>اختر مساحة واحدة أو عدة مساحات ضمن العقد نفسه.</span></div>
            </div>

            <div className="partner-resource-picker partner-admin-field--wide">
              {eligibleResources.length > 0 ? (
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
                      <span className="partner-resource-picker__check">
                        {selected ? <FontAwesomeIcon icon={faCircleCheck} /> : <FontAwesomeIcon icon={faChair} />}
                      </span>
                      <div>
                        <strong>{resource.name}</strong>
                        <small>{resource.code} · {RESOURCE_TYPE_LABELS[resource.type]}</small>
                      </div>
                      <em>{RESOURCE_STATUS_LABELS[resource.status]}</em>
                    </button>
                  );
                })
              ) : (
                <div className="partner-resource-picker__empty">لا توجد مساحة متاحة للربط حاليًا.</div>
              )}
            </div>

            <div className="partner-admin-form-section partner-admin-field--wide">
              <FontAwesomeIcon icon={faMoneyBillTransfer} />
              <div><strong>الشروط المالية</strong><span>تظهر الحقول المناسبة حسب نموذج الاتفاق.</span></div>
            </div>

            {(contractForm.billingModel === "fixed_rent" || contractForm.billingModel === "hybrid") ? (
              <label>
                <span>الإيجار الثابت بالريال *</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.fixedRentAmount}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, fixedRentAmount: event.target.value }))}
                  placeholder="مثال: 1500"
                  required
                />
              </label>
            ) : null}

            {contractForm.billingModel === "hourly" ? (
              <label>
                <span>سعر الساعة بالريال *</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.hourlyRate}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, hourlyRate: event.target.value }))}
                  required
                />
              </label>
            ) : null}

            {contractForm.billingModel === "daily" ? (
              <label>
                <span>سعر اليوم بالريال *</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={contractForm.dailyRate}
                  onChange={(event) => setContractForm((prev) => ({ ...prev, dailyRate: event.target.value }))}
                  required
                />
              </label>
            ) : null}

            {(contractForm.billingModel === "revenue_share" || contractForm.billingModel === "hybrid") ? (
              <>
                <label>
                  <span>نسبة الشريكة % *</span>
                  <div className="partner-admin-input-icon">
                    <FontAwesomeIcon icon={faPercent} />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={contractForm.partnerSharePercent}
                      onChange={(event) => updatePartnerShare(event.target.value)}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>نسبة ملكات % *</span>
                  <div className="partner-admin-input-icon">
                    <FontAwesomeIcon icon={faPercent} />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={contractForm.salonSharePercent}
                      onChange={(event) => setContractForm((prev) => ({ ...prev, salonSharePercent: event.target.value }))}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>أساس احتساب النسبة</span>
                  <select
                    value={contractForm.revenueShareBasis}
                    onChange={(event) => setContractForm((prev) => ({ ...prev, revenueShareBasis: event.target.value as RevenueShareBasis }))}
                  >
                    {Object.entries(REVENUE_BASIS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>الحد الأدنى لحصة ملكات</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contractForm.minimumSalonShareAmount}
                    onChange={(event) => setContractForm((prev) => ({ ...prev, minimumSalonShareAmount: event.target.value }))}
                    placeholder="اختياري"
                  />
                </label>
              </>
            ) : null}

            <label>
              <span>مبلغ التأمين</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={contractForm.depositAmount}
                onChange={(event) => setContractForm((prev) => ({ ...prev, depositAmount: event.target.value }))}
                placeholder="اختياري"
              />
            </label>

            <label>
              <span>يوم الاستحقاق الشهري</span>
              <input
                type="number"
                min="1"
                max="28"
                step="1"
                value={contractForm.paymentDueDay}
                onChange={(event) => setContractForm((prev) => ({ ...prev, paymentDueDay: event.target.value }))}
              />
            </label>

            <div className="partner-admin-form-section partner-admin-field--wide">
              <FontAwesomeIcon icon={faClock} />
              <div><strong>سياسة ساعات الأوف</strong><span>تُحفظ من الآن داخل العقد لتطبيقها على فريق الشريكة لاحقًا.</span></div>
            </div>

            <label>
              <span>الرصيد الشهري بالساعات</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={contractForm.timeOffMonthlyHours}
                onChange={(event) => setContractForm((prev) => ({ ...prev, timeOffMonthlyHours: event.target.value }))}
              />
            </label>

            <label>
              <span>الحد الأقصى خلال 14 يومًا</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={contractForm.timeOffMaxHoursPerRolling14Days}
                onChange={(event) => setContractForm((prev) => ({ ...prev, timeOffMaxHoursPerRolling14Days: event.target.value }))}
              />
            </label>

            <label className="partner-admin-field--wide">
              <span>ملاحظات العقد</span>
              <textarea
                value={contractForm.notes}
                onChange={(event) => setContractForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="الشروط الخاصة، التجهيزات، أو أي ملاحظات تعاقدية..."
                rows={4}
              />
            </label>
          </div>

          <div className="partner-contract-summary">
            <div><span>المساحات المحددة</span><strong>{contractForm.resourceIds.length}</strong></div>
            <div><span>نموذج الاتفاق</span><strong>{BILLING_MODEL_LABELS[contractForm.billingModel]}</strong></div>
            <div><span>حالة الربط</span><strong>{contractForm.status === "active" ? "مؤجرة فورًا" : "محجوزة كمسودة"}</strong></div>
          </div>

          <footer className="partner-admin-modal__footer">
            <button type="button" className="partner-admin-btn partner-admin-btn--secondary" onClick={closeCreateModal} disabled={saving}>
              إلغاء
            </button>
            <button
              type="submit"
              className="partner-admin-btn partner-admin-btn--contract"
              disabled={saving || contractForm.resourceIds.length === 0}
            >
              {saving ? "جاري حفظ العقد والربط..." : "إنشاء العقد وربط المساحات"}
            </button>
          </footer>
        </form>
      </Modal>
    </div>
  );
}
