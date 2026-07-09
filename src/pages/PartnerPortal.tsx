import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faBriefcase,
  faBuilding,
  faCalendarDays,
  faChair,
  faClock,
  faFileContract,
  faRightFromBracket,
  faShieldHalved,
  faStore,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import { auth } from "../services/firebase";
import { PartnerPortalService } from "../services/partnerPortalService";
import type {
  PartnerContract,
  PartnerPortalOverview,
  RentalResource,
} from "../types/partner";
import "../styles/PartnerPortal.css";

const CONTRACT_LABELS: Record<string, string> = {
  draft: "مسودة",
  active: "نشط",
  expired: "منتهي",
  terminated: "مُنهي",
  cancelled: "ملغي",
};

const RESOURCE_LABELS: Record<string, string> = {
  hair_station: "مقعد شعر واستشوار",
  makeup_station: "محطة مكياج",
  manicure_station: "طاولة مناكير",
  pedicure_station: "كرسي بديكير",
  lash_bed: "سرير رموش",
  private_room: "غرفة خاصة",
  retail_space: "مساحة بيع",
  custom: "مساحة مخصصة",
};

function formatDate(value?: string) {
  if (!value) return "مفتوح";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date);
}

function financialSummary(contract: PartnerContract) {
  if (contract.billingModel === "revenue_share") {
    return `${contract.partnerSharePercent ?? 0}% للشريكة`;
  }
  if (contract.billingModel === "hybrid") {
    return `${contract.fixedRentAmount ?? 0} ر.س + ${contract.partnerSharePercent ?? 0}%`;
  }
  if (contract.billingModel === "fixed_rent") return `${contract.fixedRentAmount ?? 0} ر.س شهريًا`;
  if (contract.billingModel === "hourly") return `${contract.hourlyRate ?? 0} ر.س / ساعة`;
  if (contract.billingModel === "daily") return `${contract.dailyRate ?? 0} ر.س / يوم`;
  return "—";
}

