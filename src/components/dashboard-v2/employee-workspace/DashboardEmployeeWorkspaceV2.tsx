import { useEffect, useMemo, useState } from "react";
import {
  DashboardConfirmV2,
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
  DashboardToastProviderV2,
  useDashboardToastV2,
} from "../index";
import "../../../styles/dashboard-v2/pages/employee-workspace.css";
import { BasicTabV2, ProfileTabV2, ServicesTabV2 } from "./EmployeeWorkspaceProfileTabsV2";
import { AttendanceTabV2, ScheduleTabV2, ShiftsTabV2 } from "./EmployeeWorkspaceTimeTabsV2";
import { LeavesTabV2, PayrollTabV2, RequestsTabV2 } from "./EmployeeWorkspacePeopleTabsV2";
import { FilesTabV2, MessagesTabV2 } from "./EmployeeWorkspaceCommunicationTabsV2";
import {
  EMPLOYEE_WORKSPACE_TABS,
  type EmployeeWorkspaceConfirmState,
  type EmployeeWorkspaceDialogId,
  type EmployeeWorkspaceDisplayState,
  type EmployeeWorkspaceDrawerId,
  type EmployeeWorkspaceTabId,
  type EmployeeWorkspaceTabProps,
} from "./types";
import {
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
} from "./EmployeeWorkspacePrimitivesV2";

