

// ✅ src/components/ChatBot.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots } from "@fortawesome/free-solid-svg-icons";

import { generateSalonTimeSlots } from "../helpers/timeSlots";
import "../styles/ChatBot.css";

type Sender = "user" | "bot";

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

interface BookingItem {
  service: string;
  date: string;
  time: string;
}

type OfferLike = {
  id?: string | number;
  title?: string;
  description?: string;
  code?: string;
  discountPercent?: number;
  discountPrice?: number;
  originalPrice?: number;
  validUntil?: string; // "2025-12-31"
  startDate?: string; // "2025-12-01"
  endDate?: string; // "2025-12-31"
  isActive?: boolean;
  active?: boolean;
};

const STORAGE = {
  CHAT: "chatbot_history_v1",
  BOOKINGS: "allBookings",
  // نحاول نقرأ من أكثر من مفتاح لأن مشاريع العروض تختلف
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

const PRICES = [
  { name: "قص الشعر", price: 70 },
  { name: "تسريحة شعر", price: 100 },
  { name: "مكياج", price: 250 },
  { name: "بدكير", price: 60 },
  { name: "منكير", price: 60 },
  { name: "عناية بالبشرة", price: 120 },
  { name: "صبغة شعر", price: 180 },
  { name: "علاج بروتين", price: 300 },
  { name: "إزالة شعر", price: 30 },
];

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getAllBookings(): BookingItem[] {
  return safeJsonParse<BookingItem[]>(
    localStorage.getItem(STORAGE.BOOKINGS),
    []
  );
}

/** ✅ قراءة العروض من localStorage مهما كان اسم المفتاح */
function readOffersFromLocalStorage(): OfferLike[] {
  for (const key of STORAGE.OFFERS_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const parsed = safeJsonParse<any>(raw, null);

    // 1) Array مباشرة
    if (Array.isArray(parsed)) return parsed as OfferLike[];

    // 2) Object يحتوي offers/coupons
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.offers)) return parsed.offers as OfferLike[];
      if (Array.isArray(parsed.coupons)) return parsed.coupons as OfferLike[];
      if (Array.isArray(parsed.data)) return parsed.data as OfferLike[];
      if (Array.isArray(parsed.items)) return parsed.items as OfferLike[];
    }
  }
  return [];
}

/** ✅ فلترة العروض الفعّالة حاليًا */
function getActiveOffers(): OfferLike[] {
  const offers = readOffersFromLocalStorage();

  const today = new Date();
  const toDate = (s?: string) => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const isWithin = (start?: string, end?: string) => {
    const s = toDate(start);
    const e = toDate(end);
    if (s && today < s) return false;
    if (e && today > e) return false;
    return true;
  };

  return offers
    .filter((o) => {
      const flag = o.isActive ?? o.active;
      const end = o.validUntil ?? o.endDate;
      const start = o.startDate;

      const okByFlag = typeof flag === "boolean" ? flag : true;
      const okByDate = isWithin(start, end);

      return okByFlag && okByDate;
    })
    .sort((a, b) => {
      const da = (a.validUntil ?? a.endDate) || "9999-12-31";
      const db = (b.validUntil ?? b.endDate) || "9999-12-31";
      return da.localeCompare(db);
    });
}

const hours = generateSalonTimeSlots();

/* ==============================
   ✅ Human-like Helpers (مهم!)
   ============================== */
const normalizeArabic = (s: string) =>
  s
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

const isGreeting = (qRaw: string) => {
  const q = normalizeArabic(qRaw.toLowerCase());
  return /(السلام عليكم|وعليكم السلام|هلا|هلا والله|اهلين|اهلا|مرحبا|مرحب|هاي|hi|hello)/i.test(
    q
  );
};

const isThanks = (qRaw: string) => {
  const q = normalizeArabic(qRaw.toLowerCase());
  return /(شكرا|شكرًا|يعطيك العافيه|مشكور|تسلم|الله يعطيك العافيه)/i.test(q);
};

const isBye = (qRaw: string) => {
  const q = normalizeArabic(qRaw.toLowerCase());
  return /(مع السلامه|باي|وداع|اشوفك|تصبح|تصبحون)/i.test(q);
};