export default function PartnerPortal() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<PartnerPortalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadOverview = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await PartnerPortalService.getOverview();
      setOverview(data);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError || "");
      if (message.includes("partner_auth:login_required")) {
        navigate("/partner/login", { replace: true });
        return;
      }
      setError(
        message.includes("Failed to fetch")
          ? "تعذر الاتصال بخدمة الشريكات. تأكدي أن الخدمة تعمل."
          : "تعذر تحميل بوابة الشريكة. أعيدي المحاولة أو تواصلي مع الإدارة."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let alive = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!alive) return;
      if (!user) {
        navigate("/partner/login", { replace: true });
        return;
      }
      void loadOverview();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const activeContract = useMemo(
    () => overview?.contracts.find((contract) => contract.status === "active") || overview?.contracts[0],
    [overview]
  );

  const handleLogout = async () => {
    await signOut(auth).catch(() => undefined);
    navigate("/partner/login", { replace: true });
  };

  if (loading) {
    return (
      <main className="partner-portal-page" dir="rtl">
        <div className="partner-portal-loading">جاري تجهيز بوابة الشريكة...</div>
      </main>
    );
  }

  return (
    <main className="partner-portal-page" dir="rtl">
      <header className="partner-portal-topbar">
        <div>
          <span className="partner-portal-logo"><FontAwesomeIcon icon={faBuilding} /></span>
          <div>
            <small>MALIKAT PARTNERS</small>
            <strong>{overview?.partner.displayName || "بوابة الشريكات"}</strong>
          </div>
        </div>
        <div className="partner-portal-topbar__actions">
          <button type="button" onClick={() => void loadOverview(true)} disabled={refreshing}>
            <FontAwesomeIcon icon={faArrowRotateRight} spin={refreshing} /> تحديث
          </button>
          <button type="button" onClick={handleLogout}>
            <FontAwesomeIcon icon={faRightFromBracket} /> خروج
          </button>
        </div>
      </header>

      <section className="partner-portal-hero">
        <div>
          <span className="partner-portal-chip"><FontAwesomeIcon icon={faShieldHalved} /> حساب شريكة موثق</span>
          <h1>أهلًا {overview?.member.displayName || "بك"}</h1>
          <p>
            هنا تظهر بيانات نشاطك، عقدك، المساحات المرتبطة بك، وفريق العمل المسجل تحت حسابك.
          </p>
        </div>
        <div className="partner-portal-hero__status">
          <small>حالة النشاط</small>
          <strong>{overview?.partner.status === "active" ? "نشط" : "قيد التجهيز"}</strong>
        </div>
      </section>

      {error ? <div className="partner-portal-error">{error}</div> : null}

      {overview ? (
        <>
          <section className="partner-portal-stats">
            <article><FontAwesomeIcon icon={faChair} /><div><small>المساحات</small><strong>{overview.resources.length}</strong></div></article>
            <article><FontAwesomeIcon icon={faUsers} /><div><small>أعضاء الفريق</small><strong>{overview.team.filter((member) => member.status === "active").length}</strong></div></article>
            <article><FontAwesomeIcon icon={faFileContract} /><div><small>العقود</small><strong>{overview.contracts.length}</strong></div></article>
            <article><FontAwesomeIcon icon={faClock} /><div><small>رصيد الأوف</small><strong>{activeContract?.timeOffMonthlyHours ?? 0} ساعة</strong></div></article>
          </section>

          <section className="partner-portal-grid">
            <article className="partner-portal-card partner-portal-card--contract">
              <header><FontAwesomeIcon icon={faBriefcase} /><div><small>العقد الحالي</small><h2>{activeContract?.contractNumber || "لا يوجد عقد"}</h2></div></header>
              {activeContract ? (
                <div className="partner-portal-contract-body">
                  <div><span>الحالة</span><strong>{CONTRACT_LABELS[activeContract.status] || activeContract.status}</strong></div>
                  <div><span>الفترة</span><strong>{formatDate(activeContract.startDate)} — {formatDate(activeContract.endDate)}</strong></div>
                  {overview.permissions.canViewFinancials ? (
                    <div><span>الاتفاق المالي</span><strong>{financialSummary(activeContract)}</strong></div>
                  ) : null}
                  <div><span>الأوف</span><strong>{activeContract.timeOffMaxHoursPerRolling14Days ?? 0} ساعة لكل 14 يومًا</strong></div>
                </div>
              ) : <p className="partner-portal-muted">لم يتم ربط عقد بهذا الحساب بعد.</p>}
            </article>

            <article className="partner-portal-card">
              <header><FontAwesomeIcon icon={faStore} /><div><small>المساحات المؤجرة</small><h2>موقع العمل</h2></div></header>
              <div className="partner-portal-resource-list">
                {overview.resources.length ? overview.resources.map((resource: RentalResource) => (
                  <div key={resource.id}>
                    <span><FontAwesomeIcon icon={faChair} /></span>
                    <div><strong>{resource.name}</strong><small>{resource.code} · {RESOURCE_LABELS[resource.type] || resource.type}</small></div>
                    <em>{resource.zone || resource.floor || "داخل الصالون"}</em>
                  </div>
                )) : <p className="partner-portal-muted">لا توجد مساحة مرتبطة حاليًا.</p>}
              </div>
            </article>

            <article className="partner-portal-card partner-portal-card--team">
              <header><FontAwesomeIcon icon={faUsers} /><div><small>فريق العمل</small><h2>الأعضاء المسجلون</h2></div></header>
              <div className="partner-portal-team-list">
                {overview.team.map((member) => (
                  <div key={member.id}>
                    <span>{member.displayName.slice(0, 1)}</span>
                    <div><strong>{member.displayName}</strong><small>{member.memberType === "owner" ? "مالكة النشاط" : member.memberType === "contractor" ? "متعاقدة" : "موظفة"}</small></div>
                    <em className={member.status === "active" ? "is-active" : ""}>{member.status === "active" ? "نشطة" : "غير نشطة"}</em>
                  </div>
                ))}
              </div>
            </article>

            <article className="partner-portal-card partner-portal-card--permissions">
              <header><FontAwesomeIcon icon={faWallet} /><div><small>صلاحيات الحساب</small><h2>نطاق الوصول</h2></div></header>
              <ul>
                <li className={overview.permissions.canViewFinancials ? "is-enabled" : ""}>عرض البيانات المالية</li>
                <li className={overview.permissions.canManageTeam ? "is-enabled" : ""}>إدارة فريق العمل</li>
                <li className={overview.permissions.canManageInventory ? "is-enabled" : ""}>إدارة المخزون</li>
                <li className={overview.permissions.canWorkAsProvider ? "is-enabled" : ""}>تنفيذ الخدمات</li>
              </ul>
            </article>
          </section>

          <footer className="partner-portal-footer">
            <FontAwesomeIcon icon={faCalendarDays} /> المرحلة الحالية تعرض العقد والفريق والمساحات. الحجوزات والمستحقات والمخزون ستُربط في المراحل التالية.
          </footer>
        </>
      ) : null}
    </main>
  );
}
