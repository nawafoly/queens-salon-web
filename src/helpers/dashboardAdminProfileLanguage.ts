import { dashboardText, type DashboardLanguage } from "./dashboardLanguage";

export type { DashboardLanguage } from "./dashboardLanguage";

const adminProfileEnglish: Record<string, string> = {
  "المالك": "Owner",
  "الإدارة": "Admin",
  "الموارد البشرية": "HR",
  "الاستقبال": "Reception",
  "الموظفات": "Staff",
  "قيد المراجعة": "Pending review",
  "عميلة": "Client",
  "ضيف": "Guest",
  "تعذر تحميل الملف الشخصي من Core.": "Could not load the profile from Core.",
  "الاسم مطلوب.": "Name is required.",
  "تم حفظ الملف الشخصي بنجاح.": "Profile saved successfully.",
  "تعذر حفظ الملف الشخصي في Core.": "Could not save the profile in Core.",
  "جاري تحميل الملف الشخصي": "Loading profile",
  "غير مصرح": "Not authorized",
  "هذه الصفحة مخصصة لحسابات Owner / Admin فقط.": "This page is available only to Owner / Admin accounts.",
  "الملف الشخصي الإداري": "Admin profile",
  "الملف الشخصي": "Profile",
  "تحديث بيانات حساب الإدارة التي تظهر داخل لوحة التحكم مع إبقاء الهوية والدور محميين.": "Update the admin account details shown in the dashboard while keeping identity and role protected.",
  "الملف مرتبط": "Profile linked",
  "حساب Core غير موجود": "Core account not found",
  "هوية الحساب": "Account identity",
  "صورة الحساب": "Account photo",
  "حساب الإدارة": "Admin account",
  "لا يوجد بريد مسجل": "No email registered",
  "ملخص الملف الشخصي": "Profile summary",
  "الدور": "Role",
  "صلاحية الحساب الحالية": "Current account role",
  "مستند الحساب": "Account record",
  "موجود": "Available",
  "مفقود": "Missing",
  "البريد الإلكتروني": "Email",
  "مرتبط": "Linked",
  "غير مسجل": "Not registered",
  "يُعرض فقط ولا يُعدل هنا": "Display only; cannot be edited here",
  "الصورة الشخصية": "Profile photo",
  "مضافة": "Added",
  "اختيارية": "Optional",
  "رابط صورة الحساب": "Account image URL",
  "بيانات الحساب": "Account details",
  "يمكن تعديل الاسم والجوال والصورة فقط. البريد والدور يبقيان للعرض من مصدر الهوية الحالي.": "Only name, phone and photo can be edited. Email and role remain read-only from the current identity source.",
  "جاهز للحفظ": "Ready to save",
  "الحفظ متوقف": "Saving disabled",
  "الاسم": "Name",
  "رقم الجوال": "Phone number",
  "رابط الصورة الشخصية": "Profile photo URL",
  "مسار ملف الحساب": "Account record path",
  "لم يتم تفعيل الحفظ لأن حساب المستخدم غير موجود في Core D1.": "Saving is disabled because the user account does not exist in Core D1.",
  "حفظ الملف الشخصي": "Save profile",
  "يحفظ الاسم والجوال ورابط الصورة ثم يحدّث بيانات الجلسة المحلية المستخدمة في لوحة التحكم.": "Saves the name, phone and photo URL, then refreshes the local session data used by the dashboard.",
  "جاري الحفظ...": "Saving...",
  "حفظ التغييرات": "Save changes"
};

export function adminProfileText(language: DashboardLanguage, arabic: string): string {
  if (language === "ar") return arabic;
  return adminProfileEnglish[arabic] ?? dashboardText(language, arabic);
}
