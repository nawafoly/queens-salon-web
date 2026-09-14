import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots } from "@fortawesome/free-solid-svg-icons";
import { AppSettingsService } from "../services/AppSettingsService";
import { CoreCatalogService } from "../services/CoreCatalogService";
import { CoreSettingsService } from "../services/CoreSettingsService";
import { coreApiRequest } from "../services/coreApiClient";
import { formatTime12 } from "../helpers/timeDisplay";
import { generateSalonTimeSlots } from "../helpers/timeSlots";

type Sender = "user" | "bot";
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type FlowStep = "idle" | "ask_section" | "ask_category" | "ask_service" | "ask_date";

type Action =
  | { type: "send"; label: string; value: string }
  | { type: "route"; label: string; value: string };

interface Message {
  id: number;
  text: string;
  sender: Sender;
  showAllPricesBtn?: boolean;
  actions?: Action[];
}

type OfferLike = {
  id?: string | number;
  title?: string;
  code?: string;
  validUntil?: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  active?: boolean;
};

type ServiceDoc = {
  id: string;
  name?: string;
  price?: number;
  durationMin?: number;
  active?: boolean;
  sectionId?: string;
  categoryId?: string;
  category?: string;
  categoryName?: string;
  "التصنيف"?: string;
  "الاسم"?: string;
  "category_ar"?: string;
  "name_ar"?: string;
};

type SectionDoc = {
  id: string;
  name?: string;
  title?: string;
  active?: boolean;
  "الاسم"?: string;
  "name_ar"?: string;
};

type CategoryDoc = {
  id: string;
  sectionId?: string;
  name?: string;
  title?: string;
  active?: boolean;
  "الاسم"?: string;
  "name_ar"?: string;
};

type CategoryOption = {
  id?: string;
  name: string;
};

type PublicSettings = {
  phone?: string;
  whatsapp?: string;
  locationText?: string;
  hoursText?: string;
};

type BusinessHoursDay = {
  enabled: boolean;
  start: string;
  end: string;
};

