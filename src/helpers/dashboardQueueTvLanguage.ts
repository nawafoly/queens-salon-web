import { dashboardText, type DashboardLanguage } from "./dashboardLanguage";

export type { DashboardLanguage } from "./dashboardLanguage";

const queueTvEnglish: Record<string, string> = {
  "جاري تحميل حجوزات اليوم...": "Loading today's bookings...",
  "تعذر تحميل حجوزات اليوم من خدمة الحجز. حدث الشاشة أو تأكد من تسجيل الدخول.": "Could not load today's bookings from the booking service. Refresh the screen or make sure you are signed in.",
  "تعذر تشغيل الفيديو. تأكد من صيغة MP4 (H.264 + AAC).": "Could not play the video. Make sure it is MP4 (H.264 + AAC).",
  "لا توجد حجوزات فعالة لعرضها الآن.": "There are no active bookings to display right now.",
  "حجز": "Booking",
  "الحالي": "Current",
  "قادم": "Upcoming",
  "العميلة": "Client",
  "الموظفة": "Staff member",
  "الوقت": "Time",
  "ينتهي بعد": "Ends in",
  "باقي": "Remaining",
  "الشاشة التشغيلية": "Operations display",
  "شاشة قائمة الانتظار": "Queue screen",
  "متابعة بث الفيديو الترويجي وحجوزات اليوم الحالية والقادمة من مساحة تشغيلية واحدة.": "Monitor promotional video playback and today's current and upcoming bookings from one operational screen.",
  "حالة الشاشة": "Screen status",
  "الوقت الآن": "Current time",
  "تحديث ذكي تلقائي": "Smart auto refresh",
  "ملخص شاشة الانتظار": "Queue screen summary",
  "الحجوزات المعروضة": "Displayed bookings",
  "بعد استبعاد الملغي والمنتهي": "After excluding cancelled and expired bookings",
  "الحالي الآن": "Current now",
  "ضمن نافذة العرض الحالية": "Within the current display window",
  "الحجوزات القادمة": "Upcoming bookings",
  "مرتبة حسب وقت الموعد": "Sorted by appointment time",
  "الفيديوهات المتاحة": "Available videos",
  "قائمة تشغيل تلقائية": "Automatic playlist",
  "الفيديو الترويجي": "Promotional video",
  "تشغيل تلقائي متتابع للمواد المتاحة داخل شاشة الصالون.": "Automatically play available promotional media on the salon screen.",
  "الفيديو الحالي": "Current video",
  "تشغيل تلقائي": "Auto play",
  "قائمة حجوزات اليوم": "Today's booking queue",
  "الحجوزات الحالية أولًا ثم القادمة، مع عد تنازلي محدث كل ثانية.": "Current bookings first, then upcoming bookings, with a countdown updated every second.",
  "إجمالي الحجوزات المعروضة": "Total displayed bookings",
  "تعذر تحميل حجوزات اليوم": "Could not load today's bookings",
  "ستتم إعادة المحاولة تلقائيًا أثناء بقاء الشاشة مفتوحة.": "The screen will retry automatically while it remains open.",
  "لا توجد حجوزات فعالة الآن": "No active bookings right now"
};

export function queueTvText(language: DashboardLanguage, arabic: string): string {
  if (language === "ar") return arabic;
  return queueTvEnglish[arabic] ?? dashboardText(language, arabic);
}