const isComplaint = (qRaw: string) => {
  const q = normalizeArabic(qRaw.toLowerCase());
  return /(سيء|سيئ|مو زين|زفت|خايس|يزعل|مضايق|ما عجبني|خدمتكم سيئه|تجربه سيئه)/i.test(
    q
  );
};

const extractDate = (text: string): string | null => {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
};

const extractTime = (text: string): string | null => {
  const m = text.match(/\b(\d{1,2}:\d{2})\b/);
  return m ? m[1] : null;
};

/* ==============================
   ✅ خدمة ↔ سعر
   ============================== */
const serviceKeywordsToPrice: { regex: RegExp; name: string }[] = [
  { regex: /قص|قصة|قصات|قص الشعر|حلاقة شعر|قص اطراف/i, name: "قص الشعر" },
  { regex: /تسريح|تسريحة|استشوار/i, name: "تسريحة شعر" },
  {
    regex: /مكياج|ميكب|ميك اب|مكاب|مكيج|مكياج عرايس|مكياج سهرة/i,
    name: "مكياج",
  },
  { regex: /بدكير|بديكير/i, name: "بدكير" },
  { regex: /منكير|مناكير|اظافر/i, name: "منكير" },
  { regex: /بشرة|عناية بالبشرة|تنظيف بشرة|تقشير/i, name: "عناية بالبشرة" },
  { regex: /صبغ|صبغة|صبغات|تلوين شعر|هايلايت|بالياج/i, name: "صبغة شعر" },
  { regex: /بروتين|كيراتين|علاج بروتين|فرد شعر/i, name: "علاج بروتين" },
  { regex: /إزالة شعر|ازاله شعر|واكس|شمع|حواجب|نزع الشعر/i, name: "إزالة شعر" },
];

const findServiceFromText = (text: string): string | null => {
  for (const kw of serviceKeywordsToPrice) {
    if (kw.regex.test(text)) return kw.name;
  }
  return null;
};

const getServicePriceReply = (q: string): string | null => {
  for (const kw of serviceKeywordsToPrice) {
    if (kw.regex.test(q)) {
      const priceItem = PRICES.find((p) => p.name === kw.name);
      if (priceItem) {
        return `سعر **${kw.name}** يبدأ من **${priceItem.price} ريال**.\nتحبّين أعطيك مواعيد متاحة؟`;
      }
    }
  }
  return null;
};

