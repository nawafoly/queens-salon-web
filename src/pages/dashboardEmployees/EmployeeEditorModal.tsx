import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faUserSlash } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import { usePermissions } from "../../security/PermissionContext";
import { useEmployeeLanguage } from "./employeeLanguage";
import {
  clearEmployeeOnboardingQueue,
  makeEmployeeTempPassword,
  queueEmployeeOnboarding,
  type EmployeeOnboardingRole,
} from "../../services/employeeOnboardingCoordinator";
import {
  normalizeSpecialties,
  type EmployeeModalTab,
  type EmployeeSplitTab,
  type StaffPublicUi,
} from "./shared";

export type EmployeeSaveOptions = {
  createLogin?: boolean;
};

export type EmployeeEditorModalProps = {
  isOpen: boolean;
  canManage: boolean;
  busy: boolean;
  saving: boolean;
  editId: string | null;
  editingStaff: StaffPublicUi | null;
  name: string;
  modalTab: EmployeeModalTab;
  modalTabs: Array<{ key: EmployeeModalTab; label: string }>;
  activeTab?: EmployeeSplitTab;
  detailTabs?: Array<{ key: EmployeeSplitTab; label: string; hint: string; icon?: IconDefinition }>;
  selectedEmployeeStatusLabel?: string;
  selectedEmployeeStatusClass?: string;
  hasUnsavedChanges?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onSave: (options?: EmployeeSaveOptions) => void | Promise<void>;
  onDelete?: () => void;
  onCancelEdit?: () => void;
  onModalTabChange: (tab: EmployeeModalTab) => void;
  onDetailTabChange?: (tab: EmployeeSplitTab) => void;
  children: ReactNode;
};

const ACCOUNT_ROLE_OPTIONS: Array<{ value: EmployeeOnboardingRole; label: string }> = [
  { value: "staff", label: "موظفة" },
  { value: "reception", label: "الاستقبال" },
  { value: "hr", label: "الموارد البشرية" },
  { value: "accountant", label: "المحاسبة" },
  { value: "admin", label: "الإدارة" },
];

