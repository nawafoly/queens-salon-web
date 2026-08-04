import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  error?: string;
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

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function toLiveAttendanceRow(row: StaffAttendanceWithId): EmployeeAttendanceRowLiveV2 {
  const record = row as StaffAttendanceWithId & Record<string, unknown>;
  const checkInVerification = (record.checkInVerification || {}) as Record<string, unknown>;
  const checkOutVerification = (record.checkOutVerification || {}) as Record<string, unknown>;
  const records = Array.isArray(record.records)
    ? (record.records as Record<string, unknown>[])
    : [];
  return {
    date: cleanText(record.date || record.dateKey || record.dayKey),
    status: cleanText(record.status || record.attendanceStatus || record.state),
    checkInAtClient: cleanText(record.checkInAtClient || record.checkInAt || record.checkInTime),
    checkOutAtClient: cleanText(record.checkOutAtClient || record.checkOutAt || record.checkOutTime),
    lateMinutes: Number(record.lateMinutes || 0),
    earlyLeaveMinutes: Number(record.earlyLeaveMinutes || 0),
    notes: cleanText(record.notes || record.note),
    type: cleanText(record.type),
    absentFullDay: record.absentFullDay === true,
    recordCount: records.length,
    workZoneName: cleanText(
      checkInVerification.workZoneName ||
        checkOutVerification.workZoneName ||
        records.find((item) => cleanText(item.zoneName))?.zoneName
    ),
  };
}

export default function AttendanceSection({
  isVisible,
  loading,
  error = "",
  rows,
  monthKey,
  selectedDate,
  approvedLeaveDateKeys = [],
  canEdit = false,
  canDelete = false,
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
  if (!isVisible) return null;

  const liveRows = rows.map(toLiveAttendanceRow);

  return (
    <>
      <EmployeeAttendanceTabLiveV2
        readOnly={loading}
        loading={loading}
        error={error}
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateEmergencyLeave={canCreateEmergencyLeave}
        canCancelLeave={canCancelLeave}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onReload={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
        onCreateEmergencyLeave={onCreateEmergencyLeave}
        onCancelLeave={onCancelLeave}
      />
    </>
  );
}
