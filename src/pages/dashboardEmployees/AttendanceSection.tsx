import { useEffect, useMemo, useState } from "react";
import AttendanceMonthView from "../../components/AttendanceMonthView";
import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import { CoreHrService } from "../../services/CoreHrService";
import type { CoreResolvedShift } from "../../types/hrCoreApi";
import {
  getPermissionPayrollSummary,
  type EmployeePermissionRequest,
} from "../../services/employeePermissionRequests";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
  schedule?: Record<string, unknown> | null;
  employeeId?: string;
  approvedLeaveDateKeys?: string[];
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
  onCreateEmergencyLeave?: (dateKey: string) => void;
  onCancelLeave?: (dateKey: string) => void;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeMonthKey(value: string) {
  const clean = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(clean) ? clean : new Date().toISOString().slice(0, 7);
}

function monthDateKeys(monthKey: string) {
  const safe = normalizeMonthKey(monthKey);
  const [year, month] = safe.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${safe}-${pad2(index + 1)}`);
}

function resolvedShiftCacheKey(employeeId: string, monthKey: string) {
  return `${employeeId}:${normalizeMonthKey(monthKey)}`;
}

export default function AttendanceSection({
  isVisible,
  loading,
  rows,
  monthKey,
  selectedDate,
  schedule,
  employeeId,
  approvedLeaveDateKeys,
  canEdit = false,
  canDelete = false,
  canReview = false,
  canCreateEmergencyLeave = false,
  canCancelLeave = false,
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
  onCreateEmergencyLeave,
  onCancelLeave,
}: AttendanceSectionProps) {
  const [coreResolvedShifts, setCoreResolvedShifts] = useState<Record<string, CoreResolvedShift | null>>({});
  const [permissionEntries, setPermissionEntries] = useState<EmployeePermissionRequest[]>([]);
  const shiftLookupKey = useMemo(() => (employeeId ? resolvedShiftCacheKey(employeeId, monthKey) : ""), [employeeId, monthKey]);

  useEffect(() => {
    if (!isVisible || !employeeId || !shiftLookupKey) {
      setCoreResolvedShifts({});
      return;
    }
    let cancelled = false;
    const dates = monthDateKeys(monthKey);
    Promise.all(
      dates.map(async (date) => {
        try {
          return [date, await CoreHrService.resolveEmployeeShift(employeeId, date)] as const;
        } catch (error) {
          console.warn("attendance resolved shift load failed", { employeeId, date, error });
          return [date, null] as const;
        }
      })
    ).then((pairs) => {
      if (cancelled) return;
      setCoreResolvedShifts(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId, isVisible, monthKey, shiftLookupKey]);

  useEffect(() => {
    if (!isVisible || !employeeId) {
      setPermissionEntries([]);
      return;
    }
    let cancelled = false;
    const dates = monthDateKeys(monthKey);
    const fromDate = dates[0] || `${normalizeMonthKey(monthKey)}-01`;
    const toDate = dates[dates.length - 1] || fromDate;
    void getPermissionPayrollSummary({ employeeId, fromDate, toDate })
      .then((summary) => {
        if (!cancelled) setPermissionEntries(summary.entries || []);
      })
      .catch((error) => {
        console.warn("attendance permission load failed", { employeeId, fromDate, toDate, error });
        if (!cancelled) setPermissionEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, isVisible, monthKey]);

  if (!isVisible) return null;

  return (
    <div className="emp-modal-section employee-attendance-admin">
      <AttendanceMonthView
        rows={rows}
        loading={loading}
        monthKey={monthKey}
        selectedDate={selectedDate}
        className="attendance-month--employee-clean"
        title="سجل حضور الموظفة"
        subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل."
        viewerMode="admin"
        schedule={schedule}
        coreResolvedShifts={coreResolvedShifts}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        permissionEntries={permissionEntries}
        canEdit={canEdit}
        canDelete={canDelete}
        canReview={canReview}
        canCreateEmergencyLeave={canCreateEmergencyLeave}
        canCancelLeave={canCancelLeave}
        showAdminActions={canEdit || canDelete || canReview || canCreateEmergencyLeave || canCancelLeave}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onGenerateSummary={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
        onReviewDay={onEditPunch}
        onCreateEmergencyLeave={onCreateEmergencyLeave}
        onCancelLeave={onCancelLeave}
      />
    </div>
  );
}
