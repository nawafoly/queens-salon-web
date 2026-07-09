import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faBriefcase,
  faBuilding,
  faChair,
  faCircleCheck,
  faCircleExclamation,
  faMagnifyingGlass,
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
  PartnerBusinessCategory,
  PartnerContract,
  PartnerMember,
  PartnerStatus,
  RentalResource,
  RentalResourceStatus,
  RentalResourceType,
} from "../types/partner";
import "../styles/AdminDashboardPartners.css";

type ActiveTab = "partners" | "resources";
type CreateModal = "partner" | "resource" | null;

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

function normalizeSearch(value: unknown) {
  return String(value || "").trim().toLowerCase();
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
  if (message.includes("revenue_shares_must_equal_100")) {
    return "مجموع نسبة الشريكة ونسبة الصالون يجب أن يساوي 100%.";
  }

  return message || "حدث خطأ غير متوقع. حاول مرة أخرى.";
}

function getPartnerStatusClass(status: PartnerStatus) {
  return `is-${status}`;
}

function getResourceStatusClass(status: RentalResourceStatus) {
  return `is-${status}`;
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
    const timeout = window.setTimeout(() => setSuccessMessage(""), 4500);
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

  const partnerNameById = useMemo(() => {
    const map = new Map<string, string>();
    partners.forEach((partner) => map.set(partner.id, partner.displayName));
    return map;
  }, [partners]);

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

  const openCreateModal = (modal: Exclude<CreateModal, null>) => {
    setError("");
    setSuccessMessage("");
    if (modal === "partner") setPartnerForm(EMPTY_PARTNER_FORM);
    if (modal === "resource") setResourceForm(EMPTY_RESOURCE_FORM);
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
      const actorUid = auth.currentUser?.uid;
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
        actorUid
      );

      setCreateModal(null);
      setSuccessMessage(`تم إنشاء الشريكة «${partnerForm.displayName.trim()}» وإضافة المالكة إلى فريقها.`);
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

  return (
    <div className="partner-admin-page" dir="rtl">
      <header className="partner-admin-hero">
        <div className="partner-admin-hero__copy">
          <span className="partner-admin-kicker">PARTNER WORKSPACE</span>
          <h1>الشريكات ومساحات العمل</h1>
          <p>
            إدارة المستأجرات، فرقهن، والمقاعد والمساحات المؤجرة من نقطة واحدة. الربط بالعقود
            والنسب المالية سيظهر في المرحلة التالية.
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
              onClick={() => setActiveTab("partners")}
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
              onClick={() => setActiveTab("resources")}
              role="tab"
              aria-selected={activeTab === "resources"}
            >
              <FontAwesomeIcon icon={faChair} />
              المقاعد والمساحات
              <span>{resources.length}</span>
            </button>
          </div>

          <label className="partner-admin-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={activeTab === "partners" ? "بحث باسم الشريكة أو المالكة..." : "بحث بالرمز أو اسم المساحة..."}
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
                      <span>العقد والربط المالي</span>
                      <strong>المرحلة التالية</strong>
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
        ) : filteredResources.length > 0 ? (
          <div className="resource-table-wrap">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>المساحة</th>
                  <th>النوع</th>
                  <th>الموقع</th>
                  <th>الحالة</th>
                  <th>الشريكة الحالية</th>
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
              <p>أنشئ المساحة الآن، وسيتم ربطها بالشريكة عن طريق العقد في المرحلة التالية.</p>
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
    </div>
  );
}
