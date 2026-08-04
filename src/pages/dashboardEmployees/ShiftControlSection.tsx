import { EmployeeLinkedModuleTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";

type ShiftControlSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeName?: string;
  canManage: boolean;
};

export default function ShiftControlSection({
  isVisible,
  employeeId,
  employeeName,
  canManage,
}: ShiftControlSectionProps) {
  if (!isVisible) return null;

  return (
    <EmployeeLinkedModuleTabLiveV2
      title="الشفتات"
      description="إدارة شفتات الموظفة من مساحة V2 مع إبقاء بيانات الموظفة الحالية ومسارات Core كما هي."
      moduleLabel={canManage ? "إدارة الشفتات" : "عرض الشفتات"}
      actionLabel="تحديث بيانات الشفتات"
      actionHref={`/admin/employees/${employeeId}/shifts`}
      notes={[
        employeeName ? `الموظفة: ${employeeName}` : "ملف الموظفة الحالي",
        "قوالب الشفتات والتعيينات التاريخية محفوظة في Core",
        "التحكم الكامل يبقى داخل نفس تبويب الموظفة بدون CSS قديم",
      ]}
    />
  );
}
