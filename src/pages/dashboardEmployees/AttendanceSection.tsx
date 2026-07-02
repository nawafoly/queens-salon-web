import AttendanceMonthView from "../../components/AttendanceMonthView";
import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
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
        subtitle="اختر الشهر لعرض تقويم الحضور اليومي، ثم اختر اليوم لمراجعة السجلات."
        showAdminActions
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onGenerateSummary={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
      />
    </div>
  );
}
