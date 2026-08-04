import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";

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

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function toLiveAttendanceRow(row: StaffAttendanceWithId): EmployeeAttendanceRowLiveV2 {
  const record = row as StaffAttendanceWithId & Record<string, unknown>;
  return {
    date: cleanText(record.date || record.dateKey || record.dayKey),
    status: cleanText(record.status || record.attendanceStatus || record.state),
    checkInAtClient: cleanText(record.checkInAtClient || record.checkInAt || record.checkInTime),
    checkOutAtClient: cleanText(record.checkOutAtClient || record.checkOutAt || record.checkOutTime),
    lateMinutes: Number(record.lateMinutes || 0),
    earlyLeaveMinutes: Number(record.earlyLeaveMinutes || 0),
    notes: cleanText(record.notes || record.note),
  };
}

export default function AttendanceSection({
  isVisible,
  loading,
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
  const selectedHasApprovedLeave = approvedLeaveDateKeys.includes(selectedDate);
  const canShowLeaveActions = Boolean(selectedDate && (canCreateEmergencyLeave || canCancelLeave));

  return (
    <section className="dsv2-ew-tab-panel">
      <EmployeeAttendanceTabLiveV2
        readOnly={loading}
        loading={loading}
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        canEdit={canEdit}
        canDelete={canDelete}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onReload={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
      />

      {canShowLeaveActions ? (
        <article className="dsv2-card dsv2-card--padded dsv2-ew-card">
          <header className="dsv2-section-head dsv2-ew-card__head">
            <div>
              <h3 className="dsv2-section-title dsv2-ew-card__title">إجراءات اليوم المحدد</h3>
              <p className="dsv2-section-caption">
                إجراءات مرتبطة بيوم {selectedDate} بدون الرجوع لمكونات الحضور القديمة.
              </p>
            </div>
          </header>

          <div className="dsv2-ew-card__body">
            <div className="dsv2-cluster">
              {canCreateEmergencyLeave ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--accent"
                  disabled={loading || selectedHasApprovedLeave}
                  onClick={() => onCreateEmergencyLeave?.(selectedDate)}
                >
                  تسجيل إجازة مفاجئة
                </button>
              ) : null}

              {canCancelLeave ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger"
                  disabled={loading || !selectedHasApprovedLeave}
                  onClick={() => onCancelLeave?.(selectedDate)}
                >
                  إلغاء إجازة اليوم
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}
    </section>
  );
}
