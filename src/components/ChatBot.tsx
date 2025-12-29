import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaCommentDots } from "react-icons/fa";
import type { IconBaseProps } from "react-icons";

import { generateSalonTimeSlots } from "../helpers/timeSlots";
import "../styles/ChatBot.css";

/** ✅ حل TS2786 لبعض إعدادات TS */
const FixedFaCommentDots = (props: IconBaseProps) => (
  <FaCommentDots {...props} />
);

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

  // ✅ “أكبر رد” (منطق بشري)
  const smartReply = (
    inputText: string
  ): { text: string; actions?: Action[]; showAllPricesBtn?: boolean } => {
    const qRaw = inputText.trim();
    const q = normalizeArabic(qRaw);

    // ✅ ترحيب بشري
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

    // ✅ الأسعار (قبل العروض + مضبوط للكتابة المختلفة)
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

    // ✅ العروض والخصومات (نستبعد جملة الأسعار)
    if (
      /(^|\s)(عروض|خصومات|برومو|كوبون)(\s|$)/i.test(qRaw) ||
      /العروض والخصومات/i.test(qRaw) ||
      (/عرض/i.test(qRaw) &&
        !/عرض\s*قائمة\s*الاسعار|عرض\s*قائمة\s*الأسعار/i.test(qRaw))
    ) {
      return buildOffersReply();
    }

    // ✅ حجز / موعد بطريقة بشرية
    if (/(ابي حجز|ابغى حجز|احجز|حجز|موعد)/i.test(qRaw)) {
      const service = findServiceFromText(qRaw);
      const date = extractDate(qRaw);
      const time = extractTime(qRaw);

      if (!service && !date) {
        return {
          text:
            "أكيد 💜 خلينا نرتّب الحجز بسرعة:\n" +
            "• ايش الخدمة اللي تبينها؟ (قص/مكياج/صبغة/بدكير...)\n" +
            "• وايش التاريخ؟ بصيغة YYYY-MM-DD\n" +
            "مثال: **أبغى حجز مكياج 2025-12-20**",
          actions: [
            { type: "route", label: "افتحي صفحة الحجز", value: "/booking" },
            {
              type: "send",
              label: "قائمة الأسعار",
              value: "عرض قائمة الأسعار",
            },
          ],
        };
      }

      if (service && !date) {
        return {
          text:
            `تمام 💜 خدمة **${service}**.\n` +
            "اكتبي التاريخ بصيغة YYYY-MM-DD عشان أطلع لك التوفر الفعلي.\n" +
            `مثال: **أوقات متاحة ${service} 2025-12-20**`,
          actions: [
            {
              type: "send",
              label: "مثال جاهز",
              value: `أوقات متاحة ${service} 2025-12-20`,
            },
            { type: "route", label: "احجزي الآن", value: "/booking" },
          ],
        };
      }

      if (service && date) {
        const allBookings = getAllBookings();

        // ✅ مقارنة مرنة (لأن بعض المشاريع تخزن القسم بدل اسم الخدمة)
        const bookedTimes = allBookings
          .filter((b) => (b.service || "").includes(service) && b.date === date)
          .map((b) => b.time);

        const availableTimes = hours.filter((t) => !bookedTimes.includes(t));

        return {
          text: availableTimes.length
            ? `🗓️ المتاح لـ **${service}** بتاريخ **${date}**:\n` +
              availableTimes.map((t) => `• ${t}`).join("\n") +
              (time
                ? `\n\nذكرتِ وقت **${time}**—إذا تبينه اكتبي: احجز ${service} ${date} ${time}`
                : "")
            : `للأسف ما فيه مواعيد متاحة لـ **${service}** بتاريخ **${date}**.\nجرّبي تاريخ ثاني 💜`,
          actions: [
            { type: "route", label: "افتحي صفحة الحجز", value: "/booking" },
            {
              type: "send",
              label: "العروض والخصومات",
              value: "العروض والخصومات",
            },
          ],
        };
      }
    }

    // ✅ سعر خدمة محددة
    const priceReply = getServicePriceReply(qRaw);
    if (priceReply) {
      const extra = pick([
        "إذا قلتي تاريخ مناسب لك، أطلع لك المواعيد المتاحة ✨",
        "تحبين نحجز لك مباشرة؟",
        "تبين أشوف لك عروض عليها إذا موجودة؟",
      ]);
      return {
        text: `${priceReply}\n${extra}`,
        actions: [
          { type: "route", label: "احجزي الآن", value: "/booking" },
          {
            type: "send",
            label: "العروض والخصومات",
            value: "العروض والخصومات",
          },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        ],
      };
    }

    // ✅ تواصل
    if (/طرق التواصل|تواصل|واتساب|رقم|جوال|رقمكم/i.test(qRaw)) {
      return {
        text:
          "أكيد 💜 هذي طرق التواصل:\n" +
          "📱 واتساب: 0500000000\n" +
          "☎️ هاتف: 011-0000000\n" +
          "📸 انستجرام: @queens_salon\n\n" +
          "إذا قلتي لي وش تحتاجين بالضبط، أوصلك للشخص المناسب بسرعة ✨",
        actions: [{ type: "route", label: "صفحة التواصل", value: "/contact" }],
      };
    }

    // ✅ 9.5) قائمة الخدمات (إذا كتب: الخدمات / خدماتكم / ايش عندكم)
    if (/(الخدمات|خدمات|ايش عندكم|وش عندكم|اقسام|الأقسام)/i.test(qRaw)) {
      return {
        text:
          "أكيد 💜 هذي أبرز أقسام وخدمات صالون ملكات:\n" +
          "• الشعر (قص/تسريحة/استشوار)\n" +
          "• الصبغات (صبغة/هايلايت/بالياج)\n" +
          "• المكياج (سهرة/عرايس)\n" +
          "• الأظافر (بدكير/منكير)\n" +
          "• البشرة (تنظيف/عناية)\n" +
          "• إزالة الشعر (واكس)\n\n" +
          "اختاري قسم، وأنا أعطيك **السعر** أو **المواعيد المتاحة** ✨",
        actions: [
          { type: "send", label: "الشعر", value: "الشعر" },
          { type: "send", label: "الصبغات", value: "الصبغات" },
          { type: "send", label: "مكياج", value: "مكياج" },
          { type: "send", label: "بدكير/منكير", value: "بدكير" },
          { type: "send", label: "عناية بالبشرة", value: "عناية بالبشرة" },
          { type: "send", label: "إزالة شعر", value: "إزالة شعر" },
        ],
        showAllPricesBtn: true,
      };
    }

    // ✅ 9.6) إذا كتب "الشعر" كقسم (مو خدمة)
    if (/^(الشعر|شعر|قسم الشعر)$/i.test(qRaw.trim())) {
      return {
        text:
          "تمام 💜 قسم الشعر عندنا يشمل خيارات كثيرة… تبين أي واحد؟\n" +
          "• قص الشعر\n" +
          "• تسريحة/استشوار\n" +
          "• صبغة شعر\n" +
          "• علاج بروتين\n\n" +
          "قولي الخيار أو اضغطي زر 👇",
        actions: [
          { type: "send", label: "قص الشعر", value: "قص الشعر" },
          { type: "send", label: "تسريحة شعر", value: "تسريحة شعر" },
          { type: "send", label: "صبغة شعر", value: "صبغة شعر" },
          { type: "send", label: "علاج بروتين", value: "علاج بروتين" },
          {
            type: "send",
            label: "مواعيد متاحة",
            value: "أوقات متاحة الشعر 2025-12-20",
          },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        ],
        showAllPricesBtn: true,
      };
    }

    // ✅ fallback إنساني
    const fallback = pick([
      "أكيد 💜 فهمت عليك… بس عشان أساعدك بدقة: تبين أسعار ولا عروض ولا حجز؟",
      "تمام 💜 وش الخدمة اللي تقصدين بالضبط؟ (قص/مكياج/صبغة/بدكير…)",
      "أنا معك 💜 اكتبي اسم الخدمة أو التاريخ وأنا أرتب لك كل شيء.",
      "اختاري من الأزرار تحت أو اكتبي سؤالك بكلمة وحدة 💜",
    ]);

    return {
      text: fallback,
      actions: pageActions,
      showAllPricesBtn: true,
    };
  };

  const handleSend = (custom?: string) => {
    const sendText = (custom ?? input).trim();
    if (!sendText) return;

    setMessages((prev) => [
      ...prev,
      { id: Date.now(), sender: "user", text: sendText },
    ]);
    setInput("");

    setTimeout(() => {
      const reply = smartReply(sendText);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: "bot",
          text: reply.text,
          actions: reply.actions,
          showAllPricesBtn: reply.showAllPricesBtn,
        },
      ]);
    }, 400);
  };

  const handleAction = (a: Action) => {
    if (a.type === "send") handleSend(a.value);
    if (a.type === "route") navigate(a.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend();
  };

  return (
    <>
      {/* زر الفقاعة */}
      {!open && (
        <button
          className="chatbot-fab"
          onClick={() => setOpen(true)}
          aria-label="افتح الشات"
          title="الدردشة مع خبيرتك"
        >
          <FixedFaCommentDots size={28} />
        </button>
      )}

      {/* نافذة الشات */}
      <div className={`chatbot-container ${open ? "open" : ""}`}>
        <div className="chatbot-header">
          <span>خبيرتك ملكات</span>

          <span
            className="chatbot-close"
            onClick={() => setOpen(false)}
            title="إغلاق"
          >
            ×
          </span>
        </div>

        {open && (
          <div className="chatbot-body">
            <div className="chatbot-messages">
              {messages.map((msg) => (
                <div key={msg.id} className={`msg ${msg.sender}`}>
                  <div className="msg-text">{msg.text}</div>

                  {msg.showAllPricesBtn && msg.sender === "bot" && (
                    <button className="bot-price-btn" onClick={sendAllPrices}>
                      عرض جميع الأسعار
                    </button>
                  )}

                  {msg.actions?.length ? (
                    <div className="suggestions-list">
                      {msg.actions.map((a, idx) => (
                        <button
                          key={idx}
                          className="suggestion-btn"
                          onClick={() => handleAction(a)}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="chatbot-input-row">
              <div
                className={`input-container${input.trim() ? " active" : ""}`}
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="اسألي عن الأسعار، العروض، أو الحجز..."
                />
                <button
                  className={`send-button ${input.trim() ? "active" : ""}`}
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  aria-label="إرسال"
                >
                  ↑
                </button>
              </div>
            </div>

            <div className="chatbot-footer-tools">
              <button
                className="tool-link"
                onClick={() => {
                  localStorage.removeItem(STORAGE.CHAT);
                  setMessages([
                    {
                      id: Date.now(),
                      sender: "bot",
                      text: "تم تصفير المحادثة ✅\nتبغين عروض ولا أسعار ولا حجز؟",
                      actions: pageActions,
                      showAllPricesBtn: true,
                    },
                  ]);
                }}
              >
                تصفير المحادثة
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ChatBot;
