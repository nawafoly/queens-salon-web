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
        setAccountError("ليست لديك صلاحية إنشاء حسابات دخول. يمكنك إنشاء الملف الوظيفي فقط.");
        return;
      }
      if (!email || !email.includes("@")) {
        setAccountError("أدخل بريدًا إلكترونيًا صحيحًا لإنشاء حساب الدخول.");
        return;
      }
      if (password.length < 6) {
        setAccountError("كلمة المرور المؤقتة يجب أن تكون 6 أحرف على الأقل.");
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
            إنهاء الخدمة
          </button>
        ) : null}
      </div>
      <div className="employees-v2-editor__footer-actions">
        {!isCreateMode && canManage && onCancelEdit ? (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onCancelEdit} disabled={busy}>
            إلغاء التعديلات
          </button>
        ) : (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onClose} disabled={saving}>
            إلغاء
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
              ? "جاري الحفظ..."
              : isCreateMode
                ? createLogin
                  ? "إنشاء الموظفة وحساب الدخول"
                  : "إنشاء الموظفة"
                : "حفظ التغييرات"}
          </button>
        ) : (
          <span className="dsv2-badge">عرض فقط</span>
        )}
      </div>
    </div>
  );

  return (
    <DashboardModalV2
      open={isOpen}
      onClose={onClose}
      title={isCreateMode ? "إضافة موظفة" : employeeName || "ملف الموظفة"}
      eyebrow={isCreateMode ? "إدارة الموظفات" : "الملف الحالي"}
      description={
        isCreateMode
          ? "أكملي بيانات الموظفة، ثم أنشئي ملفها وحساب الدخول من نفس العملية."
          : "تعديل بيانات الموظفة من نافذة موحدة."
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
          <span className="dsv2-badge">{specialtiesCount > 0 ? `${specialtiesCount} خدمة` : "بدون خدمات"}</span>
        </div>
      ) : (
        <section className="employees-v2-editor__create-intro" aria-label="عملية إضافة الموظفة">
          <span className="dsv2-badge dsv2-badge--gold">عملية موحدة</span>
          <div>
            <strong>ملف الموظفة وحساب الدخول في مكان واحد</strong>
            <p>أكملي الأقسام بالترتيب المناسب لك. النظام ينشئ ويربط حساب الدخول تلقائيًا بدون أي معرّفات أو خطوات تقنية يدوية.</p>
          </div>
        </section>
      )}

      <nav className="employees-v2-editor__tabs" role="tablist" aria-label="أقسام ملف الموظفة">
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
          <section className="employee-onboarding-account" aria-label="حساب الدخول">
            <div className="employee-onboarding-account__head">
              <div>
                <span className="dsv2-badge dsv2-badge--gold">حساب الدخول</span>
                <h3>تسجيل دخول الموظفة</h3>
                <p>اختياري. عند تفعيله سيتم إنشاء الحساب وربطه بالملف الوظيفي تلقائيًا ضمن نفس عملية الحفظ.</p>
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
                <span>إنشاء وتفعيل حساب دخول</span>
              </label>
            </div>

            {!canProvisionAccount ? (
              <p className="employee-onboarding-account__notice">
                لا تملك صلاحية إنشاء حسابات دخول؛ سيتم إنشاء الملف الوظيفي فقط.
              </p>
            ) : null}

            <div className="employee-onboarding-account__grid">
              <DashboardFieldV2
                id="employee-onboarding-email"
                label="البريد الإلكتروني"
                required={createLogin}
                hint={createLogin ? "سيستخدم لتسجيل الدخول واستعادة كلمة المرور." : "اختياري إذا لم يتم إنشاء حساب دخول."}
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

              <DashboardFieldV2 id="employee-onboarding-phone" label="رقم الجوال">
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

              <DashboardFieldV2 id="employee-onboarding-role" label="الدور" required={createLogin}>
                <DashboardSelectV2
                  value={accountRole}
                  options={ACCOUNT_ROLE_OPTIONS}
                  onChange={(value) => setAccountRole(value as EmployeeOnboardingRole)}
                  disabled={!createLogin || busy}
                />
              </DashboardFieldV2>

              <DashboardFieldV2
                id="employee-onboarding-password"
                label="كلمة المرور المؤقتة"
                required={createLogin}
                hint="يمكن للموظفة تغييرها لاحقًا."
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
                    توليد
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
