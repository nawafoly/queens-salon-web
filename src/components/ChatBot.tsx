// ✅ src/components/ChatBot.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCommentDots } from "@fortawesome/free-solid-svg-icons";

import { generateSalonTimeSlots } from "../helpers/timeSlots";
import "../styles/ChatBot.css";

import { db } from "../services/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

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

type OfferLike = {
  id?: string | number;
  title?: string;
  description?: string;
  code?: string;
  discountPercent?: number;
  discountPrice?: number;
  originalPrice?: number;
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
};

type PublicSettings = {
  phone?: string;
  whatsapp?: string;
  locationText?: string;
  hoursText?: string;
};

type BookingDoc = {
  id: string;
  date?: string; // "YYYY-MM-DD"
  time?: string; // "HH:mm"
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

const SALON_ID = "main";
const hours = generateSalonTimeSlots();

/* ==============================
   ✅ Helpers
================================ */
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

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

function formatAvailableTimes(times: string[]) {
  if (!times.length) return "للأسف ما فيه أوقات متاحة بهذا اليوم.";
  const chunk = times.slice(0, 10);
  return (
    "⏰ **الأوقات المتاحة:**\n" +
    chunk.map((t) => `• ${t}`).join("\n") +
    (times.length > chunk.length ? `\n\n… وفيه ${times.length - chunk.length} وقت إضافي.` : "")
  );
}

/* ==============================
   ✅ Offers fallback (LocalStorage)
================================ */
function readOffersFromLocalStorage(): OfferLike[] {
  for (const key of STORAGE.OFFERS_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const parsed = safeJsonParse<any>(raw, null);

    if (Array.isArray(parsed)) return parsed as OfferLike[];

    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.offers)) return parsed.offers as OfferLike[];
      if (Array.isArray(parsed.coupons)) return parsed.coupons as OfferLike[];
      if (Array.isArray(parsed.data)) return parsed.data as OfferLike[];
      if (Array.isArray(parsed.items)) return parsed.items as OfferLike[];
    }
  }
  return [];
}