type BookingHourOverride = {
  id?: string;
  fromDate: string;
  toDate: string;
  mode: "hours" | "closed";
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

type BookingSettingsLite = {
  slotStepMin: number;
  businessHours: Record<WeekdayKey, BusinessHoursDay>;
  bookingHourOverrides: BookingHourOverride[];
  holidays: Array<{ date: string; reason?: string }>;
  closures: Array<{ from: string; to: string; message?: string }>;
  publicClosedMessage?: string;
};

type BookingFlow = {
  step: FlowStep;
  intent?: "booking" | "pricing";
  sectionId?: string;
  sectionName?: string;
  categoryId?: string;
  categoryName?: string;
  serviceId?: string;
  serviceName?: string;
  suggestedDateISO?: string;
};

const STORAGE = {
  CHAT: "chatbot_history_v1",
  OFFERS_KEYS: [
    "offers",
    "offers_v1",
    "offers_v2",
    "dashboard_offers_v1",
    "offers_data",
    "OfferEngine_offers_v1",
    "offerEngine_offers_v1",
    "offersManager_offers_v1",
    "coupons",
    "coupons_v1",
  ],
};

const ACTION_SECTION_PREFIX = "section::";
const ACTION_CATEGORY_PREFIX = "category::";
const ACTION_CATEGORY_NAME_PREFIX = "category_name::";
const ACTION_SERVICE_PREFIX = "service::";
const ACTION_CONTINUE_BOOKING = "__continue_booking__";
const ACTION_SHOW_OPEN_DAYS = "__show_open_days__";
const INITIAL_BOT_MESSAGE = "مرحبًا 👋 أنا مساعدتك في صالون ملكات.\nاكتبي سؤالك وأنا معك.";

const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الاثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

const defaultBusinessHours = (): Record<WeekdayKey, BusinessHoursDay> => ({
  sat: { enabled: true, start: "12:00", end: "22:00" },
  sun: { enabled: true, start: "12:00", end: "22:00" },
  mon: { enabled: true, start: "12:00", end: "22:00" },
  tue: { enabled: true, start: "12:00", end: "22:00" },
  wed: { enabled: true, start: "12:00", end: "22:00" },
  thu: { enabled: true, start: "12:00", end: "22:00" },
  fri: { enabled: false, start: "12:00", end: "22:00" },
});

const defaultFlow: BookingFlow = { step: "idle" };

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const normalizeArabic = (s: string) =>
  s
    .replace(/[\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeDigits = (s: string) =>
  String(s || "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[غ°-غ¹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
const toWhatsAppLink = (rawPhone: string) => {
  const digits = String(rawPhone || "").replace(/[^\d+]/g, "");
  if (!digits) return "https://wa.me/";
  let normalized = digits.replace(/^\+/, "");
  if (normalized.startsWith("00")) normalized = normalized.slice(2);
  if (normalized.startsWith("05")) normalized = `966${normalized.slice(1)}`;
  return `https://wa.me/${normalized}`;
};

const getLabel = (x: any) =>
  String(x?.name ?? x?.title ?? x?.["الاسم"] ?? x?.["name_ar"] ?? "").trim();

const getServiceName = (x: any) =>
  String(x?.name ?? x?.["الاسم"] ?? x?.["name_ar"] ?? "").trim();

const getServiceCategoryName = (x: any) =>
  String(x?.category ?? x?.categoryName ?? x?.["التصنيف"] ?? x?.["category_ar"] ?? "").trim();

const isGreeting = (qRaw: string) =>
  /(السلام\s*(عليكم|عليكم|علكيم|علكم|عليكم|عليكو|عليك)|وعليكم\s*السلام|يا\s*هلا|ياهلا|هلا|اهلا|اهلين|مرحبا|hi|hello)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const resolveGreetingReply = (qRaw: string) => {
  const q = normalizeArabic(qRaw.toLowerCase());
  if (/(السلام\s*(عليكم|عليكم|علكيم|علكم|عليكم|عليكو|عليك)|وعليكم\s*السلام)/i.test(q)) return "وعليكم السلام 💜";
  if (/(يا\s*هلا|ياهلا|هلا|اهلا|اهلين)/i.test(q)) return "أهلين 💜";
  if (/مرحبا/i.test(q)) return "مرحبًا 💜";
  if (/(hi|hello)/i.test(qRaw.toLowerCase())) return "Hello 💜";
  return "أهلًا وسهلًا 💜";
};

const isHowAreYou = (qRaw: string) =>
  /(كيف حالك|كيفك|شلونك|اخبارك|how are you)/i.test(normalizeArabic(qRaw.toLowerCase()));

const isBotIdentity = (qRaw: string) =>
  /(مين انتي|من انتي|وش انتي|من تكونين|انت مين|انتي مين|من انت|من انتي|who are you)/i.test(normalizeArabic(qRaw.toLowerCase()));

const isThanks = (qRaw: string) =>
  /(شكرا|شكراً|يعطيك العافيه|مشكور|تسلم|الله يعطيك العافيه)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isBye = (qRaw: string) => /(مع السلامه|باي|وداع|اشوفك|تصبح)/i.test(normalizeArabic(qRaw.toLowerCase()));

const isComplaint = (qRaw: string) =>
  /(سيء|سيئ|مو زين|زفت|خايس|مضايق|ما عجبني|تجربه سيئه)/i.test(normalizeArabic(qRaw.toLowerCase()));

const isSalonBrandMention = (qRaw: string) =>
  /(صالون ملكات|ملكات|malikat salon|malikat|queens salon|queens)/i.test(normalizeArabic(qRaw.toLowerCase()));

const isBookingIntent = (qRaw: string) =>
  /(ابي احجز|ابغى احجز|احجزي موعد|احجز|حجز|ابي موعد|ابغى موعد|book|booking|reservation)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isPricingIntent = (qRaw: string) =>
  /(قائمه الاسعار|عرض قائمه الاسعار|الاسعار|اسعاركم|بكم|كم سعر|price|pricing)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isOffersIntent = (qRaw: string) =>
  /(العروض|عروض|الخصومات|خصومات|تخفيضات|تخفيض|برومو|كوبون|offer|offers|discount)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isContactIntent = (qRaw: string) =>
  /(تواصل|اتصال|رقم|واتس|واتساب|whatsapp|موقع|عنوان|وينكم|اوقات الدوام)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isAvailabilityIntent = (qRaw: string) =>
  /(اوقات متاحه|اوقات متاحه|مواعيد متاحه|مواعيد متاحه|وقت متاح|available|slots|timeslots)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isResetIntent = (qRaw: string) =>
  /(الغاء|إلغاء|كنسل|cancel|stop|خلاص|ابدا من جديد|restart|reset)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isHelpIntent = (qRaw: string) =>
  /(ساعدني|ساعديني|مساعده|مساعدة|help|ما فهمت|وش اقدر|ايش الخدمات)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const isTopicSwitchIntent = (qRaw: string) =>
  /(غير الموضوع|موضوع ثاني|خلينا نغير|نغير الموضوع|مو هذا|شي ثاني|موضوع اخر|change topic|something else)/i.test(
    normalizeArabic(qRaw.toLowerCase())
  );

const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => toISODate(new Date());
const addDaysISO = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};
const toDMY = (iso: string) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

const parseDateSmart = (text: string): string | null => {
  const raw = normalizeDigits(text || "").trim();
  const q = normalizeArabic(raw.toLowerCase());
  if (!raw) return null;

  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const dm = raw.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const now = new Date();
      let y = now.getFullYear();
      const candidate = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
      const today = new Date(`${toISODate(now)}T00:00:00`);
      if (candidate < today) y += 1;
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const base = todayISO();
  if (/(^|\s)(اليوم|today|now)(\s|$)/i.test(q)) return base;
  if (/(^|\s)(بكره|بكرة|غدا|tomorrow)(\s|$)/i.test(q)) return addDaysISO(base, 1);
  if (/(بعد بكره|بعد بكرة|day after tomorrow)/i.test(q)) return addDaysISO(base, 2);

  const dayMap: Array<{ r: RegExp; day: number }> = [
    { r: /(الاحد|الأحد|sunday)/i, day: 0 },
    { r: /(الاثنين|الإثنين|monday)/i, day: 1 },
    { r: /(الثلاثاء|tuesday)/i, day: 2 },
    { r: /(الاربعاء|الأربعاء|wednesday)/i, day: 3 },
    { r: /(الخميس|thursday)/i, day: 4 },
    { r: /(الجمعة|friday)/i, day: 5 },
    { r: /(السبت|saturday)/i, day: 6 },
  ];
  const hit = dayMap.find((x) => x.r.test(q));
  if (!hit) return null;
  const now = new Date(`${base}T00:00:00`);
  let diff = hit.day - now.getDay();
  if (diff < 0) diff += 7;
  if (diff === 0 && /(الجاي|القادم|next)/i.test(q)) diff = 7;
  return addDaysISO(base, diff);
};

const resolveWeekdayFromISO = (isoDate: string): WeekdayKey => {
  const d = new Date(`${isoDate}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
  if (day === 0) return "sun";
  if (day === 1) return "mon";
  if (day === 2) return "tue";
  if (day === 3) return "wed";
  if (day === 4) return "thu";
  if (day === 5) return "fri";
  return "sat";
};

const normalizeWeekdayList = (v: any): WeekdayKey[] => {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  const out: WeekdayKey[] = [];
  for (const d0 of v) {
    const d = String(d0 || "").trim().toLowerCase() as WeekdayKey;
    if (allowed.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
};

const readBookingHourOverrides = (raw: any): BookingHourOverride[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => {
      const fromDate = String(x?.fromDate || "").trim();
      const toDate = String(x?.toDate || "").trim();
      if (!fromDate || !toDate) return null;
      return {
        id: String(x?.id || "").trim() || undefined,
        fromDate,
        toDate,
        mode: String(x?.mode || "").trim() === "closed" ? "closed" : "hours",
        start: String(x?.start || "").trim() || undefined,
        end: String(x?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(x?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(x?.blockedWeekdays),
      };
    })
    .filter(Boolean) as BookingHourOverride[];
};

function formatAvailableTimes(times: string[]) {
  if (!times.length) return "للأسف ما فيه أوقات متاحة بهذا اليوم.";
  const chunk = times.slice(0, 10);
  return (
    "🕒 **الأوقات المتاحة:**\n" +
    chunk.map((t) => `• ${formatTime12(t, t)}`).join("\n") +
    (times.length > chunk.length ? `\n\n… وفيه ${times.length - chunk.length} وقت إضافي.` : "")
  );
}

function readOffersFromLocalStorage(): OfferLike[] {
  for (const key of STORAGE.OFFERS_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const parsed = safeJsonParse<any>(raw, null);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.offers)) return parsed.offers;
      if (Array.isArray(parsed.coupons)) return parsed.coupons;
      if (Array.isArray(parsed.data)) return parsed.data;
      if (Array.isArray(parsed.items)) return parsed.items;
    }
  }
  return [];
}

function filterActiveOffers(offers: OfferLike[]): OfferLike[] {
  const today = new Date();
  const toDate = (s?: string) => (s ? new Date(s) : null);
  return offers.filter((o) => {
    const flag = o.isActive ?? o.active;
    const start = toDate(o.startDate);
    const end = toDate(o.validUntil ?? o.endDate);
    if (typeof flag === "boolean" && !flag) return false;
    if (start && today < start) return false;
    if (end && today > end) return false;
    return true;
  });
}

const ChatBot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [hintsOpen, setHintsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const floatingScrollRestoreRef = useRef<number | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const isChatPage = location.pathname.startsWith("/chat");

  const hideFloatingChatPaths = [
    "/offers",
    "/booking",
    "/checkout",
    "/pay",
    "/payment-callback",
    "/success",
    "/success-internal",
    "/track",
    "/login",
    "/forgot-password",
  ];

  const shouldHideFloatingChat =
    !isChatPage &&
    hideFloatingChatPaths.some(
      (path) =>
        location.pathname === path ||
        location.pathname.startsWith(`${path}/`)
    );

  const [services, setServices] = useState<ServiceDoc[]>([]);
  const [sections, setSections] = useState<SectionDoc[]>([]);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [bookingsCache, setBookingsCache] = useState<Record<string, string[]>>({});
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [flow, setFlow] = useState<BookingFlow>(defaultFlow);
  const [chatViewportHeight, setChatViewportHeight] = useState("100dvh");
  const [chatKeyboardInset, setChatKeyboardInset] = useState("0px");
  const [bookingSettings, setBookingSettings] = useState<BookingSettingsLite>({
    slotStepMin: 5,
    businessHours: defaultBusinessHours(),
    bookingHourOverrides: [],
    holidays: [],
    closures: [],
    publicClosedMessage: "",
  });

  const pageActions: Action[] = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith("/booking")) {
      return [
        { type: "send", label: "احجزي موعد", value: "أبي أحجز" },
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
      ];
    }
    if (path.startsWith("/offers")) {
      return [
        { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
        { type: "route", label: "احجزي الآن", value: "/booking" },
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      ];
    }
    return [
      { type: "send", label: "احجزي موعد", value: "أبي أحجز" },
      { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
      { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
    ];
  }, [location.pathname]);

  const footerQuickActions: Action[] = useMemo(
    () => [
      flow.step === "idle"
        ? { type: "send", label: "احجزي موعد", value: "أبي أحجز" }
        : { type: "send", label: "كمّلي الحجز", value: ACTION_CONTINUE_BOOKING },
      { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
      { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
      { type: "send", label: "المواعيد المتاحة", value: "المواعيد المتاحة" },
      { type: "send", label: "إلغاء / إعادة البدء", value: "إلغاء" },
    ],
    [flow.step]
  );
  const activeServices = useMemo(() => services.filter((s) => s.active !== false), [services]);
  const activeSections = useMemo(
    () => sections.filter((s) => s.active !== false).filter((s) => !!getLabel(s)),
    [sections]
  );

  const pushBot = (payload: { text: string; actions?: Action[]; showAllPricesBtn?: boolean }) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        sender: "bot",
        text: payload.text,
        actions: payload.actions,
        showAllPricesBtn: payload.showAllPricesBtn,
      },
    ]);
  };

  useEffect(() => {
    localStorage.removeItem(STORAGE.CHAT);
    setMessages([
      {
        id: Date.now(),
        sender: "bot",
        text: INITIAL_BOT_MESSAGE,
      },
    ]);
  }, []);

  
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const clearChat = () => localStorage.removeItem(STORAGE.CHAT);
    window.addEventListener("beforeunload", clearChat);
    window.addEventListener("pagehide", clearChat);
    return () => {
      clearChat();
      window.removeEventListener("beforeunload", clearChat);
      window.removeEventListener("pagehide", clearChat);
    };
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoadingCatalog(true);
      try {
        // CORE D1 ONLY — settings + catalog (no Firestore)
        const [appSetting, sectionsRows, categoriesRows, servicesRows, publicSetting] =
          await Promise.all([
            AppSettingsService.fetchRemote(),
            CoreCatalogService.listSections(false),
            CoreCatalogService.listCategories(false),
            CoreCatalogService.listServices({ activeOnly: false }),
            CoreSettingsService.get<Record<string, unknown>>("public"),
          ]);

        const raw = (appSetting as any)?.booking || {};
        setBookingSettings({
          slotStepMin: [5, 10, 15, 30].includes(Number(raw?.slotStepMin))
            ? Number(raw.slotStepMin)
            : 5,
          businessHours: { ...defaultBusinessHours(), ...(raw?.businessHours || {}) },
          bookingHourOverrides: readBookingHourOverrides(raw?.bookingHourOverrides),
          holidays: Array.isArray(raw?.holidays) ? raw.holidays : [],
          closures: Array.isArray(raw?.closures) ? raw.closures : [],
          publicClosedMessage: String(raw?.publicClosedMessage || ""),
        });

        setSections(
          (sectionsRows || []).map((row: any) => ({
            id: String(row.id || ""),
            name: row.name,
            title: row.name,
            active: row.active !== false,
          }))
        );
        setCategories(
          (categoriesRows || []).map((row: any) => ({
            id: String(row.id || ""),
            sectionId: row.sectionId || row.section_id || "",
            name: row.name,
            title: row.name,
            active: row.active !== false,
          }))
        );
        setServices(
          (servicesRows || []).map((row: any) => ({
            id: String(row.id || ""),
            name: row.name,
            price: Number(row.priceHalalas ?? 0) / 100,
            durationMin: Number(row.durationMinutes ?? row.durationMin ?? 0),
            active: row.active !== false,
            sectionId: row.sectionId || row.section_id || "",
            categoryId: row.categoryId || row.category_id || "",
            category: row.categoryName || row.category || "",
            categoryName: row.categoryName || row.category || "",
          }))
        );

        setPublicSettings((publicSetting?.value as any) || null);
      } catch (e) {
        console.error("ChatBot loadData error:", e);
      } finally {
        setLoadingCatalog(false);
      }
    };
    loadData();
  }, []);

  const getCategoryOptionsBySectionId = (sectionId: string): CategoryOption[] => {
    const sid = String(sectionId || "").trim();
    if (!sid) return [];

    const fromCollection = categories
      .filter((c) => c.active !== false)
      .filter((c) => String(c.sectionId || "").trim() === sid)
      .map((c) => ({ id: String(c.id || "").trim(), name: getLabel(c) }))
      .filter((c) => c.name);
    if (fromCollection.length) return fromCollection;

    const seen = new Set<string>();
    return activeServices
      .filter((s) => String(s.sectionId || "").trim() === sid)
      .map((s) => getServiceCategoryName(s))
      .filter(Boolean)
      .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
      .map((name) => ({ name }));
  };

  const getServicesBySelection = (selection: {
    sectionId?: string;
    categoryId?: string;
    categoryName?: string;
  }): ServiceDoc[] => {
    const sid = String(selection.sectionId || "").trim();
    if (!sid) return [];
    let base = activeServices.filter((s) => String(s.sectionId || "").trim() === sid);
    const cid = String(selection.categoryId || "").trim();
    const cname = String(selection.categoryName || "").trim();
    if (cid) base = base.filter((s) => String(s.categoryId || "").trim() === cid);
    else if (cname)
      base = base.filter(
        (s) => normalizeArabic(getServiceCategoryName(s)) === normalizeArabic(cname)
      );
    return base;
  };

  const matchSectionFromUserText = (raw: string): SectionDoc | null => {
    const q = normalizeArabic(raw);
    const exact = activeSections.find((s) => normalizeArabic(getLabel(s)) === q);
    if (exact) return exact;
    return activeSections.find((s) => normalizeArabic(getLabel(s)).includes(q)) || null;
  };

  const matchCategoryFromUserText = (raw: string, options: CategoryOption[]): CategoryOption | null => {
    const q = normalizeArabic(raw);
    const exact = options.find((c) => normalizeArabic(c.name) === q);
    if (exact) return exact;
    return options.find((c) => normalizeArabic(c.name).includes(q)) || null;
  };

  const matchServiceFromUserText = (
    raw: string,
    opts?: { sectionId?: string; categoryId?: string; categoryName?: string }
  ): ServiceDoc | null => {
    const base = getServicesBySelection({
      sectionId: opts?.sectionId,
      categoryId: opts?.categoryId,
      categoryName: opts?.categoryName,
    });
    const q = normalizeArabic(raw);
    const exact = base.find((s) => normalizeArabic(getServiceName(s)) === q);
    if (exact) return exact;
    const partial = base.find((s) => normalizeArabic(getServiceName(s)).includes(q));
    if (partial) return partial;

    const rules: { regex: RegExp; key: string }[] = [
      { regex: /قص|اطراف|غره|مدرج/i, key: "قص" },
      { regex: /تسريح|استشوار/i, key: "تسريح" },
      { regex: /مكياج|ميكب/i, key: "مكياج" },
      { regex: /صبغ|صبغة|هايلايت|بالياج/i, key: "صبغ" },
      { regex: /بدكير|بديكير/i, key: "بدكير" },
      { regex: /مناكير|اظافر/i, key: "مناكير" },
    ];
    const hit = rules.find((r) => r.regex.test(raw));
    if (!hit) return null;
    return base.find((s) => normalizeArabic(getServiceName(s)).includes(normalizeArabic(hit.key))) || null;
  };

  const replyContact = () => {
    const phone = (publicSettings as any)?.phone || (publicSettings as any)?.mobile || "05xxxxxxxx";
    const whatsapp = (publicSettings as any)?.whatsapp || phone;
    const whatsappLink = toWhatsAppLink(String(whatsapp));
    const locationText = (publicSettings as any)?.locationText || "الرياض";
    const hoursText = (publicSettings as any)?.hoursText || "يوميًا";
    return {
      text:
        "📞 **طرق التواصل:**\n" +
        `• الجوال: ${phone}\n` +
        `• واتساب: ${whatsapp}\n` +
        `• الموقع: ${locationText}\n` +
        `• ساعات العمل: ${hoursText}`,
      actions: [
        { type: "route", label: "فتح واتساب", value: whatsappLink },
        { type: "send", label: "احجزي موعد", value: "أبي أحجز" },
      ] as Action[],
    };
  };

  const buildOffersReply = () => {
    const active = filterActiveOffers(readOffersFromLocalStorage());
    if (!active.length) {
      return {
        text: "حاليًا ما عندنا عروض فعّالة مسجلة.\nتبين أعرض لك قائمة الأسعار؟",
        actions: [{ type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" }] as Action[],
      };
    }
    return {
      text:
        "🎉 **العروض الحالية:**\n" +
        active
          .slice(0, 5)
          .map((o) => `• ${o.title || "عرض"}${o.code ? ` | الكود: ${o.code}` : ""}`)
          .join("\n"),
      actions: [{ type: "send", label: "احجزي موعد", value: "أبي أحجز" }] as Action[],
    };
  };

  const buildCategoryPricesText = (selection: {
    sectionId?: string;
    sectionName?: string;
    categoryId?: string;
    categoryName?: string;
  }) => {
    const list = getServicesBySelection({
      sectionId: selection.sectionId,
      categoryId: selection.categoryId,
      categoryName: selection.categoryName,
    })
      .filter((s) => !!getServiceName(s))
      .sort((a, b) => getServiceName(a).localeCompare(getServiceName(b), "ar"));
    if (!list.length) return "ما فيه خدمات ظاهرة لهذا التصنيف حاليًا.";
    return (
      `💰 أسعار ${selection.sectionName || "القسم"} / ${selection.categoryName || "التصنيف"}:\n` +
      list
        .map((s) => `• ${getServiceName(s)}: ${typeof s.price === "number" ? `${s.price} ريال` : "اسألي عن السعر"}`)
        .join("\n")
    );
  };

  const beginBookingFlow = () => {
    if (loadingCatalog) return pushBot({ text: "لحظة 💜 قاعدة أحمّل بيانات الأقسام والخدمات..." });
    if (!activeSections.length) {
      setFlow({ step: "ask_service", intent: "booking" });
      return pushBot({ text: "أكيد 💜 وش الخدمة اللي تبينها؟" });
    }
    setFlow({ step: "ask_section", intent: "booking" });
    pushBot({
      text: "أكيد 💜 اختاري القسم أولًا:",
      actions: activeSections.slice(0, 8).map((s) => ({
        type: "send",
        label: getLabel(s),
        value: `${ACTION_SECTION_PREFIX}${s.id}`,
      })),
    });
  };

  const beginPricesFlow = () => {
    if (loadingCatalog) return pushBot({ text: "لحظة 💜 قاعدة أحمّل بيانات الأقسام والتصنيفات..." });
    if (!activeSections.length) {
      return pushBot({
        text: "حاليًا ما عندي أقسام ظاهرة للأسعار.",
        actions: [{ type: "route", label: "صفحة خدماتنا", value: "/services" }],
      });
    }
    setFlow({ step: "ask_section", intent: "pricing" });
    pushBot({
      text: "ممتاز 💜 لاختيار الأسعار: اختاري القسم أولًا.",
      actions: activeSections.slice(0, 8).map((s) => ({
        type: "send",
        label: getLabel(s),
        value: `${ACTION_SECTION_PREFIX}${s.id}`,
      })),
    });
  };

  const getDaySettingsForDate = (dateISO: string) => {
    const dayKey = resolveWeekdayFromISO(dateISO);
    const dayBase = bookingSettings.businessHours?.[dayKey] || { enabled: true, start: "10:00", end: "22:00" };
    const dayBaseStart = String(dayBase.start || "10:00");
    const dayBaseEnd = String(dayBase.end || "22:00");
    const dateKey = String(dateISO || "").trim();

    const overrides = Array.isArray(bookingSettings.bookingHourOverrides)
      ? bookingSettings.bookingHourOverrides
      : [];
    for (let i = overrides.length - 1; i >= 0; i--) {
      const ov = overrides[i];
      const fromDate = String(ov?.fromDate || "").trim();
      const toDate = String(ov?.toDate || "").trim();
      if (!fromDate || !toDate) continue;
      if (dateKey < fromDate || dateKey > toDate) continue;

      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        return { dayKey, enabled: false, start: dayBaseStart, end: dayBaseEnd };
      }

      return {
        dayKey,
        enabled: true,
        start: String(ov?.start || dayBaseStart),
        end: String(ov?.end || dayBaseEnd),
      };
    }

    return {
      dayKey,
      enabled: dayBase.enabled !== false,
      start: dayBaseStart,
      end: dayBaseEnd,
    };
  };

  const getDayClosureReason = (dateISO: string): string => {
    const dayCfg = getDaySettingsForDate(dateISO);
    if (!dayCfg.enabled) return `${WEEKDAY_LABEL_AR[dayCfg.dayKey]} إجازة حسب ساعات العمل.`;
    const holiday = bookingSettings.holidays.find((h: any) => String(h?.date || "") === dateISO);
    if (holiday) return holiday.reason ? `هذا اليوم إجازة: ${holiday.reason}` : "هذا اليوم إجازة.";
    const t = `${dateISO}T12:00:00`;
    const closure = bookingSettings.closures.find((c: any) => String(c?.from || "") <= t && t <= String(c?.to || ""));
    if (closure) return closure.message || bookingSettings.publicClosedMessage || "اليوم مغلق.";
    return "";
  };

  const findNearestOpenDate = (fromISO: string, maxDays = 30): string | null => {
    for (let i = 0; i <= maxDays; i++) {
      const d = addDaysISO(fromISO, i);
      if (!getDayClosureReason(d)) return d;
    }
    return null;
  };

  const getNextOpenDates = (fromISO: string, count = 5, maxDays = 60): string[] => {
    const out: string[] = [];
    for (let i = 0; i <= maxDays && out.length < count; i++) {
      const d = addDaysISO(fromISO, i);
      if (!getDayClosureReason(d)) out.push(d);
    }
    return out;
  };

  const getBookedTimesForDate = async (dateISO: string): Promise<string[]> => {
    if (bookingsCache[dateISO]) return bookingsCache[dateISO];
    try {
      const row = await coreApiRequest<{ times?: string[] }>(
        "/api/core/bookings/taken-times",
        { query: { date: dateISO } }
      );
      const times = (Array.isArray(row?.times) ? row.times : [])
        .map((t) => String(t || "").trim())
        .filter(Boolean);
      setBookingsCache((prev) => ({ ...prev, [dateISO]: times }));
      return times;
    } catch {
      setBookingsCache((prev) => ({ ...prev, [dateISO]: [] }));
      return [];
    }
  };

  const calcAvailableTimes = (bookedTimes: string[], dateISO: string) => {
    const day = getDaySettingsForDate(dateISO);
    if (!day.enabled) return [] as string[];
    const slots = generateSalonTimeSlots(day.start, day.end, bookingSettings.slotStepMin || 5);
    const taken = new Set(bookedTimes.map((t) => String(t).trim()));
    return slots.filter((slot) => !taken.has(slot.value24)).map((slot) => slot.label12);
  };

  const smartReply = async (inputText: string) => {
    const qRaw = inputText.trim();
    const selectedSectionId = qRaw.startsWith(ACTION_SECTION_PREFIX)
      ? qRaw.slice(ACTION_SECTION_PREFIX.length).trim()
      : "";
    const selectedCategoryId = qRaw.startsWith(ACTION_CATEGORY_PREFIX)
      ? qRaw.slice(ACTION_CATEGORY_PREFIX.length).trim()
      : "";
    const selectedCategoryName = qRaw.startsWith(ACTION_CATEGORY_NAME_PREFIX)
      ? qRaw.slice(ACTION_CATEGORY_NAME_PREFIX.length).trim()
      : "";
    const selectedServiceId = qRaw.startsWith(ACTION_SERVICE_PREFIX)
      ? qRaw.slice(ACTION_SERVICE_PREFIX.length).trim()
      : "";
    const isInternalCommand = qRaw.startsWith("__");
    const hasQuestionTone =
      !isInternalCommand &&
      (/[؟?]/.test(qRaw) || /(وش|ايش|كيف|وين|متى|كم|هل|ليه|لماذا|who|what|when|where|how)/i.test(normalizeArabic(qRaw.toLowerCase())));
    const hasInternalActionSelection = !!(selectedSectionId || selectedCategoryId || selectedCategoryName || selectedServiceId);
    const hasDateLikeInput = !!parseDateSmart(qRaw);
    
    const continueBookingFromCurrentStep = () => {
      if (flow.step === "ask_section") {
        return pushBot({
          text: "نكمل الحجز من هنا 👇 اختاري القسم أولًا:",
          actions: activeSections.slice(0, 8).map((s) => ({
            type: "send",
            label: getLabel(s),
            value: `${ACTION_SECTION_PREFIX}${s.id}`,
          })),
        });
      }
      if (flow.step === "ask_category") {
        const options = getCategoryOptionsBySectionId(String(flow.sectionId || ""));
        return pushBot({
          text: `نكمل 👇 اختاري التصنيف من قسم "${flow.sectionName || "القسم"}":`,
          actions: options.slice(0, 8).map((c) => ({
            type: "send",
            label: c.name,
            value: c.id ? `${ACTION_CATEGORY_PREFIX}${c.id}` : `${ACTION_CATEGORY_NAME_PREFIX}${c.name}`,
          })),
        });
      }
      if (flow.step === "ask_service") {
        const scoped = getServicesBySelection({
          sectionId: flow.sectionId,
          categoryId: flow.categoryId,
          categoryName: flow.categoryName,
        });
        return pushBot({
          text: "نكمل 👇 اختاري الخدمة:",
          actions: scoped.slice(0, 8).map((s) => ({
            type: "send",
            label: getServiceName(s),
            value: `${ACTION_SERVICE_PREFIX}${s.id}`,
          })),
        });
      }
      if (flow.step === "ask_date") {
        return pushBot({
          text: `نكمل 👇 اكتبي التاريخ لخدمة "${flow.serviceName || "الخدمة"}".`,
          actions: [
            { type: "send", label: "اليوم", value: "اليوم" },
            { type: "send", label: "بكرة", value: "بكرة" },
            { type: "send", label: "السبت", value: "السبت" },
          ],
        });
      }
      return beginBookingFlow();
    };
    if (isResetIntent(qRaw)) {
      setFlow(defaultFlow);
      return pushBot({ text: "تم إلغاء المسار الحالي. اختاري اللي تبينه ونبدأ من جديد 💜", actions: pageActions, showAllPricesBtn: true });
    }
    if (
      flow.step !== "idle" &&
      !hasInternalActionSelection &&
      !hasDateLikeInput &&
      (isTopicSwitchIntent(qRaw) || hasQuestionTone)
    ) {
      setFlow(defaultFlow);
      return pushBot({
        text: "واضح إنك غيرتي الموضوع 💜 طلعتك من المسار السابق. قولي لي الآن وش تبين؟",
        actions: pageActions,
        showAllPricesBtn: true,
      });
    }
    if (qRaw === ACTION_CONTINUE_BOOKING && flow.step !== "idle") {
      return continueBookingFromCurrentStep();
    }
    if (isBookingIntent(qRaw)) {
      if (flow.step !== "idle") return continueBookingFromCurrentStep();
      setFlow(defaultFlow);
      return beginBookingFlow();
    }
    if (isPricingIntent(qRaw)) {
      setFlow(defaultFlow);
      return beginPricesFlow();
    }
    if (isContactIntent(qRaw)) {
      setFlow(defaultFlow);
      return pushBot(replyContact());
    }
    if (isOffersIntent(qRaw)) {
      setFlow(defaultFlow);
      return pushBot(buildOffersReply());
    }
    if (isAvailabilityIntent(qRaw)) {
      if (flow.step !== "idle") return continueBookingFromCurrentStep();
      setFlow(defaultFlow);
      return beginBookingFlow();
    }
    if (isHelpIntent(qRaw) && flow.step === "idle") {
      return pushBot({ text: "أقدر أساعدك في الحجز والأسعار والعروض والتواصل 💜", actions: pageActions, showAllPricesBtn: true });
    }
    if (isSalonBrandMention(qRaw) && flow.step === "idle") {
      return pushBot({
        text: pick([
          "صالون ملكات 👑 تجربة متكاملة: خدمات احترافية، حجز سريع، وعروض متجددة.",
          "أهلًا في صالون ملكات ✨ جمال راقٍ، فريق متخصص، وأسعار واضحة.",
          "اختيار ممتاز 💯 صالون ملكات يجمع الجودة والذوق في كل خدمة.",
        ]),
        actions: pageActions,
      });
    }

    const isGeneralSmallTalk =
      isGreeting(qRaw) || isHowAreYou(qRaw) || isThanks(qRaw) || isBotIdentity(qRaw) || isBye(qRaw);
    const smallTalkLead = isHowAreYou(qRaw)
      ? "بخير دامك بخير 💜"
      : isThanks(qRaw)
        ? "العفو 💜"
        : isBotIdentity(qRaw)
          ? "أنا مساعدتك في صالون ملكات 👑"
          : isBye(qRaw)
            ? "مع السلامة 💜"
            : "ياهلا 💜";
    if (flow.step !== "idle" && isGeneralSmallTalk) {
      pushBot({ text: smallTalkLead });
      if (flow.step === "ask_section") {
        return pushBot({
          text: "أكيد 💜 اختاري القسم أولًا:",
          actions: activeSections.slice(0, 8).map((s) => ({
            type: "send",
            label: getLabel(s),
            value: `${ACTION_SECTION_PREFIX}${s.id}`,
          })),
        });
      }
      if (flow.step === "ask_category") {
        const options = getCategoryOptionsBySectionId(String(flow.sectionId || ""));
        return pushBot({
          text: `أكيد 💜 اختاري التصنيف من قسم "${flow.sectionName || "القسم"}":`,
          actions: options.slice(0, 8).map((c) => ({
            type: "send",
            label: c.name,
            value: c.id ? `${ACTION_CATEGORY_PREFIX}${c.id}` : `${ACTION_CATEGORY_NAME_PREFIX}${c.name}`,
          })),
        });
      }
      if (flow.step === "ask_service") {
        const scoped = getServicesBySelection({
          sectionId: flow.sectionId,
          categoryId: flow.categoryId,
          categoryName: flow.categoryName,
        });
        return pushBot({
          text: "أكيد 💜 اختاري الخدمة:",
          actions: scoped.slice(0, 8).map((s) => ({
            type: "send",
            label: getServiceName(s),
            value: `${ACTION_SERVICE_PREFIX}${s.id}`,
          })),
        });
      }
      if (flow.step === "ask_date") {
        return pushBot({
          text: `أكيد 💜 عطيني التاريخ لخدمة "${flow.serviceName || "الخدمة"}".`,
          actions: [
            { type: "send", label: "اليوم", value: "اليوم" },
            { type: "send", label: "بكرة", value: "بكرة" },
            { type: "send", label: "السبت", value: "السبت" },
          ],
        });
      }
    }

    if (flow.step === "ask_section") {
      const section = selectedSectionId
        ? activeSections.find((s) => String(s.id) === selectedSectionId) || null
        : matchSectionFromUserText(qRaw);
      if (!section) {
        return pushBot({
          text: "اختاري القسم أولًا عشان نكمل 💜",
          actions: activeSections.slice(0, 8).map((s) => ({
            type: "send",
            label: getLabel(s),
            value: `${ACTION_SECTION_PREFIX}${s.id}`,
          })),
        });
      }
      const sectionName = getLabel(section);
      const options = getCategoryOptionsBySectionId(section.id);
      if (options.length) {
        setFlow({ step: "ask_category", intent: flow.intent || "booking", sectionId: section.id, sectionName });
        return pushBot({
          text: flow.intent === "pricing" ? `ممتاز 💜 قسم "${sectionName}". الآن اختاري التصنيف للأسعار:` : `ممتاز 💜 اخترتي قسم "${sectionName}". الآن اختاري التصنيف:`,
          actions: options.slice(0, 8).map((c) => ({
            type: "send",
            label: c.name,
            value: c.id ? `${ACTION_CATEGORY_PREFIX}${c.id}` : `${ACTION_CATEGORY_NAME_PREFIX}${c.name}`,
          })),
        });
      }
      if (flow.intent === "pricing") {
        const list = getServicesBySelection({ sectionId: section.id })
          .map((s) => `• ${getServiceName(s)}: ${typeof s.price === "number" ? `${s.price} ريال` : "اسألي عن السعر"}`)
          .join("\n");
        setFlow(defaultFlow);
        return pushBot({ text: `💰 أسعار قسم "${sectionName}":\n${list || "ما فيه خدمات ظاهرة."}` });
      }
      const sectionServices = getServicesBySelection({ sectionId: section.id });
      setFlow({ step: "ask_service", intent: "booking", sectionId: section.id, sectionName });
      return pushBot({
        text: `ممتاز 💜 اخترتي قسم "${sectionName}". الآن اختاري الخدمة:`,
        actions: sectionServices.slice(0, 8).map((s) => ({
          type: "send",
          label: getServiceName(s),
          value: `${ACTION_SERVICE_PREFIX}${s.id}`,
        })),
      });
    }

    if (flow.step === "ask_category") {
      const sid = String(flow.sectionId || "");
      const options = getCategoryOptionsBySectionId(sid);
      let category: CategoryOption | null = null;
      if (selectedCategoryId) {
        category = options.find((c) => String(c.id || "") === selectedCategoryId) || null;
      } else if (selectedCategoryName) {
        category =
          options.find((c) => normalizeArabic(c.name) === normalizeArabic(selectedCategoryName)) || null;
      } else {
        category = matchCategoryFromUserText(qRaw, options);
      }
      if (!category) {
        return pushBot({
          text: `اختاري التصنيف من قسم "${flow.sectionName || "القسم"}" 💜`,
          actions: options.slice(0, 8).map((c) => ({
            type: "send",
            label: c.name,
            value: c.id ? `${ACTION_CATEGORY_PREFIX}${c.id}` : `${ACTION_CATEGORY_NAME_PREFIX}${c.name}`,
          })),
        });
      }
      if (flow.intent === "pricing") {
        setFlow(defaultFlow);
        return pushBot({
          text: buildCategoryPricesText({
            sectionId: sid,
            sectionName: flow.sectionName,
            categoryId: category.id,
            categoryName: category.name,
          }),
          actions: [{ type: "send", label: "قسم ثاني", value: "قائمة الأسعار" }],
        });
      }
      const filtered = getServicesBySelection({ sectionId: sid, categoryId: category.id, categoryName: category.name });
      setFlow({ step: "ask_service", intent: "booking", sectionId: sid, sectionName: flow.sectionName, categoryId: category.id, categoryName: category.name });
      return pushBot({
        text: `تمام 💜 اخترتي تصنيف "${category.name}". الآن اختاري الخدمة:`,
        actions: filtered.slice(0, 8).map((s) => ({
          type: "send",
          label: getServiceName(s),
          value: `${ACTION_SERVICE_PREFIX}${s.id}`,
        })),
      });
    }

    if (flow.step === "ask_service") {
      const scoped = getServicesBySelection({ sectionId: flow.sectionId, categoryId: flow.categoryId, categoryName: flow.categoryName });
      let svc: ServiceDoc | null = null;
      if (selectedServiceId) svc = scoped.find((s) => String(s.id) === selectedServiceId) || null;
      if (!svc) svc = matchServiceFromUserText(qRaw, { sectionId: flow.sectionId, categoryId: flow.categoryId, categoryName: flow.categoryName });
      if (!svc) {
        return pushBot({
          text: "تمام 💜 ما فهمت الخدمة بالضبط. اختاري من الأزرار:",
          actions: scoped.slice(0, 8).map((s) => ({
            type: "send",
            label: getServiceName(s),
            value: `${ACTION_SERVICE_PREFIX}${s.id}`,
          })),
        });
      }
      setFlow({ ...flow, step: "ask_date", intent: "booking", serviceId: svc.id, serviceName: getServiceName(svc) });
      return pushBot({
        text:
          `تمام 💜 خدمة **${getServiceName(svc)}**.\n` +
          "اكتبي التاريخ بالطريقة اللي تناسبك:\n" +
          "• اليوم / بكرة\n• السبت / الخميس الجاي\n• 2026-02-01 أو 25-2",
        actions: [
          { type: "send", label: "اليوم", value: "اليوم" },
          { type: "send", label: "بكرة", value: "بكرة" },
          { type: "send", label: "السبت", value: "السبت" },
        ],
      });
    }

    if (flow.step === "ask_date") {
      const qDate = normalizeArabic(qRaw.toLowerCase()).trim();
      const isAffirmativeReply = /^(نعم|اي|ايوه|ايه|yes|ok|اوكي|تمام)$/i.test(qDate);
      const isNegativeReply = /^(لا|لا شكرا|no|not now)$/i.test(qDate);
      if (flow.suggestedDateISO && (qRaw === ACTION_SHOW_OPEN_DAYS || isAffirmativeReply)) {
        const openDays = getNextOpenDates(flow.suggestedDateISO, 5, 90);
        if (!openDays.length) {
          return pushBot({ text: "حالياً ما لقيت أيام متاحة قريب. جربي تاريخ ثاني 💜" });
        }
        return pushBot({
          text: "هذه أقرب 5 أيام متاحة 💜 اختاري اليوم المناسب:",
          actions: openDays.map((d) => ({
            type: "send",
            label: `${WEEKDAY_LABEL_AR[resolveWeekdayFromISO(d)]} ${toDMY(d)}`,
            value: d,
          })),
        });
      }
      const resolveWeekdayFallback = (targetDay: number, forceNext = false) => {
        const base = todayISO();
        const now = new Date(`${base}T00:00:00`);
        let diff = targetDay - now.getDay();
        if (diff < 0) diff += 7;
        if (forceNext && diff === 0) diff = 7;
        return addDaysISO(base, diff);
      };
      const parsedDate =
        parseDateSmart(qRaw) ||
        (qDate === "اليوم"
          ? todayISO()
          : qDate === "بكره" || qDate === "بكرة"
            ? addDaysISO(todayISO(), 1)
            : /(السبت|سبت)/i.test(qDate)
              ? resolveWeekdayFallback(6, /الجاي|القادم|next/i.test(qDate))
              : /(الخميس|خميس)/i.test(qDate)
                ? resolveWeekdayFallback(4, /الجاي|القادم|next/i.test(qDate))
              : /(الجمعة|جمعه|جمعة)/i.test(qDate)
                ? resolveWeekdayFallback(5, /الجاي|القادم|next/i.test(qDate))
                : null);
      const date = parsedDate || (isAffirmativeReply && flow.suggestedDateISO ? flow.suggestedDateISO : null);
      if (!date) {
        if (isNegativeReply && flow.suggestedDateISO) {
          setFlow({ ...flow, suggestedDateISO: undefined });
          return pushBot({
            text: "تمام 💜 اختاري تاريخ ثاني يناسبك.",
            actions: [
              { type: "send", label: "اليوم", value: "اليوم" },
              { type: "send", label: "بكرة", value: "بكرة" },
              { type: "send", label: "السبت", value: "السبت" },
            ],
          });
        }
        return pushBot({
          text: "ما فهمت التاريخ 💜 جربي: اليوم، بكرة، السبت، الخميس الجاي، أو 2026-02-01.",
          actions: [
            { type: "send", label: "اليوم", value: "اليوم" },
            { type: "send", label: "بكرة", value: "بكرة" },
          ],
        });
      }
      const closureReason = getDayClosureReason(date);
      if (closureReason) {
        const nearest = findNearestOpenDate(addDaysISO(date, 1), 30);
        if (nearest) {
          setFlow({ ...flow, suggestedDateISO: nearest });
        }
        return pushBot({
          text: nearest
            ? `يوم ${toDMY(date)} غير متاح للحجز 💜\n${closureReason}\n\nأقرب يوم متاح هو ${toDMY(nearest)} ✨\nتحبين أعرض لك الأوقات المتاحة فيه؟`
            : `يوم ${toDMY(date)} غير متاح للحجز 💜\n${closureReason}`,
          actions: nearest
            ? [
                { type: "send", label: "نعم، اعرضي الأيام", value: "نعم" },
                { type: "send", label: "لا، تاريخ ثاني", value: "لا" },
                { type: "send", label: "اختيار أقرب يوم", value: ACTION_SHOW_OPEN_DAYS },
              ]
            : undefined,
        });
      }
      const booked = await getBookedTimesForDate(date);
      const available = calcAvailableTimes(booked, date);
      pushBot({
        text: `الأوقات المتاحة لخدمة "${flow.serviceName || "الخدمة"}" بتاريخ ${toDMY(date)}:\n\n${formatAvailableTimes(available)}`,
        actions: [{ type: "route", label: "الحجز", value: "/booking" }],
      });
      setFlow(defaultFlow);
      return;
    }

    if (isGreeting(qRaw))
      return pushBot({
        text: `${resolveGreetingReply(qRaw)}\nتبين حجز، أسعار، عروض، أو تواصل؟`,
        actions: pageActions,
        showAllPricesBtn: true,
      });
    if (isHowAreYou(qRaw)) return pushBot({ text: "بخير دامك بخير 💜", actions: pageActions });
    if (isBotIdentity(qRaw))
      return pushBot({
        text: "أنا مساعدتك الرقمية في صالون ملكات 👑\nأقدر أساعدك في الحجز، الأسعار، العروض، وطرق التواصل.",
        actions: pageActions,
      });
    if (isThanks(qRaw)) return pushBot({ text: "العفو 💜", actions: pageActions });
    if (isBye(qRaw)) return pushBot({ text: "مع السلامة 💜", actions: [{ type: "route", label: "الصفحة الرئيسية", value: "/" }] });
    if (isComplaint(qRaw)) return pushBot({ text: "آسفة للتجربة 💜 أعطيني تفاصيل أكثر.", actions: [{ type: "send", label: "طرق التواصل", value: "طرق التواصل" }] });

    return pushBot({
      text: pick([
        "أبشري 💜 اختاري اللي تبينه:\n• (أبي أحجز)\n• (قائمة الأسعار)\n• (العروض والخصومات)\n• (طرق التواصل)",
        "حاضرين 💜 أقدر أخدمك في الحجز والأسعار والعروض والتواصل.",
      ]),
      actions: pageActions,
      showAllPricesBtn: true,
    });
  };

  const sendAllPrices = () => beginPricesFlow();

  const sendText = async (text: string) => {
    const t = String(text || "").trim();
    if (!t) return;
    setMessages((prev) => [...prev, { id: Date.now(), sender: "user", text: t }]);
    await smartReply(t);
  };

  const handleSend = async () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    await sendText(t);
  };

  const handleCloseChat = () => {
    if (isChatPage) {
      navigate("/");
      return;
    }
    setOpen(false);
  };

  const handleClearChat = () => {
    localStorage.removeItem(STORAGE.CHAT);
    setFlow(defaultFlow);
    setInput("");
    setHintsOpen(false);
    setMessages([
      {
        id: Date.now(),
        sender: "bot",
        text: INITIAL_BOT_MESSAGE,
      },
    ]);
  };

  const forcePageTopOnMobile = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const mainContent = document.querySelector<HTMLElement>(".main-content");
    if (mainContent) mainContent.scrollTop = 0;
  };

  const prepareForMobileInputFocus = () => {
    if (isChatPage || !open) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    if (floatingScrollRestoreRef.current === null) {
      floatingScrollRestoreRef.current = Math.max(
        window.scrollY,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0
      );
    }

    document.body.style.top = "0";
    forcePageTopOnMobile();
    window.requestAnimationFrame(forcePageTopOnMobile);
  };

  const handleInputTouchStart = () => {
    prepareForMobileInputFocus();
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      if (document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const toggleFloatingChat = () => {
    if (isChatPage) return;
    setOpen((s) => !s);
  };

  const handleAction = async (a: Action) => {
    if (a.type === "route") {
      if (/^https?:\/\//i.test(a.value)) {
        window.open(a.value, "_blank", "noopener,noreferrer");
        return;
      }
      navigate(a.value);
      return;
    }
    const visible = String(a.label || "").trim() || String(a.value || "").trim();
    const internal = String(a.value || "").trim();
    if (!internal) return;
    setMessages((prev) => [...prev, { id: Date.now(), sender: "user", text: visible }]);
    await smartReply(internal);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isChatPage) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isChatPage]);

  useEffect(() => {
    if (isChatPage) setOpen(true);
  }, [isChatPage]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 768px)");

    const syncMobileChatState = () => {
      const mobileFloatingChatOpen =
        open &&
        !isChatPage &&
        mobileQuery.matches;

      document.documentElement.classList.toggle(
        "mobile-floating-chat-open",
        mobileFloatingChatOpen
      );
    };

    syncMobileChatState();
    mobileQuery.addEventListener("change", syncMobileChatState);

    return () => {
      mobileQuery.removeEventListener("change", syncMobileChatState);
      document.documentElement.classList.remove(
        "mobile-floating-chat-open"
      );
    };
  }, [isChatPage, open]);

  useEffect(() => {
    if (!isChatPage) return;
    const y = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      const top = document.body.style.top;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      const restoreY = top ? Math.abs(parseInt(top, 10)) : y;
      window.scrollTo(0, restoreY || 0);
    };
  }, [isChatPage]);

  useEffect(() => {
    if (isChatPage || !open) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    const y =
      floatingScrollRestoreRef.current ??
      Math.max(window.scrollY, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
    floatingScrollRestoreRef.current = y;
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";

    return () => {
      const top = document.body.style.top;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      const restoreY =
        floatingScrollRestoreRef.current ??
        (top ? Math.abs(parseInt(top, 10)) : y);
      window.scrollTo(0, restoreY || 0);
      floatingScrollRestoreRef.current = null;
    };
  }, [isChatPage, open]);

  useEffect(() => {
    if (!isChatPage && !open) {
      setChatViewportHeight("100dvh");
      setChatKeyboardInset("0px");
      return;
    }

    let rafId: number | null = null;
    const updateChatViewportHeight = () => {
      let topOffset = 0;
      if (isChatPage) {
        document.querySelectorAll<HTMLElement>(".topbar, .navbar").forEach((el) => {
          const rect = el.getBoundingClientRect();
          topOffset = Math.max(topOffset, rect.bottom);
        });
      }
      const safeOffset = Math.max(0, Math.round(topOffset));
      const vv = window.visualViewport;
      const visibleViewportHeight = vv ? vv.height + vv.offsetTop : window.innerHeight;
      const keyboardInset = Math.max(0, Math.round(window.innerHeight - visibleViewportHeight));
      const usableHeight = Math.max(240, Math.floor(visibleViewportHeight - safeOffset));
      setChatViewportHeight(`${usableHeight}px`);
      setChatKeyboardInset(`${keyboardInset}px`);
    };

    const scheduleUpdate = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updateChatViewportHeight);
    };

    updateChatViewportHeight();
    const delayed = window.setTimeout(updateChatViewportHeight, 80);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("orientationchange", scheduleUpdate);
    window.addEventListener("focusin", scheduleUpdate);
    window.addEventListener("focusout", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.clearTimeout(delayed);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
      window.removeEventListener("focusin", scheduleUpdate);
      window.removeEventListener("focusout", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [isChatPage, open]);

  const chatRootStyle: CSSProperties | undefined = isChatPage || open
    ? ({
        "--chatbot-page-height": chatViewportHeight,
        "--chatbot-viewport-height": chatViewportHeight,
        "--chatbot-keyboard-inset": chatKeyboardInset,
      } as CSSProperties)
    : undefined;

  return (
    <div className={`chatbot ${open ? "open" : ""} ${isChatPage ? "chatbot-page" : ""}`} style={chatRootStyle}>
      {!isChatPage && !shouldHideFloatingChat && (
        <button className="chatbot-toggle" type="button" onClick={toggleFloatingChat} aria-label="Chatbot">
          <FontAwesomeIcon icon={faCommentDots} />
        </button>
      )}

      {open && (
        <div className={`chatbot-panel ${isChatPage ? "chatbot-panel-page" : ""}`}>
          <div className="chatbot-header">
            <button className="chatbot-close" type="button" onClick={handleCloseChat} aria-label="إغلاق">
              ✕
            </button>
            <div className="chatbot-title">
              صالون ملكات
              <span className="chatbot-sub">خدمة العملاء</span>
            </div>
            <button className="chatbot-clear" type="button" onClick={handleClearChat} aria-label="مسح المحادثة">
              مسح
            </button>
          </div>

          <div className="chatbot-body">
            {messages.map((m) => (
              <div key={m.id} className={`chatbot-msg ${m.sender}`}>
                <div className="bubble">
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>

                  {m.sender === "bot" && m.showAllPricesBtn ? (
                    <div style={{ marginTop: 10 }}>
                      <button className="chatbot-quick" type="button" onClick={sendAllPrices}>
                        عرض قائمة الأسعار 💰
                      </button>
                    </div>
                  ) : null}

                  {m.sender === "bot" && m.actions?.length ? (
                    <div className="chatbot-actions">
                      {m.actions.map((a, idx) => (
                        <button key={`${m.id}_a_${idx}`} className="chatbot-action" type="button" onClick={() => handleAction(a)}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chatbot-footer">
            <div className={`chatbot-hints-wrap ${hintsOpen ? "open" : ""}`}>
              <div className="chatbot-hints">
                {footerQuickActions.map((a, i) => (
                  <button
                    key={`hint_${i}`}
                    className="chatbot-hint"
                    type="button"
                    onClick={() => {
                      handleAction(a);
                      setHintsOpen(false);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="chatbot-input-row">
              <button
                className={`chatbot-plus ${hintsOpen ? "open" : ""}`}
                type="button"
                onClick={() => setHintsOpen((v) => !v)}
                aria-expanded={hintsOpen}
                aria-label={hintsOpen ? "إخفاء الاختصارات" : "إظهار الاختصارات"}
              >
                <span className="chatbot-plus-glyph" aria-hidden="true">
                  {hintsOpen ? "×" : "+"}
                </span>
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="اكتبي سؤالك هنا..."
                onTouchStart={handleInputTouchStart}
                onMouseDown={prepareForMobileInputFocus}
                onFocus={() => {
                  prepareForMobileInputFocus();
                  if (window.matchMedia("(max-width: 760px)").matches) {
                    forcePageTopOnMobile();
                    window.requestAnimationFrame(forcePageTopOnMobile);
                  }
                  // Keep the latest message visible when the keyboard opens on mobile.
                  window.setTimeout(() => {
                    if (window.matchMedia("(max-width: 760px)").matches) {
                      forcePageTopOnMobile();
                    }
                    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
                  }, 80);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
              />
              <button
                className="chatbot-send chatbot-send--arrow"
                type="button"
                onClick={handleSend}
                aria-label="إرسال"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatBot;
