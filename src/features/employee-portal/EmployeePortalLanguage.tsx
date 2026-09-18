import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type EmployeePortalLanguage = "ar" | "en";

const STORAGE_KEY = "malikat.employeePortal.language.v1";

const messages = {
  ar: {
    "language.switch": "English",
    "language.switchAria": "عرض بوابة الموظف باللغة الإنجليزية",
    "portal.aria": "التنقل داخل بوابة الموظف",
    "portal.profileLabel": "بوابة الموظف",
    "portal.subtitle": "الدوام، الطلبات، الملفات والرسائل",
    "portal.loading": "جاري تحميل بوابة الموظف",
    "portal.loadingSubtitle": "نستعد لعرض الرسائل والملفات والإجازات والتنبيهات الخاصة بك.",
    "portal.notifications": "التنبيهات",
    "portal.notificationsUpdating": "جاري تحديث التنبيهات...",
    "portal.newRequest": "إنشاء طلب جديد",
    "portal.logout": "تسجيل الخروج",
    "portal.loggingOut": "جاري الخروج...",
    "portal.hr": "لوحة HR",
    "portal.dashboard": "الداشبورد",
    "role.owner": "المالك",
    "role.admin": "الإدارة",
    "role.hr": "الموارد البشرية",
    "role.reception": "الاستقبال",
    "role.staff": "موظفة",
    "title.overview": "بوابة الموظف",
    "title.attendance": "الحضور والانصراف",
    "title.notifications": "التنبيهات",
    "title.more": "المزيد",
    "title.profile": "الملف الشخصي",
    "title.messages": "الرسائل",
    "title.files": "الملفات",
    "title.leave": "الإجازات والطلبات",
    "title.permission": "الاستئذانات",
    "title.requests": "طلباتي",
    "title.payroll": "الراتب",
    "title.targets": "تارقتي",
    "title.consumption": "حجوزاتي",
    "nav.home": "الرئيسية",
    "nav.homeDescription": "ملخص يوم العمل",
    "nav.attendance": "الحضور",
    "nav.attendanceFull": "الحضور والانصراف",
    "nav.attendanceDescription": "السجل الشهري",
    "nav.bookings": "حجوزاتي",
    "nav.bookingsDescription": "حجوزاتك وتأكيد المواد بعد التنفيذ",
    "nav.requests": "الطلبات",
    "nav.myRequests": "طلباتي",
    "nav.requestsDescription": "المتابعة والقرارات والتنفيذ",
    "nav.more": "المزيد",
    "nav.payroll": "الراتب",
    "nav.payrollDescription": "التفاصيل المالية",
    "nav.targets": "تارقتي",
    "nav.targetsDescription": "المبيعات المؤهلة والبونص المتوقع",
    "nav.messages": "الرسائل",
    "nav.messagesDescription": "التواصل الداخلي",
    "nav.files": "الملفات",
    "nav.filesDescription": "المستندات والعقود",
    "nav.profile": "الملف الشخصي",
    "nav.profileDescription": "البيانات الوظيفية",
    "nav.notifications": "التنبيهات",
    "nav.notificationsDescription": "آخر التحديثات",
  },
  en: {
    "language.switch": "العربية",
    "language.switchAria": "Display the employee portal in Arabic",
    "portal.aria": "Employee portal navigation",
    "portal.profileLabel": "Employee Portal",
    "portal.subtitle": "Attendance, requests, files and messages",
    "portal.loading": "Loading employee portal",
    "portal.loadingSubtitle": "Preparing your messages, files, leave requests and notifications.",
    "portal.notifications": "Notifications",
    "portal.notificationsUpdating": "Updating notifications...",
    "portal.newRequest": "Create new request",
    "portal.logout": "Sign out",
    "portal.loggingOut": "Signing out...",
    "portal.hr": "HR Dashboard",
    "portal.dashboard": "Dashboard",
    "role.owner": "Owner",
    "role.admin": "Management",
    "role.hr": "Human Resources",
    "role.reception": "Reception",
    "role.staff": "Employee",
    "title.overview": "Employee Portal",
    "title.attendance": "Attendance",
    "title.notifications": "Notifications",
    "title.more": "More",
    "title.profile": "Profile",
    "title.messages": "Messages",
    "title.files": "Files",
    "title.leave": "Leave and Requests",
    "title.permission": "Permissions",
    "title.requests": "My Requests",
    "title.payroll": "Payroll",
    "title.targets": "My Targets",
    "title.consumption": "My Bookings",
    "nav.home": "Home",
    "nav.homeDescription": "Workday summary",
    "nav.attendance": "Attendance",
    "nav.attendanceFull": "Attendance",
    "nav.attendanceDescription": "Monthly record",
    "nav.bookings": "My Bookings",
    "nav.bookingsDescription": "Bookings and material confirmation",
    "nav.requests": "Requests",
    "nav.myRequests": "My Requests",
    "nav.requestsDescription": "Follow-up, decisions and execution",
    "nav.more": "More",
    "nav.payroll": "Payroll",
    "nav.payrollDescription": "Financial details",
    "nav.targets": "My Targets",
    "nav.targetsDescription": "Eligible sales and expected bonus",
    "nav.messages": "Messages",
    "nav.messagesDescription": "Internal communication",
    "nav.files": "Files",
    "nav.filesDescription": "Documents and contracts",
    "nav.profile": "Profile",
    "nav.profileDescription": "Employment information",
    "nav.notifications": "Notifications",
    "nav.notificationsDescription": "Latest updates",
  },
} as const;

export type EmployeePortalMessageKey = keyof typeof messages.ar;

type EmployeePortalLanguageContextValue = {
  language: EmployeePortalLanguage;
  direction: "rtl" | "ltr";
  setLanguage: (language: EmployeePortalLanguage) => void;
  toggleLanguage: () => void;
  t: (key: EmployeePortalMessageKey) => string;
};

const EmployeePortalLanguageContext = createContext<EmployeePortalLanguageContextValue | null>(null);

function readInitialLanguage(): EmployeePortalLanguage {
  if (typeof window === "undefined") return "ar";
  return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ar";
}

export function EmployeePortalLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<EmployeePortalLanguage>(readInitialLanguage);

  const setLanguage = useCallback((nextLanguage: EmployeePortalLanguage) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((currentLanguage) => {
      const nextLanguage = currentLanguage === "ar" ? "en" : "ar";
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
      return nextLanguage;
    });
  }, []);

  const value = useMemo<EmployeePortalLanguageContextValue>(() => ({
    language,
    direction: language === "ar" ? "rtl" : "ltr",
    setLanguage,
    toggleLanguage,
    t: (key) => messages[language][key],
  }), [language, setLanguage, toggleLanguage]);

  return (
    <EmployeePortalLanguageContext.Provider value={value}>
      {children}
    </EmployeePortalLanguageContext.Provider>
  );
}

export function useEmployeePortalLanguage() {
  const context = useContext(EmployeePortalLanguageContext);
  if (!context) {
    throw new Error("useEmployeePortalLanguage must be used within EmployeePortalLanguageProvider");
  }
  return context;
}
