import type { ReactNode } from "react";

export type EmployeeWorkspaceTabId =
  | "basic"
  | "profile"
  | "services"
  | "schedule"
  | "shifts"
  | "attendance"
  | "payroll"
  | "requests"
  | "leaves"
  | "messages"
  | "files";

export type EmployeeWorkspaceDisplayState = "ready" | "loading" | "empty" | "error";

export type EmployeeWorkspaceDialogId =
  | "image"
  | "shift"
  | "attendance"
  | "file"
  | null;

export type EmployeeWorkspaceDrawerId = "day" | "service" | "audit" | null;

export type EmployeeWorkspaceConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "success" | "gold" | "default";
  detail?: ReactNode;
  onConfirm?: () => void;
} | null;

export type EmployeeWorkspaceTabDefinition = {
  id: EmployeeWorkspaceTabId;
  label: string;
  shortLabel: string;
  description: string;
};

export type EmployeeWorkspaceTabProps = {
  readOnly: boolean;
  markDirty: () => void;
  openDialog: (dialog: Exclude<EmployeeWorkspaceDialogId, null>) => void;
  openDrawer: (drawer: Exclude<EmployeeWorkspaceDrawerId, null>) => void;
  requestConfirm: (confirm: NonNullable<EmployeeWorkspaceConfirmState>) => void;
};

export const EMPLOYEE_WORKSPACE_TABS: readonly EmployeeWorkspaceTabDefinition[] = [
  {
    id: "basic",
    label: "البيانات الأساسية",
    shortLabel: "الأساسية",
    description: "الاسم والحالة والظهور والإجازة الأسبوعية والتحقق من جاهزية الحساب.",
  },
  {
    id: "profile",
    label: "الملف والصورة",
    shortLabel: "الملف",
    description: "الصورة والنبذة والتقييم وروابط السيرة وحالات تعذر تحميل الوسائط.",
  },
  {
    id: "services",
    label: "الخدمات",
    shortLabel: "الخدمات",
    description: "إسناد الخدمات والبحث والتصفية ومراجعة القائمة المختارة.",
  },
  {
    id: "schedule",
    label: "جدول الدوام",
    shortLabel: "الدوام",
    description: "أيام العمل والإجازات والنطاق ونسخ الجدول والاستثناءات المؤرخة.",
  },
  {
    id: "shifts",
    label: "الشفتات",
    shortLabel: "الشفتات",
    description: "قوالب الشفتات والتعيينات الدائمة والمؤقتة والاستثناءات وتأثير الرواتب.",
  },
  {
    id: "attendance",
    label: "الحضور",
    shortLabel: "الحضور",
    description: "التقويم الشهري وملخص الانضباط وتفاصيل اليوم وتعديل البصمات.",
  },
  {
    id: "payroll",
    label: "سجل الرواتب",
    shortLabel: "الرواتب",
    description: "إعداد الراتب ودورة الاستحقاق والساعات والأوفر تايم وقفل الفترات.",
  },
  {
    id: "requests",
    label: "الطلبات",
    shortLabel: "الطلبات",
    description: "طلبات الموظفة ومراجعة المرفقات والقبول والرفض وسجل الإجراءات.",
  },
  {
    id: "leaves",
    label: "الإجازات",
    shortLabel: "الإجازات",
    description: "الرصيد والحركات والاستحقاق والإجازات الاستثنائية والعودة المتوقعة.",
  },
  {
    id: "messages",
    label: "الرسائل",
    shortLabel: "الرسائل",
    description: "محادثة داخلية وحالات القراءة والإرفاق وإعادة محاولة الرسائل المتعثرة.",
  },
  {
    id: "files",
    label: "الملفات",
    shortLabel: "الملفات",
    description: "تصنيف المستندات والرفع والانتهاء والمعاينة والاستبدال والحذف.",
  },
] as const;