function filterActiveOffers(offers: OfferLike[]): OfferLike[] {
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

/* ==============================
   ✅ Conversation State (الفلو الجديد)
================================ */
type FlowStep = "idle" | "ask_service" | "ask_date";

type BookingFlow = {
  step: FlowStep;
  serviceId?: string;
  serviceName?: string;
  date?: string;
};

const defaultFlow: BookingFlow = { step: "idle" };

const ChatBot: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const [services, setServices] = useState<ServiceDoc[]>([]);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [bookingsCache, setBookingsCache] = useState<Record<string, string[]>>({});
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // ✅ الحالة الجديدة
  const [flow, setFlow] = useState<BookingFlow>(defaultFlow);

  /** ✅ اقتراحات حسب الصفحة */
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

  /** ✅ تحميل المحادثة */
  useEffect(() => {
    const saved = safeJsonParse<Message[]>(localStorage.getItem(STORAGE.CHAT), []);
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

  /** ✅ تحديث اقتراحات أول رسالة */
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

  /** ✅ تحميل بيانات Firebase */
  useEffect(() => {
    const loadData = async () => {
      setLoadingCatalog(true);
      try {
        const srvSnap = await getDocs(collection(db, "salons", SALON_ID, "services"));
        const srv: ServiceDoc[] = srvSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setServices(srv);

        const pubRef = doc(db, "salons", SALON_ID, "settings", "public");
        const pubSnap = await getDoc(pubRef);
        setPublicSettings(pubSnap.exists() ? (pubSnap.data() as any) : null);
      } catch (e) {
        console.error("ChatBot loadData error:", e);
      } finally {
        setLoadingCatalog(false);
      }
    };

    loadData();
  }, []);

  const replyContact = () => {
    const phone =
    (publicSettings as any)?.phone ||
    (publicSettings as any)?.mobile ||
    (publicSettings as any)?.tel ||
    "05xxxxxxxx";
  
  const whatsapp =
    (publicSettings as any)?.whatsapp ||
    (publicSettings as any)?.wa ||
    phone;
  
  const locationText =
    (publicSettings as any)?.locationText ||
    (publicSettings as any)?.location ||
    "الرياض";
  
  const hoursText =
    (publicSettings as any)?.hoursText ||
    (publicSettings as any)?.hours ||
    "يوميًا 12:00م — 11:00م";
  

    return {
      text:
        "📍 **طرق التواصل:**\n" +
        `• الجوال: ${phone}\n` +
        `• واتساب: ${whatsapp}\n` +
        `• الموقع: ${locationText}\n` +
        `• ساعات العمل: ${hoursText}\n\n` +
        "تبغين أحجز لك موعد الآن؟",
      actions: [
        { type: "send", label: "احجزي موعد", value: "أبي أحجز" },
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      ] as Action[],
    };
  };

  const buildOffersReply = () => {
    const active = filterActiveOffers(readOffersFromLocalStorage());

    if (!active.length) {
      return {
        text: "حاليًا ما عندنا عروض فعّالة مسجّلة.\nتبغين أعرض لك قائمة الأسعار؟",
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
      const pct = typeof o.discountPercent === "number" ? `خصم ${o.discountPercent}%` : "";
      const price =
        typeof o.discountPrice === "number" && typeof o.originalPrice === "number"
          ? `بدل ${o.originalPrice} صار ${o.discountPrice}`
          : "";

      const extra = [pct, price].filter(Boolean).join(" - ");
      return `• ${title}${extra ? ` (${extra})` : ""}${code}${until}`;
    });

    return {
      text: "🎉 **العروض الحالية:**\n" + lines.join("\n\n") + "\n\nتبغين نحجز لك موعد؟",
      actions: [
        { type: "send", label: "احجزي موعد", value: "أبي أحجز" },
        { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
      ] as Action[],
    };
  };

  const buildPricesListReply = () => {
    if (loadingCatalog) {
      return {
        text: "لحظة 💜 قاعدة أحمّل قائمة الخدمات والأسعار من النظام…",
        actions: [{ type: "route", label: "احجزي الآن", value: "/booking" }] as Action[],
      };
    }

    const list = services
      .filter((s) => s.active !== false)
      .slice(0, 12)
      .map((s) => {
        const p = typeof s.price === "number" ? `${s.price} ريال` : "اسألي عن السعر";
        return `• ${s.name || "خدمة"}: ${p}`;
      })
      .join("\n");

    return {
      text:
        "💰 **الأسعار من النظام:**\n" +
        (list || "ما فيه خدمات محمّلة حاليًا.") +
        "\n\nتبين حجز؟ اكتبي: (أبي أحجز) ✨",
      actions: [
        { type: "send", label: "أبي أحجز", value: "أبي أحجز" },
        { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
      ] as Action[],
      showAllPricesBtn: true,
    };
  };

  const getBookedTimesForDate = async (dateISO: string): Promise<string[]> => {
    if (bookingsCache[dateISO]) return bookingsCache[dateISO];

    try {
      const qy = query(
        collection(db, "salons", SALON_ID, "bookings"),
        where("date", "==", dateISO)
      );
      const snap = await getDocs(qy);
      const times = snap.docs
        .map((d) => (d.data() as any)?.time)
        .map((t) => String(t || "").trim())
        .filter(Boolean);

      setBookingsCache((prev) => ({ ...prev, [dateISO]: times }));
      return times;
    } catch (e) {
      console.error("getBookedTimesForDate error:", e);
      setBookingsCache((prev) => ({ ...prev, [dateISO]: [] }));
      return [];
    }
  };

  const calcAvailableTimes = (bookedTimes: string[]) => {
    const taken = new Set(bookedTimes.map((t) => String(t).trim()));
    return hours.filter((t) => !taken.has(String(t).trim()));
  };

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

  const beginBookingFlow = () => {
    setFlow({ step: "ask_service" });
    pushBot({
      text: "أكيد 💜 وش الخدمة اللي تبينها؟ (مثال: قص / مكياج / صبغة / بدكير)",
      actions: [
        { type: "send", label: "قص", value: "قص الشعر" },
        { type: "send", label: "مكياج", value: "مكياج" },
        { type: "send", label: "صبغة", value: "صبغة شعر" },
        { type: "send", label: "بدكير", value: "بدكير" },
      ],
    });
  };

  const matchServiceFromUserText = (raw: string): ServiceDoc | null => {
    const q = normalizeArabic(raw);

    // 1) match by Firestore services
    const activeServices = services.filter((s) => s.active !== false);

    const exact = activeServices.find(
      (s) => normalizeArabic(String(s.name || "")) === q
    );
    if (exact) return exact;

    const partial = activeServices.find((s) =>
      normalizeArabic(String(s.name || "")).includes(q)
    );
    if (partial) return partial;

    // 2) fallback: keyword mapping -> then match
    const mapped = (() => {
      const rules: { regex: RegExp; name: string }[] = [
        { regex: /قص|قصة|قصات|قص الشعر|حلاقة شعر|قص اطراف/i, name: "قص الشعر" },
        { regex: /تسريح|تسريحة|استشوار/i, name: "تسريحة شعر" },
        { regex: /مكياج|ميكب|ميك اب|مكاب|مكيج|مكياج عرايس|مكياج سهرة/i, name: "مكياج" },
        { regex: /بدكير|بديكير/i, name: "بدكير" },
        { regex: /منكير|مناكير|اظافر/i, name: "منكير" },
        { regex: /بشرة|عناية بالبشرة|تنظيف بشرة|تقشير/i, name: "عناية بالبشرة" },
        { regex: /صبغ|صبغة|صبغات|تلوين شعر|هايلايت|بالياج/i, name: "صبغة شعر" },
        { regex: /بروتين|كيراتين|علاج بروتين|فرد شعر/i, name: "علاج بروتين" },
        { regex: /إزالة شعر|ازاله شعر|واكس|شمع|حواجب|نزع الشعر/i, name: "إزالة شعر" },
      ];
      for (const r of rules) if (r.regex.test(raw)) return r.name;
      return null;
    })();

    if (mapped) {
      const m = activeServices.find(
        (s) => normalizeArabic(String(s.name || "")) === normalizeArabic(mapped)
      );
      if (m) return m;

      const mp = activeServices.find((s) =>
        normalizeArabic(String(s.name || "")).includes(normalizeArabic(mapped))
      );
      if (mp) return mp;
    }

    return null;
  };

  const smartReply = async (inputText: string) => {
    const qRaw = inputText.trim();
    const q = normalizeArabic(qRaw);

    // ✅ أوامر واضحة للحجز
    if (/(ابي احجز|أبي أحجز|حجز|ابغى احجز|ابغى موعد|ابي موعد)/i.test(qRaw)) {
      beginBookingFlow();
      return;
    }

    // ✅ لو في فلو شغال: نكمّل الخطوات
    if (flow.step === "ask_service") {
      if (loadingCatalog) {
        pushBot({ text: "لحظة 💜 قاعدة أحمّل قائمة الخدمات من النظام…" });
        return;
      }

      const svc = matchServiceFromUserText(qRaw);
      if (!svc) {
        const sample = services
          .filter((s) => s.active !== false)
          .slice(0, 8)
          .map((s) => s.name)
          .filter(Boolean)
          .join("، ");

        pushBot({
          text:
            "تمام 💜 بس ما فهمت الخدمة بالضبط.\n" +
            "اكتبي اسم الخدمة (مثال: مكياج / قص / صبغة).\n" +
            (sample ? `\nخدمات شائعة عندنا: ${sample}` : ""),
          actions: [
            { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
          ],
        });
        return;
      }

      setFlow({ step: "ask_date", serviceId: svc.id, serviceName: svc.name });
      pushBot({
        text: `تمام 💜 خدمة **${svc.name}**.\nالآن عطيني التاريخ بصيغة **YYYY-MM-DD** (مثال: 2026-02-01)`,
        actions: [
          { type: "send", label: "مثال", value: "2026-02-01" },
        ],
      });
      return;
    }

    if (flow.step === "ask_date") {
      const date = extractDate(qRaw);
      if (!date) {
        pushBot({
          text:
            "تمام 💜 بس اكتب/ي التاريخ بصيغة **YYYY-MM-DD**\nمثال: 2026-02-01",
          actions: [{ type: "send", label: "مثال", value: "2026-02-01" }],
        });
        return;
      }

      // ✅ نجيب الحجوزات ونطلع الأوقات
      const booked = await getBookedTimesForDate(date);
      const available = calcAvailableTimes(booked);

      const svcName = flow.serviceName || "الخدمة";
      pushBot({
        text:
          `✅ خدمة: **${svcName}**\n📅 تاريخ: **${date}**\n\n` +
          formatAvailableTimes(available) +
          "\n\nتبغين نفتح لك صفحة الحجز وتكمّلين؟",
        actions: [
          { type: "route", label: "افتحي الحجز", value: "/booking" },
          { type: "send", label: "غيري الخدمة", value: "أبي أحجز" },
        ],
      });

      // ✅ نرجع الحالة idle بعد ما عرضنا الأوقات
      setFlow(defaultFlow);
      return;
    }

    // ✅ ترحيب
    if (isGreeting(q)) {
      pushBot({
        text: `${pick([
          "وعليكم السلام 💜 نورتِنا!",
          "هلا والله 💜 يا حيّاك!",
          "أهلًا وسهلًا 💜 يسعدني أساعدك!",
          "مرحبا 💜 نورتِ صالون ملكات!",
        ])}\n${pick([
          "تبغين أسعار، عروض، ولا نحجز لك موعد؟",
          "قولي لي تبين حجز ولا استفسار؟ ✨",
        ])}`,
        actions: [
          { type: "send", label: "أبي أحجز", value: "أبي أحجز" },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
          { type: "send", label: "العروض والخصومات", value: "العروض والخصومات" },
          { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
        ],
        showAllPricesBtn: true,
      });
      return;
    }

    // ✅ شكر
    if (isThanks(q)) {
      pushBot({
        text: pick([
          "العفو 💜 هذا واجبي! تبين نحجز لك؟",
          "تسلمين 💜 إذا تبين حجز قولي: أبي أحجز",
        ]),
        actions: [
          { type: "send", label: "أبي أحجز", value: "أبي أحجز" },
          { type: "send", label: "قائمة الأسعار", value: "عرض قائمة الأسعار" },
        ],
        showAllPricesBtn: true,
      });
      return;
    }

    // ✅ وداع
    if (isBye(q)) {
      pushBot({
        text: pick([
          "مع السلامة 💜 إذا احتجتِ أي شيء أنا موجودة.",
          "في أمان الله 💜 متى ما تبين حجز رجعي لي.",
        ]),
        actions: [{ type: "route", label: "الصفحة الرئيسية", value: "/" }],
      });
      return;
    }

    // ✅ شكوى
    if (isComplaint(q)) {
      pushBot({
        text:
          "آسفة جدًا إن التجربة ما كانت على توقعاتك 💜\n" +
          "قولي لي:\n1) وش الخدمة؟\n2) متى كانت الزيارة؟\n3) تبين تواصل سريع؟",
        actions: [
          { type: "send", label: "طرق التواصل", value: "طرق التواصل" },
          { type: "send", label: "أبي أحجز", value: "أبي أحجز" },
        ],
      });
      return;
    }

    // ✅ طرق التواصل
    if (/(تواصل|اتصال|رقم|واتس|واتساب|عنوان|لوكيشن|موقع|اين موقعكم|وينكم)/i.test(qRaw)) {
      pushBot(replyContact());
      return;
    }

    // ✅ قائمة الأسعار
    if (
      /(عرض\s*قائمة\s*الاسعار|عرض\s*قائمة\s*الأسعار|قائمة\s*الاسعار|قائمة\s*الأسعار|كم.*اسعاركم|بكم خدماتكم)/i.test(
        qRaw
      )
    ) {
      pushBot(buildPricesListReply());
      return;
    }

    // ✅ العروض
    if (
      /(^|\s)(عروض|خصومات|برومو|كوبون)(\s|$)/i.test(qRaw) ||
      /العروض والخصومات/i.test(qRaw)
    ) {
      pushBot(buildOffersReply());
      return;
    }

    // ✅ إذا سأل “أوقات متاحة” بدون ما يمشي الفلو: نبدأ الفلو بدل “أنت مكياج؟”
    if (/(اوقات متاحه|أوقات متاحة|مواعيد متاحه|مواعيد|وقت متاح|available)/i.test(qRaw)) {
      beginBookingFlow();
      return;
    }

    // ✅ Default
    pushBot({
      text:
        "تمام 💜 تبين:\n" +
        "• (أبي أحجز)\n• (قائمة الأسعار)\n• (العروض والخصومات)\n• (طرق التواصل)",
      actions: pageActions,
      showAllPricesBtn: true,
    });
  };

  const sendAllPrices = () => {
    pushBot(buildPricesListReply());
  };

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

  const handleAction = async (a: Action) => {
    if (a.type === "route") {
      navigate(a.value);
      return;
    }
    await sendText(a.value);
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
            <button className="chatbot-close" type="button" onClick={() => setOpen(false)}>
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
                      <button className="chatbot-quick" type="button" onClick={sendAllPrices}>
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
              <button className="chatbot-send" type="button" onClick={handleSend}>
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
