import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faLock } from "@fortawesome/free-solid-svg-icons";
import { Link, useNavigate } from "react-router-dom";

import type { AppPermission } from "../helpers/permissions";
import { usePermissions } from "../security/PermissionContext";
import "../styles/AccessDenied.css";

type AccessDeniedProps = {
  title?: string;
  message?: string;
  requiredPermission?: AppPermission;
  compact?: boolean;
};

export default function AccessDenied({
  title = "لا تملك صلاحية الوصول",
  message = "هذا القسم يحتاج صلاحية إضافية. راجع مسؤول النظام لتحديث صلاحيات حسابك.",
  requiredPermission,
  compact = false,
}: AccessDeniedProps) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const landingPath = hasPermission("workspace.dashboard.view")
    ? "/dashboard/overview"
    : hasPermission("workspace.employee_portal.view")
      ? "/employee/overview"
      : "/hr";

  return (
    <section className={`access-denied ${compact ? "access-denied--compact" : ""}`} dir="rtl">
      <div className="access-denied__card" role="alert">
        <span className="access-denied__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faLock} />
        </span>
        <div className="access-denied__copy">
          <small>صلاحيات الحساب</small>
          <h1>{title}</h1>
          <p>{message}</p>
          {requiredPermission ? (
            <code className="access-denied__permission">{requiredPermission}</code>
          ) : null}
        </div>
        <div className="access-denied__actions">
          <button type="button" onClick={() => navigate(-1)}>
            <FontAwesomeIcon icon={faArrowRight} />
            رجوع
          </button>
          <Link to={landingPath}>الصفحة المتاحة</Link>
        </div>
      </div>
    </section>
  );
}