export default function EmployeeEditorModal({
  isOpen,
  canManage,
  busy,
  saving,
  editId,
  editingStaff,
  name,
  modalTab,
  modalTabs,
  activeTab = "basic",
  detailTabs = [],
  selectedEmployeeStatusLabel = "",
  canDelete = false,
  onClose,
  onSave,
  onDelete,
  onCancelEdit,
  onModalTabChange,
  onDetailTabChange,
  children,
}: EmployeeEditorModalProps) {
  const { t } = useEmployeeLanguage();
  const { hasAnyPermission } = usePermissions();
  const isCreateMode = !editId;
  const employeeName = String(editingStaff?.name || name || "").trim();
  const specialtiesCount = normalizeSpecialties(editingStaff?.specialties).length;
  const canProvisionAccount = hasAnyPermission(["accounts.create", "admin_accounts.manage"]);

  const [createLogin, setCreateLogin] = useState(canProvisionAccount);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountRole, setAccountRole] = useState<EmployeeOnboardingRole>("staff");
  const [temporaryPassword, setTemporaryPassword] = useState(() => makeEmployeeTempPassword());
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    if (!isOpen || !isCreateMode) return;
    clearEmployeeOnboardingQueue();
    setCreateLogin(canProvisionAccount);
    setAccountEmail("");
    setAccountPhone("");
    setAccountRole("staff");
    setTemporaryPassword(makeEmployeeTempPassword());
    setAccountError("");
  }, [canProvisionAccount, isCreateMode, isOpen]);

  const tabs = useMemo(
    () =>
      isCreateMode
        ? modalTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: modalTab === tab.key,
            onClick: () => onModalTabChange(tab.key),
            icon: undefined as IconDefinition | undefined,
          }))
        : detailTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: activeTab === tab.key,
            onClick: () => onDetailTabChange?.(tab.key),
            icon: tab.icon,
          })),
    [activeTab, detailTabs, isCreateMode, modalTab, modalTabs, onDetailTabChange, onModalTabChange]
  );

  const handleSave = async () => {
    if (!isCreateMode) {
      await onSave();
      return;
    }

    setAccountError("");
    const email = accountEmail.trim().toLowerCase();
    const phone = accountPhone.trim();
    const password = temporaryPassword.trim();

    if (createLogin) {
      if (!canProvisionAccount) {
        setAccountError(t("ليست لديك صلاحية إنشاء حسابات دخول. يمكنك إنشاء الملف الوظيفي فقط."));
        return;
      }
      if (!email || !email.includes("@")) {
        setAccountError(t("أدخل بريدًا إلكترونيًا صحيحًا لإنشاء حساب الدخول."));
        return;
      }
      if (password.length < 6) {
        setAccountError(t("كلمة المرور المؤقتة يجب أن تكون 6 أحرف على الأقل."));
        return;
      }
    }

    queueEmployeeOnboarding({
      createLogin,
      displayName: name.trim(),
      email,
      phone,
      role: accountRole,
      password,
    });

    try {
      await onSave({ createLogin });
    } finally {
      clearEmployeeOnboardingQueue();
    }
  };

  const footer = (
    <div className="employees-v2-editor__footer">
      <div>
        {!isCreateMode && canManage && canDelete && onDelete ? (
          <button className="dsv2-btn dsv2-btn--danger" type="button" onClick={onDelete} disabled={busy}>
            <FontAwesomeIcon icon={faUserSlash} />
            {t("إنهاء الخدمة")}
          </button>
        ) : null}
      </div>
      <div className="employees-v2-editor__footer-actions">
        {!isCreateMode && canManage && onCancelEdit ? (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onCancelEdit} disabled={busy}>
            {t("إلغاء التعديلات")}
          </button>
        ) : (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onClose} disabled={saving}>
            {t("إلغاء")}
          </button>
        )}
        {canManage ? (
          <button
            className="dsv2-btn dsv2-btn--primary"
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {saving
              ? t("جاري الحفظ...")
              : isCreateMode
                ? createLogin
                  ? t("إنشاء الموظفة وحساب الدخول")
                  : t("إنشاء الموظفة")
                : t("حفظ التغييرات")}
          </button>
        ) : (
          <span className="dsv2-badge">{t("عرض فقط")}</span>
        )}
      </div>
    </div>
  );

  return (
    <DashboardModalV2
      open={isOpen}
      onClose={onClose}
      title={isCreateMode ? t("إضافة موظفة") : employeeName || t("ملف الموظفة")}
      eyebrow={isCreateMode ? t("إدارة الموظفات") : t("الملف الحالي")}
      description={
        isCreateMode
          ? t("أكملي بيانات الموظفة، ثم أنشئي ملفها وحساب الدخول من نفس العملية.")
          : t("تعديل بيانات الموظفة من نافذة موحدة.")
      }
      size="xl"
      tone="gold"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      footer={footer}
      className={`employees-v2-editor ${isCreateMode ? "employees-v2-editor--create" : "employees-v2-editor--edit"}`}
    >
      {!isCreateMode ? (
        <div className="employees-v2-editor__meta">
          {selectedEmployeeStatusLabel ? <span className="dsv2-badge dsv2-badge--success">{selectedEmployeeStatusLabel}</span> : null}
          <span className="dsv2-badge">{specialtiesCount > 0 ? `${specialtiesCount} ${t("الخدمات")}` : t("بدون خدمات")}</span>
        </div>
      ) : (
        <section className="employees-v2-editor__create-intro" aria-label={t("عملية إضافة الموظفة")}>
          <span className="dsv2-badge dsv2-badge--gold">{t("عملية موحدة")}</span>
          <div>
            <strong>{t("ملف الموظفة وحساب الدخول في مكان واحد")}</strong>
            <p>{t("أكملي الأقسام بالترتيب المناسب لك. النظام ينشئ ويربط حساب الدخول تلقائيًا بدون أي معرّفات أو خطوات تقنية يدوية.")}</p>
          </div>
        </section>
      )}

      <nav className="employees-v2-editor__tabs" role="tablist" aria-label={t("أقسام ملف الموظفة")}>
        {tabs.map((tab, index) => (
          <button
            key={String(tab.key)}
            type="button"
            role="tab"
            className={tab.active ? "is-active" : ""}
            onClick={tab.onClick}
            aria-selected={tab.active}
          >
            {isCreateMode ? <span className="employees-v2-editor__tab-index" aria-hidden="true">{index + 1}</span> : null}
            {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <fieldset className={`employees-v2-editor__fieldset ${!canManage ? "is-readonly" : ""}`} disabled={!canManage}>
        <div className="employees-v2-editor__content">{children}</div>

        {isCreateMode && modalTab === "basic" ? (
          <section className="employee-onboarding-account" aria-label={t("حساب الدخول")}>
            <div className="employee-onboarding-account__head">
              <div>
                <span className="dsv2-badge dsv2-badge--gold">{t("حساب الدخول")}</span>
                <h3>{t("تسجيل دخول الموظفة")}</h3>
                <p>{t("اختياري. عند تفعيله سيتم إنشاء الحساب وربطه بالملف الوظيفي تلقائيًا ضمن نفس عملية الحفظ.")}</p>
              </div>
              <label className="employee-onboarding-account__toggle">
                <input
                  type="checkbox"
                  checked={createLogin}
                  disabled={!canProvisionAccount || busy}
                  onChange={(event) => {
                    setCreateLogin(event.target.checked);
                    setAccountError("");
                  }}
                />
                <span>{t("إنشاء وتفعيل حساب دخول")}</span>
              </label>
            </div>

            {!canProvisionAccount ? (
              <p className="employee-onboarding-account__notice">
                {t("لا تملك صلاحية إنشاء حسابات دخول؛ سيتم إنشاء الملف الوظيفي فقط.")}
              </p>
            ) : null}

            <div className="employee-onboarding-account__grid">
              <DashboardFieldV2
                id="employee-onboarding-email"
                label={t("البريد الإلكتروني")}
                required={createLogin}
                hint={createLogin ? t("سيستخدم لتسجيل الدخول واستعادة كلمة المرور.") : t("اختياري إذا لم يتم إنشاء حساب دخول.")}
              >
                <input
                  id="employee-onboarding-email"
                  className="dsv2-input"
                  type="email"
                  autoComplete="off"
                  value={accountEmail}
                  onChange={(event) => {
                    setAccountEmail(event.target.value);
                    setAccountError("");
                  }}
                  disabled={busy}
                  placeholder="name@example.com"
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="employee-onboarding-phone" label={t("رقم الجوال")}>
                <input
                  id="employee-onboarding-phone"
                  className="dsv2-input"
                  type="tel"
                  autoComplete="off"
                  value={accountPhone}
                  onChange={(event) => setAccountPhone(event.target.value)}
                  disabled={busy}
                  placeholder="+9665XXXXXXXX"
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="employee-onboarding-role" label={t("الدور")} required={createLogin}>
                <DashboardSelectV2
                  value={accountRole}
                  options={ACCOUNT_ROLE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                  onChange={(value) => setAccountRole(value as EmployeeOnboardingRole)}
                  disabled={!createLogin || busy}
                />
              </DashboardFieldV2>

              <DashboardFieldV2
                id="employee-onboarding-password"
                label={t("كلمة المرور المؤقتة")}
                required={createLogin}
                hint={t("يمكن للموظفة تغييرها لاحقًا.")}
              >
                <div className="employee-onboarding-account__password">
                  <input
                    id="employee-onboarding-password"
                    className="dsv2-input"
                    type="text"
                    autoComplete="new-password"
                    value={temporaryPassword}
                    onChange={(event) => {
                      setTemporaryPassword(event.target.value);
                      setAccountError("");
                    }}
                    disabled={!createLogin || busy}
                  />
                  <button
                    className="dsv2-btn dsv2-btn--secondary"
                    type="button"
                    disabled={!createLogin || busy}
                    onClick={() => setTemporaryPassword(makeEmployeeTempPassword())}
                  >
                    <FontAwesomeIcon icon={faArrowsRotate} />
                    {t("توليد")}
                  </button>
                </div>
              </DashboardFieldV2>
            </div>

            {accountError ? <p className="employee-onboarding-account__error">{accountError}</p> : null}
          </section>
        ) : null}
      </fieldset>
    </DashboardModalV2>
  );
}
