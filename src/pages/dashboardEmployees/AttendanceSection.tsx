import AttendanceMonthView from "../../components/AttendanceMonthView";
import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
  schedule?: Record<string, unknown> | null;
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

export default function AttendanceSection({
  isVisible,
  loading,
  rows,
  monthKey,
  selectedDate,
  schedule,
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
  if (!isVisible) return null;

  return (
    <div className="emp-modal-section employee-attendance-admin">
      <AttendanceMonthView
        rows={rows}
        loading={loading}
        monthKey={monthKey}
        selectedDate={selectedDate}
        className="attendance-month--employee-profile"
        title="سجل حضور الموظفة"
        subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل."
        viewerMode="admin"
        schedule={schedule}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
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