function EmployeeWorkspaceContentV2() {
  const [activeTab, setActiveTab] = useState<EmployeeWorkspaceTabId>("basic");
  const [readOnly, setReadOnly] = useState(false);
  const [displayState, setDisplayState] = useState<EmployeeWorkspaceDisplayState>("ready");
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<EmployeeWorkspaceDialogId>(null);
  const [drawer, setDrawer] = useState<EmployeeWorkspaceDrawerId>(null);
  const [confirm, setConfirm] = useState<EmployeeWorkspaceConfirmState>(null);
  const { pushToast } = useDashboardToastV2();

  const activeDefinition = useMemo(
    () => EMPLOYEE_WORKSPACE_TABS.find((tab) => tab.id === activeTab) ?? EMPLOYEE_WORKSPACE_TABS[0],
    [activeTab],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const markDirty = () => {
    if (!readOnly) setDirty(true);
  };

  const changeTab = (nextTab: EmployeeWorkspaceTabId) => {
    if (nextTab === activeTab) return;
    if (dirty) {
      setConfirm({
        title: "الانتقال مع وجود تعديلات؟",
        description: "التعديلات غير المحفوظة ستبقى داخل نموذج المعاينة، لكن الأفضل حفظها قبل الانتقال.",
        confirmLabel: "الانتقال",
        tone: "gold",
        detail: <strong>من {activeDefinition.label} إلى {EMPLOYEE_WORKSPACE_TABS.find((tab) => tab.id === nextTab)?.label}</strong>,
        onConfirm: () => setActiveTab(nextTab),
      });
      return;
    }
    setActiveTab(nextTab);
  };

  const save = () => {
    if (readOnly || !dirty) return;
    setDirty(false);
    pushToast({
      tone: "success",
      title: "تم حفظ نموذج ملف الموظفة",
      description: `حُفظت التعديلات التجريبية في تبويب ${activeDefinition.label}.`,
    });
  };

  const reset = () => {
    setConfirm({
      title: "التراجع عن التعديلات؟",
      description: "سيعود نموذج التبويب إلى آخر حالة محفوظة داخل صفحة المعاينة.",
      confirmLabel: "تجاهل التعديلات",
      tone: "danger",
      onConfirm: () => {
        setDirty(false);
        pushToast({ tone: "info", title: "تم تجاهل التعديلات", description: "عاد النموذج إلى آخر حالة محفوظة." });
      },
    });
  };

  const tabProps: EmployeeWorkspaceTabProps = {
    readOnly,
    markDirty,
    openDialog: setDialog,
    openDrawer: setDrawer,
    requestConfirm: setConfirm,
  };

  const renderTab = () => {
    switch (activeTab) {
      case "basic": return <BasicTabV2 {...tabProps} />;
      case "profile": return <ProfileTabV2 {...tabProps} />;
      case "services": return <ServicesTabV2 {...tabProps} />;
      case "schedule": return <ScheduleTabV2 {...tabProps} />;
      case "shifts": return <ShiftsTabV2 {...tabProps} />;
      case "attendance": return <AttendanceTabV2 {...tabProps} />;
      case "payroll": return <PayrollTabV2 {...tabProps} />;
      case "requests": return <RequestsTabV2 {...tabProps} />;
      case "leaves": return <LeavesTabV2 {...tabProps} />;
      case "messages": return <MessagesTabV2 {...tabProps} />;
      case "files": return <FilesTabV2 {...tabProps} />;
      default: return null;
    }
  };

  return (
    <section className="dsv2-page dsv2-employee-workspace" dir="rtl" aria-labelledby="dsv2-ew-title">
      <header className="dsv2-ew-intro">
        <div>
          <span className="dsv2-ew-intro__eyebrow">مرحلة الاعتماد داخل نظام التصميم</span>
          <h1 id="dsv2-ew-title">واجهة ملف الموظفة الداخلي V2</h1>
          <p>نموذج تفاعلي مستقل يجمع التبويبات الأحد عشر قبل ربطه بصفحة الموظفات التشغيلية.</p>
        </div>
        <div className="dsv2-cluster">
          <WorkspaceStatusBadgeV2 tone="success">معزول عن صفحة الموظفات</WorkspaceStatusBadgeV2>
          <WorkspaceStatusBadgeV2 tone="gold">جاهز للمراجعة البصرية</WorkspaceStatusBadgeV2>
        </div>
      </header>

      <section className="dsv2-card dsv2-card--padded dsv2-ew-preview-controls" aria-label="أدوات معاينة الحالات">
        <div className="dsv2-ew-preview-controls__copy">
          <strong>أدوات المعاينة</strong>
          <span>اختبر الصلاحيات وحالات التحميل والفراغ والخطأ من دون تغيير بيانات تشغيلية.</span>
        </div>
        <div className="dsv2-ew-preview-controls__fields">
          <DashboardFieldV2 id="dsv2-ew-permission-mode" label="وضع الصلاحية">
            <DashboardSelectV2
              id="dsv2-ew-permission-mode"
              value={readOnly ? "read-only" : "edit"}
              options={[{ value: "edit", label: "تعديل كامل" }, { value: "read-only", label: "عرض فقط" }]}
              onChange={(value) => {
                setReadOnly(value === "read-only");
                if (value === "read-only") setDirty(false);
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-display-state" label="حالة الصفحة">
            <DashboardSelectV2
              id="dsv2-ew-display-state"
              value={displayState}
              options={[
                { value: "ready", label: "جاهزة" },
                { value: "loading", label: "تحميل" },
                { value: "empty", label: "ملف فارغ" },
                { value: "error", label: "خطأ" },
              ]}
              onChange={(value) => setDisplayState(value as EmployeeWorkspaceDisplayState)}
            />
          </DashboardFieldV2>
        </div>
      </section>

      <section className="dsv2-card dsv2-card--padded dsv2-ew-profile-head">
        <div className="dsv2-ew-profile-head__identity">
          <div className="dsv2-ew-avatar" aria-label="صورة وسام عداوي">و</div>
          <div>
            <div className="dsv2-ew-profile-head__name-row">
              <h2>وسام عداوي</h2>
              <WorkspaceStatusBadgeV2 tone="success">نشطة</WorkspaceStatusBadgeV2>
              {readOnly ? <WorkspaceStatusBadgeV2>عرض فقط</WorkspaceStatusBadgeV2> : null}
            </div>
            <p>أخصائية شعر · الرقم الوظيفي 1001 · تاريخ التوظيف 15 مايو 2025</p>
            <div className="dsv2-ew-profile-head__meta">
              <span>الفرع الرئيسي</span><span>الشفت الصباحي</span><span>الجمعة إجازة أسبوعية</span>
            </div>
          </div>
        </div>
        <div className="dsv2-ew-profile-head__summary">
          <WorkspaceMetricV2 label="اكتمال الملف" value="92٪" tone="gold" />
          <WorkspaceMetricV2 label="الخدمات" value="4" tone="success" />
          <WorkspaceMetricV2 label="التقييم" value="4.8" />
        </div>
      </section>

      <nav className="dsv2-ew-tabs" aria-label="تبويبات ملف الموظفة">
        {EMPLOYEE_WORKSPACE_TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            className="dsv2-ew-tab"
            data-active={activeTab === tab.id ? "true" : "false"}
            aria-current={activeTab === tab.id ? "page" : undefined}
            onClick={() => changeTab(tab.id)}
          >
            <span className="dsv2-ew-tab__number">{index + 1}</span>
            <span className="dsv2-ew-tab__label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="dsv2-ew-mobile-tab-select">
        <DashboardFieldV2 id="dsv2-ew-active-tab" label="التبويب الحالي">
          <DashboardSelectV2
            id="dsv2-ew-active-tab"
            value={activeTab}
            options={EMPLOYEE_WORKSPACE_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
            onChange={(value) => changeTab(value as EmployeeWorkspaceTabId)}
          />
        </DashboardFieldV2>
      </div>

      <div className="dsv2-ew-content" aria-live="polite">
        {displayState === "ready" ? renderTab() : null}
        {displayState === "loading" ? (
          <section className="dsv2-card dsv2-card--padded dsv2-ew-page-skeleton" aria-label="جارٍ تحميل ملف الموظفة">
            <div className="dsv2-ew-page-skeleton__head">
              <DashboardSkeletonV2 variant="circle" />
              <div><DashboardSkeletonV2 variant="title" width="62%" /><DashboardSkeletonV2 lines={2} /></div>
            </div>
            <div className="dsv2-ew-page-skeleton__grid">
              <DashboardSkeletonV2 variant="block" height={180} />
              <DashboardSkeletonV2 variant="block" height={180} />
              <DashboardSkeletonV2 variant="block" height={180} />
            </div>
          </section>
        ) : null}
        {displayState === "empty" ? (
          <DashboardEmptyStateV2
            title="ملف الموظفة غير مكتمل"
            description="أضيفي البيانات الأساسية أولًا، ثم انتقلي بين التبويبات لاستكمال الملف."
            tone="gold"
            action={<button type="button" className="dsv2-btn dsv2-btn--accent" onClick={() => { setDisplayState("ready"); setActiveTab("basic"); }}>بدء إدخال البيانات</button>}
          />
        ) : null}
        {displayState === "error" ? (
          <DashboardErrorStateV2
            title="تعذر تحميل ملف الموظفة"
            description="لم يستجب مصدر البيانات. لم يتم تعديل أي معلومات محفوظة."
            details="تعذر تحميل نموذج مساحة الموظفة"
            action={<button type="button" className="dsv2-btn dsv2-btn--danger" onClick={() => setDisplayState("ready")}>إعادة المحاولة</button>}
          />
        ) : null}
      </div>

      <footer className="dsv2-ew-savebar" data-dirty={dirty ? "true" : "false"}>
        <div className="dsv2-ew-savebar__status">
          <span className="dsv2-ew-savebar__dot" aria-hidden="true" />
          <div>
            <strong>{readOnly ? "وضع العرض فقط" : dirty ? "توجد تعديلات غير محفوظة" : "جميع التعديلات محفوظة"}</strong>
            <small>{readOnly ? "لا يمكن الحفظ بهذه الصلاحية." : dirty ? `التعديلات الحالية في تبويب ${activeDefinition.label}.` : "آخر حفظ تجريبي: الآن"}</small>
          </div>
        </div>
        <div className="dsv2-ew-savebar__actions">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly || !dirty} onClick={reset}>تراجع</button>
          <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={readOnly || !dirty} onClick={save}>حفظ التغييرات</button>
        </div>
      </footer>

      <DashboardModalV2
        open={dialog === "image"}
        onClose={() => setDialog(null)}
        title="اختيار صورة الموظفة"
        description="رفع صورة جديدة أو إدخال رابط آمن مع معاينة قبل الاعتماد."
        eyebrow="الملف والصورة"
        size="md"
        tone="gold"
        footer={<><button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => { setDialog(null); markDirty(); }}>اعتماد الصورة</button><button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDialog(null)}>إلغاء</button></>}
      >
        <div className="dsv2-ew-dialog-grid">
          <button type="button" className="dsv2-ew-dropzone"><span className="dsv2-ew-dropzone__icon">↑</span><strong>اختيار صورة من الجهاز</strong><small>صورة مربعة واضحة حتى 5 ميجابايت</small></button>
          <DashboardFieldV2 id="dsv2-ew-dialog-image-url" label="رابط الصورة"><input id="dsv2-ew-dialog-image-url" className="dsv2-input" dir="ltr" placeholder="https://" /></DashboardFieldV2>
          <WorkspaceNoticeV2 title="معاينة آمنة" description="لن تُحفظ الصورة إلا بعد الضغط على اعتماد الصورة." tone="neutral" />
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={dialog === "shift"}
        onClose={() => setDialog(null)}
        title="إضافة شفت أو استثناء"
        description="تحديد نوع التغيير والتاريخ والقالب أو الوقت المخصص."
        eyebrow="الشفتات"
        size="lg"
        tone="gold"
        footer={<><button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => { setDialog(null); markDirty(); }}>حفظ كمسودة</button><button type="button" className="dsv2-btn dsv2-btn--success" onClick={() => { setDialog(null); markDirty(); }}>نشر التغيير</button><button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDialog(null)}>إلغاء</button></>}
      >
        <div className="dsv2-ew-dialog-grid dsv2-ew-dialog-grid--2">
          <DashboardFieldV2 id="dsv2-ew-dialog-shift-type" label="نوع التغيير"><DashboardSelectV2 id="dsv2-ew-dialog-shift-type" defaultValue="alternate" options={[{ value: "rest", label: "يوم راحة" }, { value: "alternate", label: "شفت بديل" }, { value: "custom", label: "وقت مخصص" }]} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-shift-date" label="التاريخ"><DashboardDatePickerV2 id="dsv2-ew-dialog-shift-date" defaultValue="2026-08-23" /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-shift-template" label="القالب"><DashboardSelectV2 id="dsv2-ew-dialog-shift-template" defaultValue="evening" options={[{ value: "morning", label: "الشفت الصباحي" }, { value: "evening", label: "الشفت المسائي" }, { value: "night", label: "الشفت الليلي" }]} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-shift-reason" label="السبب"><input id="dsv2-ew-dialog-shift-reason" className="dsv2-input" placeholder="سبب التغيير" /></DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={dialog === "attendance"}
        onClose={() => setDialog(null)}
        title="تعديل بصمة الحضور"
        description="التعديل يحتاج سببًا واضحًا ويظهر في سجل مراجعة اليوم."
        eyebrow="الحضور"
        size="md"
        tone="danger"
        footer={<><button type="button" className="dsv2-btn dsv2-btn--danger" onClick={() => { setDialog(null); markDirty(); }}>حفظ التعديل</button><button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDialog(null)}>إلغاء</button></>}
      >
        <div className="dsv2-ew-dialog-grid dsv2-ew-dialog-grid--2">
          <DashboardFieldV2 id="dsv2-ew-dialog-attendance-date" label="التاريخ"><DashboardDatePickerV2 id="dsv2-ew-dialog-attendance-date" defaultValue="2026-08-14" disabled /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-attendance-action" label="نوع التعديل"><DashboardSelectV2 id="dsv2-ew-dialog-attendance-action" defaultValue="check-in" options={[{ value: "check-in", label: "وقت الدخول" }, { value: "check-out", label: "وقت الخروج" }, { value: "both", label: "الدخول والخروج" }]} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-check-in" label="وقت الدخول"><input id="dsv2-ew-dialog-check-in" className="dsv2-input" dir="ltr" defaultValue="10:00" /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-check-out" label="وقت الخروج"><input id="dsv2-ew-dialog-check-out" className="dsv2-input" dir="ltr" defaultValue="18:00" /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-attendance-reason" label="سبب التعديل" className="dsv2-ew-form-wide"><textarea id="dsv2-ew-dialog-attendance-reason" className="dsv2-textarea" placeholder="اكتب سبب التعديل والمستند المؤيد إن وجد..." /></DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={dialog === "file"}
        onClose={() => setDialog(null)}
        title="رفع مستند الموظفة"
        description="إضافة بيانات المستند وتاريخ انتهائه قبل الرفع."
        eyebrow="الملفات"
        size="md"
        tone="gold"
        footer={<><button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => { setDialog(null); markDirty(); }}>رفع وحفظ</button><button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDialog(null)}>إلغاء</button></>}
      >
        <div className="dsv2-ew-dialog-grid dsv2-ew-dialog-grid--2">
          <DashboardFieldV2 id="dsv2-ew-dialog-file-name" label="اسم المستند"><input id="dsv2-ew-dialog-file-name" className="dsv2-input" placeholder="مثال: شهادة صحية" /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-file-type" label="التصنيف"><DashboardSelectV2 id="dsv2-ew-dialog-file-type" defaultValue="certificate" options={[{ value: "identity", label: "هوية" }, { value: "contract", label: "عقد" }, { value: "certificate", label: "شهادة" }, { value: "other", label: "أخرى" }]} /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-file-expiry" label="تاريخ الانتهاء"><DashboardDatePickerV2 id="dsv2-ew-dialog-file-expiry" defaultValue="2027-08-04" /></DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-dialog-file-note" label="الملاحظات"><input id="dsv2-ew-dialog-file-note" className="dsv2-input" placeholder="ملاحظة اختيارية" /></DashboardFieldV2>
          <button type="button" className="dsv2-ew-dropzone dsv2-ew-form-wide"><span className="dsv2-ew-dropzone__icon">↑</span><strong>اختيار الملف</strong><small>بي دي إف أو صورة حتى 10 ميجابايت</small></button>
        </div>
      </DashboardModalV2>

      <DashboardDrawerV2
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer === "day" ? "تفاصيل يوم الحضور" : drawer === "service" ? "تفاصيل الخدمة" : "سجل الإجراءات"}
        description={drawer === "day" ? "عرض البصمات والشفت والموقع والمراجعات." : drawer === "service" ? "معلومات الخدمة قبل إسنادها للموظفة." : "التسلسل الزمني للتغييرات والاعتمادات."}
        eyebrow={drawer === "day" ? "14 أغسطس 2026" : drawer === "service" ? "خدمة الصالون" : "سجل التدقيق"}
        size="md"
        side="end"
        tone={drawer === "day" ? "gold" : "default"}
        footer={<button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setDrawer(null)}>إغلاق</button>}
      >
        {drawer === "day" ? (
          <div className="dsv2-ew-drawer-content">
            <div className="dsv2-ew-metrics"><WorkspaceMetricV2 label="الدخول" value="10:12 ص" tone="gold" /><WorkspaceMetricV2 label="الخروج" value="06:05 م" tone="success" /></div>
            <WorkspaceTableV2 headers={["الحدث", "الوقت", "المصدر", "الحالة"]} rows={[["دخول", "10:12 ص", "الفرع الرئيسي", <WorkspaceStatusBadgeV2 tone="gold">متأخر</WorkspaceStatusBadgeV2>], ["خروج", "06:05 م", "الفرع الرئيسي", <WorkspaceStatusBadgeV2 tone="success">مكتمل</WorkspaceStatusBadgeV2>]]} />
            <WorkspaceNoticeV2 title="ملاحظة المراجعة" description="تم التحقق من صورة الدخول والموقع. التأخير غير معفى حتى الآن." tone="gold" />
          </div>
        ) : drawer === "service" ? (
          <div className="dsv2-ew-drawer-content">
            <h3>قص أطراف الشعر</h3>
            <div className="dsv2-ew-metrics"><WorkspaceMetricV2 label="القسم" value="الشعر" /><WorkspaceMetricV2 label="المدة" value="30 دقيقة" /><WorkspaceMetricV2 label="السعر" value="75 ر.س" tone="gold" /></div>
            <p>خدمة قص خفيف للأطراف مع استشارة سريعة وتصفيف نهائي بسيط.</p>
          </div>
        ) : (
          <div className="dsv2-ew-drawer-content">
            <ol className="dsv2-ew-timeline">
              <li><span>04 أغسطس 2026 · 11:20 ص</span><strong>فتح السجل</strong><small>بواسطة الإدارة</small></li>
              <li><span>03 أغسطس 2026 · 04:15 م</span><strong>تحديث الحالة</strong><small>تم الاعتماد بعد مراجعة المرفق</small></li>
              <li><span>02 أغسطس 2026 · 11:26 ص</span><strong>إنشاء السجل</strong><small>بواسطة الموظفة</small></li>
            </ol>
          </div>
        )}
      </DashboardDrawerV2>

      <DashboardConfirmV2
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          confirm?.onConfirm?.();
          setConfirm(null);
        }}
        title={confirm?.title ?? "تأكيد الإجراء"}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel="تراجع"
        tone={confirm?.tone ?? "danger"}
      >
        {confirm?.detail}
      </DashboardConfirmV2>
    </section>
  );
}

export default function DashboardEmployeeWorkspaceV2() {
  return (
    <DashboardToastProviderV2 position="top-start">
      <EmployeeWorkspaceContentV2 />
    </DashboardToastProviderV2>
  );
}
