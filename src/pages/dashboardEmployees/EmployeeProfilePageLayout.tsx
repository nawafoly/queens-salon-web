import { useCallback, useEffect, useState, type SyntheticEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faTrash } from "@fortawesome/free-solid-svg-icons";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import { DashboardSelectV2 } from "../../components/dashboard-v2";
import {
  WorkspaceMetricV2,
  WorkspaceStatusBadgeV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { normalizeSpecialties, type EmployeeSplitTab } from "./shared";
import type { EmployeeEditorModalProps } from "./EmployeeEditorModal";

const SELF_SAVING_LIVE_TAB_SELECTOR = [
  "[data-dsv2-ignore-dirty='true']",
  ".dsv2-ew-shifts-live",
  ".dsv2-ew-requests-live",
  ".dsv2-ew-files-live",
  ".dsv2-ew-messages-live",
].join(", ");

export default function EmployeeProfilePageLayout(props: EmployeeEditorModalProps) {
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setIsDirty(false);
  }, [props.editId]);

  useEffect(() => {
    if (props.saving) setIsDirty(false);
  }, [props.saving]);

  const markDirty = useCallback(
    (event: SyntheticEvent<HTMLElement>) => {
      if (!props.canManage || props.saving) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(SELF_SAVING_LIVE_TAB_SELECTOR)) return;
      setIsDirty(true);
    },
    [props.canManage, props.saving]
  );

  if (!props.isOpen || !props.editId || !props.editingStaff) return null;

  const employeeName = String(props.editingStaff.name || props.name || "").trim();
  const serviceCount = normalizeSpecialties(props.editingStaff.specialties).length;
  const tabs = props.detailTabs || [];
  const activeTab = tabs.find((tab) => tab.key === props.activeTab);
  const activeLabel = activeTab?.label || "البيانات الأساسية";
  const activeHint = activeTab?.hint || "إدارة بيانات الموظفة";
  const showSavebar = props.saving || isDirty;

  const handleCancel = () => {
    setIsDirty(false);
    (props.onCancelEdit || props.onClose)?.();
  };

  const handleSave = () => {
    props.onSave?.();
  };

  return (
    <section
      className="dsv2-employee-workspace employees-v2-profile employees-v2-profile--workspace"
      dir="rtl"
      aria-label={`ملف الموظفة ${employeeName || "موظفة"}`}
    >
      <nav className="employees-v2-breadcrumb" aria-label="مسار التنقل">
        <button type="button" onClick={props.onClose}>الموظفات</button>
        <span>/</span>
        <b>{employeeName || "موظفة"}</b>
        <span>/</span>
        <strong>{activeLabel}</strong>
      </nav>

      <header className="dsv2-card dsv2-card--padded dsv2-ew-profile-head">
        <div className="dsv2-ew-profile-head__identity">
          <EmployeeAvatar
            className="dsv2-ew-avatar employees-v2-profile__avatar"
            src={props.editingStaff.avatarUrl}
            name={employeeName || "موظفة"}
            alt={employeeName ? `صورة ${employeeName}` : "صورة الموظفة"}
            loading="eager"
          />

          <div>
            <div className="dsv2-ew-profile-head__name-row">
              <h2>{employeeName || "موظفة"}</h2>
              {props.selectedEmployeeStatusLabel ? (
                <WorkspaceStatusBadgeV2 tone="success">
                  {props.selectedEmployeeStatusLabel}
                </WorkspaceStatusBadgeV2>
              ) : null}
              {!props.canManage ? <WorkspaceStatusBadgeV2>عرض فقط</WorkspaceStatusBadgeV2> : null}
            </div>

            <div className="dsv2-ew-profile-head__meta">
              <span>ملف موظفة فعلي</span>
              <span>{serviceCount > 0 ? `${serviceCount} خدمة مرتبطة` : "بدون خدمات مرتبطة"}</span>
              <span>{activeLabel}</span>
            </div>
          </div>
        </div>

        <div className="dsv2-ew-profile-head__summary" aria-label="ملخص الموظفة">
          <WorkspaceMetricV2
            label="الحالة"
            value={props.selectedEmployeeStatusLabel || "غير محددة"}
            tone="success"
          />
          <WorkspaceMetricV2
            label="الخدمات"
            value={serviceCount}
            note="خدمة مرتبطة"
            tone="gold"
          />
          <WorkspaceMetricV2
            label="القسم الحالي"
            value={activeLabel}
            note="بيانات فعلية"
          />
        </div>
      </header>

      <div className="dsv2-ew-intro employees-v2-profile__workspace-intro">
        <div>
          <span className="dsv2-ew-intro__eyebrow">مساحة الموظفة</span>
          <h1>{activeLabel}</h1>
          <p>{activeHint}</p>
        </div>

        <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={props.onClose}>
          <FontAwesomeIcon icon={faArrowRight} />
          العودة إلى الموظفات
        </button>
      </div>

      <nav className="dsv2-ew-tabs" role="tablist" aria-label="أقسام ملف الموظفة">
        {tabs.map((tab, index) => {
          const isActive = props.activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className="dsv2-ew-tab"
              data-active={isActive ? "true" : "false"}
              aria-selected={isActive}
              onClick={() => props.onDetailTabChange?.(tab.key)}
            >
              <span className="dsv2-ew-tab__number" aria-hidden="true">{index + 1}</span>
              {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
              <span className="dsv2-ew-tab__label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="dsv2-ew-mobile-tab-select">
        <DashboardSelectV2
          id="employees-v2-live-section"
          value={props.activeTab || "basic"}
          options={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
          onChange={(value) => props.onDetailTabChange?.(value as EmployeeSplitTab)}
        />
      </div>

      <main className="dsv2-ew-content" aria-label={activeLabel}>
        <fieldset
          className={`employees-v2-profile__fieldset ${!props.canManage ? "is-readonly" : ""}`}
          disabled={!props.canManage}
          onInputCapture={markDirty}
          onChangeCapture={markDirty}
        >
          <div
            className="employees-v2-profile__body"
            data-section-label={activeLabel}
            data-section-hint={activeHint}
          >
            {props.children}
          </div>
        </fieldset>
      </main>

      <footer className="dsv2-ew-savebar" data-dirty={showSavebar ? "true" : "false"}>
        <div className="dsv2-ew-savebar__status">
          <span className="dsv2-ew-savebar__dot" aria-hidden="true" />
          <div>
            <strong>{props.saving ? "جاري حفظ التغييرات" : "توجد تغييرات غير محفوظة"}</strong>
            <small>{props.saving ? "لا تغلق الصفحة حتى يكتمل الحفظ." : "احفظ التغييرات أو ألغها قبل الخروج من الملف."}</small>
          </div>
        </div>

        <div className="dsv2-ew-savebar__actions">
          {props.canManage && props.canDelete && props.onDelete ? (
            <button
              className="dsv2-btn dsv2-btn--danger"
              type="button"
              onClick={props.onDelete}
              disabled={props.busy}
              data-dsv2-ignore-dirty="true"
            >
              <FontAwesomeIcon icon={faTrash} />
              أرشفة الموظفة
            </button>
          ) : null}

          <button
            className="dsv2-btn dsv2-btn--secondary"
            type="button"
            onClick={handleCancel}
            disabled={props.busy}
            data-dsv2-ignore-dirty="true"
          >
            إلغاء التعديلات
          </button>

          {props.canManage ? (
            <button
              className="dsv2-btn dsv2-btn--primary"
              type="button"
              onClick={handleSave}
              disabled={props.busy}
              data-dsv2-ignore-dirty="true"
            >
              {props.saving ? "جاري الحفظ..." : "حفظ التغييرات"}
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
