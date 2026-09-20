import { dashboardText, type DashboardLanguage } from "./dashboardLanguage";

export type { DashboardLanguage } from "./dashboardLanguage";

const loyaltyEnglish: Record<string, string> = {
  "تعذر تحميل بيانات الولاء من Core D1.": "Could not load loyalty data from Core D1.",
  "تم تحديث حالة VIP في Core D1، لكن تعذر تحديث ملخص الولاء.": "VIP status was updated in Core D1, but the loyalty summary could not be refreshed.",
  "تعذر تحديث حالة VIP في Core D1.": "Could not update VIP status in Core D1.",
  "تعذر البحث في بيانات الولاء من Core D1.": "Could not search loyalty data in Core D1.",
  "برنامج الولاء والعملاء المميزون": "Loyalty & VIP clients",
  "رصيد النقاط وحالة VIP هنا من Core D1 فقط؛ لا توجد نسخة تشغيلية موازية في Firestore.": "Points balances and VIP status come only from Core D1; there is no parallel operational copy in Firestore.",
  "إجمالي العملاء": "Total clients",
  "نتيجة محملة — حد العرض 500": "loaded results — display limit 500",
  "ملخص الولاء": "Loyalty summary",
  "من سجل العملاء Canonical": "From the canonical client registry",
  "عملاء VIP": "VIP clients",
  "حالة VIP في Core D1": "VIP status in Core D1",
  "لديهم رصيد نقاط": "Clients with points",
  "رصيد موجب محسوب من المصدر التشغيلي Canonical في Core D1": "Positive balance calculated from the canonical operational source in Core D1",
  "إجمالي رصيد النقاط": "Total points balance",
  "محسوب من الحجوزات والاستردادات المكتملة والتعديلات اليدوية في Core D1": "Calculated from completed bookings, reversals and manual adjustments in Core D1",
  "مصدر بيانات الولاء": "Loyalty data source",
  "مصدر الحقيقة": "Source of truth",
  "سياسة الولاء التشغيلية": "Operational loyalty policy",
  "هذه الشاشة لم تعد تحفظ إعدادات ولاء محلية أو في Firestore. أي تغيير في سياسة احتساب النقاط يجب أن يمر عبر Core حتى يطبّق على الداشبورد وبوابة العميلة بنفس القاعدة.": "This screen no longer stores local or Firestore loyalty settings. Any points-policy change must go through Core so the dashboard and client portal use the same rule.",
  "تحديث من Core D1": "Refresh from Core D1",
  "قائمة العملاء": "Client list",
  "قائمة العملاء والولاء": "Clients & loyalty",
  "عرض الرصيد والحركات المجمعة من Core وتحديث VIP على السجل Canonical.": "View balances and aggregated Core activity, and update VIP status on the canonical client record.",
  "بحث باسم العميل أو رقم الجوال...": "Search by client name or phone...",
  "جارٍ تحميل بيانات العملاء...": "Loading client data...",
  "الاسم": "Name",
  "الجوال": "Phone",
  "الرصيد": "Balance",
  "مكتسبة": "Earned",
  "مستخدمة / معكوسة": "Used / reversed",
  "آخر زيارة مكتملة": "Last completed visit",
  "عميل غير مسمى": "Unnamed client",
  "نقطة": "points",
  "جارٍ الحفظ...": "Saving...",
  "إلغاء VIP": "Remove VIP",
  "ترقية لـ VIP": "Promote to VIP",
  "لا توجد نتائج للبحث": "No search results"
};

export function loyaltyText(language: DashboardLanguage, arabic: string): string {
  if (language === "ar") return arabic;
  return loyaltyEnglish[arabic] ?? dashboardText(language, arabic);
}