function buildOffersReply() {
  const active = getActiveOffers();

  if (!active.length) {
    return {
      text: "حاليًا ما عندنا عروض فعّالة مسجّلة في النظام.\nتبغين أعرض لك قائمة الأسعار؟",
      actions: [
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        { type: "route", label: "صفحة العروض", value: "/offers" },
      ] as Action[],
    };
  }

  const top = active.slice(0, 5);

  const lines = top.map((o) => {
    const title = o.title || "عرض";
    const code = o.code ? ` | الكود: ${o.code}` : "";
    const end = o.validUntil ?? o.endDate;
    const until = end ? ` | حتى: ${end}` : "";
    const pct =
      typeof o.discountPercent === "number" ? `خصم ${o.discountPercent}%` : "";
    const price =
      typeof o.discountPrice === "number" && typeof o.originalPrice === "number"
        ? `بدل ${o.originalPrice} صار ${o.discountPrice}`
        : "";

    const extra = [pct, price].filter(Boolean).join(" - ");
    return `• ${title}${extra ? ` (${extra})` : ""}${code}${until}`;
  });

  return {
    text:
      "🎉 **العروض الحالية (من النظام):**\n" +
      lines.join("\n\n") +
      "\n\nتبغين أودّيك لصفحة العروض أو نحجز لك موعد؟",
    actions: [
      { type: "route", label: "صفحة العروض", value: "/offers" },
      { type: "route", label: "احجزي الآن", value: "/booking" },
      { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
    ] as Action[],
  };
}

function formatAvailableTimes(times: string[]) {
  if (!times.length) return "للأسف ما فيه أوقات متاحة بهذا اليوم.";
  const chunk = times.slice(0, 10);
  return (
    "⏰ **الأوقات المتاحة:**\n" +
    chunk.map((t) => `• ${t}`).join("\n") +
    (times.length > chunk.length
      ? `\n\n… وفيه ${times.length - chunk.length} وقت إضافي.`
      : "")
  );
}

function getAvailableTimesForDate(dateISO: string) {
  const all = getAllBookings();
  const taken = new Set(
    all
      .filter((b) => String(b.date || "").trim() === dateISO)
      .map((b) => String(b.time || "").trim())
      .filter(Boolean)
  );

  const available = hours.filter((t) => !taken.has(String(t).trim()));
  return available;
}

const ChatBot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const location = useLocation();
  const navigate = useNavigate();

  /** ✅ اقتراحات حسب الصفحة */
  const pageActions: Action[] = useMemo(() => {
    const path = location.pathname;

    if (path.startsWith("/booking")) {
      return [
        {
          type: "send",
          label: "مواعيد متاحة",
          value: "أوقات متاحة مكياج 2025-12-20",
        },
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
      { type: "route", label: "احجزي الآن", value: "/booking" },
      { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
      { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
    ];
  }, [location.pathname]);

  /** ✅ تحميل المحادثة من التخزين */
  useEffect(() => {
    const saved = safeJsonParse<Message[]>(
      localStorage.getItem(STORAGE.CHAT),
      []
    );
    if (saved.length) {
      setMessages(saved);
      return;
    }

    setMessages([
      {
        id: Date.now(),
        sender: "bot",
        text: "مرحبًا 👋 أنا خبيرتك في صالون ملكات.\nتبغين أسعار، عروض، أو حجز؟",
        actions: pageActions,
        showAllPricesBtn: true,
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ✅ تحديث اقتراحات أول رسالة بوت إذا ما فيه سجل */
  useEffect(() => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const first = prev[0];
      if (first.sender === "bot" && prev.length === 1) {
        return [{ ...first, actions: pageActions, showAllPricesBtn: true }];
      }
      return prev;
    });
  }, [pageActions]);

  /** ✅ حفظ المحادثة */
  useEffect(() => {
    if (messages.length) {
      localStorage.setItem(STORAGE.CHAT, JSON.stringify(messages.slice(-60)));
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendAllPrices = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        sender: "bot",
        text:
          "💰 **الأسعار الأساسية:**\n" +
          PRICES.map((s) => `• ${s.name}: ${s.price} ريال`).join("\n") +
          "\n\nاكتبي اسم الخدمة وأنا أعطيك السعر + وإذا تبين أطلع لك المواعيد المتاحة ✨",
        actions: [
          { type: "route", label: "صفحة الأسعار", value: "/pricing" },
          { type: "route", label: "احجزي الآن", value: "/booking" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
        ],
      },
    ]);
  };

  const replyContact = () => {
    return {
      text:
        "📍 **طرق التواصل:**\n" +
        "• الجوال: 05xxxxxxxx\n" +
        "• واتساب: 05xxxxxxxx\n" +
        "• الموقع: الرياض (اكتبي موقعك وأرسل لك اللوكيشن)\n" +
        "• ساعات العمل: يوميًا 12:00م — 11:00م\n\n" +
        "تبغين أحجز لك موعد الآن؟",
      actions: [
        { type: "route", label: "احجزي الآن", value: "/booking" },
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      ] as Action[],
    };
  };

  // ✅ “أكبر رد” (منطق بشري)
  const smartReply = (
    inputText: string
  ): { text: string; actions?: Action[]; showAllPricesBtn?: boolean } => {
    const qRaw = inputText.trim();
    const q = normalizeArabic(qRaw);

    // ✅ ترحيب
    if (isGreeting(q)) {
      const greet = pick([
        "وعليكم السلام 💜 نورتِنا!",
        "هلا والله 💜 يا حيّاك!",
        "أهلًا وسهلًا 💜 يسعدني أساعدك!",
        "مرحبا 💜 نورتِ صالون ملكات!",
      ]);

      const follow = pick([
        "وش حابة تسوين اليوم؟",
        "تبغين أسعار، عروض، ولا نحجز لك موعد؟",
        "قولي لي الخدمة اللي تبينها وبقولك السعر + المواعيد المتاحة ✨",
        "اختاري من الخيارات تحت أو اكتبي سؤالك براحتك 🌸",
      ]);

      return {
        text: `${greet}\n${follow}`,
        actions: [
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
          { type: "route", label: "احجزي الآن", value: "/booking" },
          { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
        ],
        showAllPricesBtn: true,
      };
    }

    // ✅ شكر
    if (isThanks(q)) {
      return {
        text: pick([
          "العفو 💜 هذا واجبي! تبين أساعدك في حجز أو أسعار؟",
          "تسلمين 💜 إذا تبين نحجز لك قولي الخدمة + التاريخ.",
          "يا هلا 💜 أي وقت! تبغين عروض ولا أسعار؟",
        ]),
        actions: [
          { type: "route", label: "احجزي الآن", value: "/booking" },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
        ],
        showAllPricesBtn: true,
      };
    }

    // ✅ وداع
    if (isBye(q)) {
      return {
        text: pick([
          "مع السلامة 💜 إذا احتجتِ أي شيء أنا موجودة.",
          "في أمان الله 💜 متى ما تبين حجز أو استفسار رجعي لي.",
          "تشرفنا فيك 💜 يومك جميل!",
        ]),
        actions: [{ type: "route", label: "الصفحة الرئيسية", value: "/" }],
      };
    }

    // ✅ شكوى
    if (isComplaint(q)) {
      return {
        text:
          "آسفة جدًا إن التجربة ما كانت على توقعاتك 💜\n" +
          "خليني أساعدك بشكل أفضل:\n" +
          "1) وش الخدمة اللي تقصدين؟\n" +
          "2) متى كان الموعد/الزيارة؟\n" +
          "3) تبين تواصل سريع ولا نعوضك بعرض؟",
        actions: [
          { type: "send", label: "تواصل مع الإدارة", value: "طرق التواصل" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
          { type: "route", label: "احجزي الآن", value: "/booking" },
        ],
      };
    }

    // ✅ طرق التواصل
    if (
      /(تواصل|اتصال|رقم|واتس|واتساب|عنوان|لوكيشن|موقع|اين موقعكم|وينكم)/i.test(
        qRaw
      )
    ) {
      return replyContact();
    }

    // ✅ أسعار (قائمة كاملة)
    if (
      /(عرض\s*قائمة\s*الاسعار|عرض\s*قائمة\s*الأسعار|قائمة\s*الاسعار|قائمة\s*الأسعار|كم.*اسعاركم|بكم خدماتكم)/i.test(
        qRaw
      )
    ) {
      return {
        text:
          "💰 **الأسعار الأساسية:**\n" +
          PRICES.map((s) => `• ${s.name}: ${s.price} ريال`).join("\n") +
          "\n\nإذا قلتي لي الخدمة بالضبط (مثلاً: مكياج / صبغة / قص) أعطيك تفاصيل أكثر ✨",
        actions: [
          { type: "route", label: "صفحة الأسعار", value: "/pricing" },
          { type: "route", label: "احجزي الآن", value: "/booking" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
        ],
        showAllPricesBtn: true,
      };
    }

    // ✅ سعر خدمة محددة
    const priceReply = getServicePriceReply(qRaw);
    if (priceReply) {
      return {
        text: priceReply,
        actions: [
          {
            type: "send",
            label: "مواعيد متاحة",
            value: "أوقات متاحة 2025-12-20",
          },
          { type: "route", label: "احجزي الآن", value: "/booking" },
        ],
      };
    }

    // ✅ العروض والخصومات
    if (
      /(^|\s)(عروض|خصومات|برومو|كوبون)(\s|$)/i.test(qRaw) ||
      /العروض والخصومات/i.test(qRaw) ||
      (/عرض/i.test(qRaw) &&
        !/عرض\s*قائمة\s*الاسعار|عرض\s*قائمة\s*الأسعار/i.test(qRaw))
    ) {
      return buildOffersReply();
    }

    // ✅ طلب مواعيد متاحة (بالنص)
    if (
      /(اوقات متاحه|أوقات متاحة|مواعيد متاحه|مواعيد|وقت متاح|available)/i.test(
        qRaw
      )
    ) {
      const date = extractDate(qRaw);
      const service = findServiceFromText(qRaw) || "الخدمة";

      if (!date) {
        return {
          text:
            "تمام 💜 ارسلي لي **التاريخ بصيغة YYYY-MM-DD** مثل: 2025-12-20\n" +
            "وقولي لي الخدمة (قص/مكياج/صبغة...) عشان أطلع لك الأوقات المتاحة.",
          actions: [
            {
              type: "send",
              label: "مثال جاهز",
              value: "أوقات متاحة مكياج 2025-12-20",
            },
            { type: "route", label: "صفحة الحجز", value: "/booking" },
          ],
        };
      }

      const available = getAvailableTimesForDate(date);

      return {
        text:
          `✅ خدمة: **${service}**\n📅 تاريخ: **${date}**\n\n` +
          formatAvailableTimes(available) +
          "\n\nتبغين أحجز لك؟ اكتبي الوقت مثل: 18:00",
        actions: [
          { type: "route", label: "احجزي الآن", value: "/booking" },
          { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
        ],
      };
    }

    // ✅ إذا أعطى تاريخ + وقت مباشرة
    const date = extractDate(qRaw);
    const time = extractTime(qRaw);
    const service = findServiceFromText(qRaw);

    if (date && time) {
      const available = getAvailableTimesForDate(date);
      const ok = available.includes(time);

      if (!ok) {
        return {
          text:
            `الوقت **${time}** في تاريخ **${date}** غالبًا محجوز.\n` +
            "تبغين أطلع لك أقرب أوقات متاحة؟",
          actions: [
            {
              type: "send",
              label: "أوقات متاحة",
              value: `أوقات متاحة ${date}`,
            },
          ],
        };
      }

      return {
        text:
          `تمام 💜 الوقت **${time}** متاح بتاريخ **${date}**` +
          (service ? ` لخدمة **${service}**` : "") +
          "\nتبغين نفتح لك صفحة الحجز وتكمّلين البيانات؟",
        actions: [
          { type: "route", label: "افتحي الحجز", value: "/booking" },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        ],
      };
    }

    // ✅ رد افتراضي ذكي
    return {
      text:
        "تمام 💜 تقدرين تسأليني عن:\n" +
        "• الأسعار\n• العروض\n• المواعيد المتاحة\n• طرق التواصل\n\n" +
        "اكتبي: (قائمة الأسعار) أو (العروض والخصومات) أو (أوقات متاحة 2025-12-20).",
      actions: pageActions,
      showAllPricesBtn: true,
    };
  };

  const pushBot = (payload: {
    text: string;
    actions?: Action[];
    showAllPricesBtn?: boolean;
  }) => {
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

  const sendText = (text: string) => {
    const t = String(text || "").trim();
    if (!t) return;

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), sender: "user", text: t },
    ]);

    const res = smartReply(t);
    pushBot(res);
  };

  const handleSend = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    sendText(t);
  };

  const handleAction = (a: Action) => {
    if (a.type === "route") {
      navigate(a.value);
      return;
    }
    sendText(a.value);
  };

  // close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`chatbot ${open ? "open" : ""}`}>
      {/* Floating button */}
      <button
        className="chatbot-toggle"
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-label="Chatbot"
      >
        <FontAwesomeIcon icon={faCommentDots} />
      </button>

      {/* Panel */}
      {open && (
        <div className="chatbot-panel">
          <div className="chatbot-header">
            <div className="chatbot-title">
              صالون ملكات • المساعدة
              <span className="chatbot-sub">أسعار • عروض • مواعيد</span>
            </div>
            <button
              className="chatbot-close"
              type="button"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="chatbot-body">
            {messages.map((m) => (
              <div key={m.id} className={`chatbot-msg ${m.sender}`}>
                <div className="bubble">
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>

                  {m.sender === "bot" && m.showAllPricesBtn ? (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="chatbot-quick"
                        type="button"
                        onClick={sendAllPrices}
                      >
                        عرض قائمة الأسعار 💰
                      </button>
                    </div>
                  ) : null}

                  {m.sender === "bot" && m.actions?.length ? (
                    <div className="chatbot-actions">
                      {m.actions.map((a, idx) => (
                        <button
                          key={`${m.id}_a_${idx}`}
                          className="chatbot-action"
                          type="button"
                          onClick={() => handleAction(a)}
                        >
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
            <div className="chatbot-hints">
              {pageActions.slice(0, 3).map((a, i) => (
                <button
                  key={`hint_${i}`}
                  className="chatbot-hint"
                  type="button"
                  onClick={() => handleAction(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div className="chatbot-input-row">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="اكتبي سؤالك هنا..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
              />
              <button
                className="chatbot-send"
                type="button"
                onClick={handleSend}
              >
                إرسال
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatBot;

