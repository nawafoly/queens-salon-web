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
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
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
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
}: AttendanceSectionProps) {
  if (!isVisible) return null;

  return (
    <div className="emp-modal-section employee-attendance-admin">
      <AttendanceMonthView
        rows={rows}
        loading={loading}
        monthKey={monthKey}
        selectedDate={selectedDate}
        title="سجل حضور الموظفة"
        subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجل."
        viewerMode="admin"
        schedule={schedule}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        canEdit={canEdit}
        canDelete={canDelete}
        canReview={canReview}
        showAdminActions={canEdit || canDelete || canReview}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onGenerateSummary={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
        onReviewDay={onEditPunch}
      />
    </div>
  );
}
