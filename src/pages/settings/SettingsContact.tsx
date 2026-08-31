import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { DashboardEmptyStateV2 } from "../../components/dashboard-v2";
import { db } from "../../services/firebase";
import "../../styles/dashboard-v2/dashboard-v2.css";

const SALON_ID = "main";

type ContactPublic = {
  phone?: string;
  whatsapp?: string;
  email?: string;
  city?: string;
  address?: string;
  locationText?: string;
  hoursText?: string;
  mapEmbedUrl?: string;
};

type ContactMessage = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  status?: "new" | "read";
  createdAt?: any;
};

type SettingsContactProps = {
  hasAdminPower: boolean;
};

function safeStr(value: unknown) {
  return String(value ?? "").trim();
}

function formatMessageDate(value: any) {
  if (!value) return "";
  try {
    const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return "";
  }
}

export default function SettingsContact({ hasAdminPower }: SettingsContactProps) {
  const publicRef = useMemo(
    () => doc(db, "salons", SALON_ID, "settings", "public"),
    [],
  );

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [showMessages, setShowMessages] = useState(false);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [publicData, setPublicData] = useState<ContactPublic>({
    phone: "",
    whatsapp: "",
    email: "",
    city: "",
    address: "",
    locationText: "",
    hoursText: "",
    mapEmbedUrl: "",
  });

  const unreadCount = useMemo(
    () => messages.filter((message) => (message.status || "new") === "new").length,
    [messages],
  );

  const filledFields = useMemo(
    () => [
      publicData.phone,
      publicData.whatsapp,
      publicData.email,
      publicData.city,
      publicData.address,
      publicData.hoursText,
      publicData.mapEmbedUrl,
    ].filter((value) => safeStr(value)).length,
    [
      publicData.address,
      publicData.city,
      publicData.email,
      publicData.hoursText,
      publicData.mapEmbedUrl,
      publicData.phone,
      publicData.whatsapp,
    ],
  );

  const contactStats = useMemo(
    () => [
      {
        label: "الحقول المعبأة",
        value: `${filledFields}/7`,
        hint: "من بيانات التواصل الأساسية",
        tone: "dsv2-metric-card--gold",
      },
      {
        label: "إجمالي الرسائل",
        value: String(messages.length),
        hint: "آخر 20 رسالة فقط",
        tone: "dsv2-metric-card--dark",
      },
      {
        label: "الرسائل الجديدة",
        value: String(unreadCount),
        hint: unreadCount ? "تحتاج مراجعة" : "لا توجد رسائل جديدة",
        tone: unreadCount ? "dsv2-metric-card--danger" : "dsv2-metric-card--success",
      },
      {
        label: "الخريطة",
        value: publicData.mapEmbedUrl ? "مربوطة" : "غير مربوطة",
        hint: "Google Maps Embed",
        tone: publicData.mapEmbedUrl ? "dsv2-metric-card--success" : "dsv2-metric-card--dark",
      },
    ],
    [filledFields, messages.length, publicData.mapEmbedUrl, unreadCount],
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      publicRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setPublicData((previous) => ({
            phone: previous.phone ?? "",
            whatsapp: previous.whatsapp ?? "",
            email: previous.email ?? "",
            city: previous.city ?? "",
            address: previous.address ?? "",
            locationText: previous.locationText ?? "",
            hoursText: previous.hoursText ?? "",
            mapEmbedUrl: previous.mapEmbedUrl ?? "",
          }));
          return;
        }

        const data = snapshot.data() as any;
        setPublicData({
          phone: data?.phone || "",
          whatsapp: data?.whatsapp || "",
          email: data?.email || "",
          city: data?.city || "",
          address: data?.address || "",
          locationText: data?.locationText || data?.address || "",
          hoursText: data?.hoursText || "",
          mapEmbedUrl: data?.mapEmbedUrl || "",
        });
      },
      (error) => console.error("public settings snapshot error:", error),
    );

    return () => unsubscribe();
  }, [publicRef]);

  useEffect(() => {
    const messagesQuery = query(
      collection(db, "salons", SALON_ID, "contact_messages"),
      orderBy("createdAt", "desc"),
      limit(20),
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setMessages(snapshot.docs.map((messageDoc) => {
          const data = messageDoc.data() as any;
          return {
            id: messageDoc.id,
            name: data?.name,
            email: data?.email,
            phone: data?.phone,
            subject: data?.subject,
            message: data?.message,
            status: (data?.status as ContactMessage["status"]) || "new",
            createdAt: data?.createdAt,
          };
        }));
      },
      (error) => console.error("messages snapshot error:", error),
    );

    return () => unsubscribe();
  }, []);

  const onChange = (key: keyof ContactPublic, value: string) => {
    setPublicData((previous) => ({ ...previous, [key]: value }));
  };

  const handleSave = async () => {
    if (!hasAdminPower) return;

    try {
      setSaving(true);
      const address = safeStr(publicData.address);
      const locationText = safeStr(publicData.locationText) || address;

      await setDoc(publicRef, {
        phone: safeStr(publicData.phone),
        whatsapp: safeStr(publicData.whatsapp),
        email: safeStr(publicData.email),
        city: safeStr(publicData.city),
        address,
        locationText,
        hoursText: safeStr(publicData.hoursText),
        mapEmbedUrl: safeStr(publicData.mapEmbedUrl),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setSavedMsg("تم حفظ بيانات التواصل");
      window.setTimeout(() => setSavedMsg(""), 2000);
    } catch (error) {
      console.error("save contact public error:", error);
      setSavedMsg("تعذر حفظ بيانات التواصل");
      window.setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  const markRead = async (id: string) => {
    if (!hasAdminPower) return;

    try {
      const messageRef = doc(db, "salons", SALON_ID, "contact_messages", id);
      await updateDoc(messageRef, {
        status: "read",
        readAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("mark read error:", error);
    }
  };

  const saveFailed = savedMsg === "تعذر حفظ بيانات التواصل";

  return (
    <main className="dsv2-page settings-contact-v2-page" dir="rtl">
      <section className="dsv2-card settings-contact-v2-hero">
        <div className="settings-contact-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">إعدادات التواصل</span>
          <h1 className="dsv2-page-title">بيانات التواصل واللوكيشن</h1>
          <p className="dsv2-page-subtitle">
            إدارة بيانات التواصل التي تظهر في الموقع، نص العنوان، الخريطة، ورسائل العميلات الواردة.
          </p>
          <div className="settings-contact-v2-hero__badges">
            <span className={`dsv2-badge ${hasAdminPower ? "dsv2-badge--success" : ""}`}>
              {hasAdminPower ? "قابل للتعديل" : "عرض فقط"}
            </span>
            <span className="dsv2-badge">آخر 20 رسالة</span>
          </div>
        </div>

        <button
          className="dsv2-btn dsv2-btn--secondary"
          type="button"
          onClick={() => setShowMessages((current) => !current)}
        >
          {showMessages ? "إخفاء الرسائل" : `عرض الرسائل${unreadCount ? ` (${unreadCount} جديد)` : ""}`}
        </button>
      </section>

      <section className="settings-contact-v2-metrics" aria-label="ملخص بيانات التواصل">
        {contactStats.map((item) => (
          <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
            <p className="dsv2-metric-card__label">{item.label}</p>
            <p className="dsv2-metric-card__value">{item.value}</p>
            <p className="dsv2-metric-card__meta">{item.hint}</p>
          </article>
        ))}
      </section>

      <section className="settings-contact-v2-grid">
        <article className="dsv2-card dsv2-card--padded settings-contact-v2-panel">
          <header className="settings-contact-v2-panel__head">
            <div>
              <span className="settings-contact-v2-panel__eyebrow">01</span>
              <h2>بيانات التواصل الأساسية</h2>
              <p>الجوال والواتساب والبريد والمدينة المستخدمة في واجهات العميلات.</p>
            </div>
            <span className="dsv2-badge">4 حقول</span>
          </header>

          <div className="settings-contact-v2-form-grid">
            <label className="dsv2-field">
              <span className="dsv2-field__label">الجوال</span>
              <input
                className="dsv2-input"
                value={publicData.phone || ""}
                onChange={(event) => onChange("phone", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="05xxxxxxxx"
                inputMode="tel"
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-field__label">واتساب</span>
              <input
                className="dsv2-input"
                value={publicData.whatsapp || ""}
                onChange={(event) => onChange("whatsapp", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="05xxxxxxxx"
                inputMode="tel"
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-field__label">البريد الإلكتروني</span>
              <input
                className="dsv2-input"
                type="email"
                value={publicData.email || ""}
                onChange={(event) => onChange("email", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="salon@email.com"
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-field__label">المدينة</span>
              <input
                className="dsv2-input"
                value={publicData.city || ""}
                onChange={(event) => onChange("city", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="المدينة المنورة"
              />
            </label>
          </div>
        </article>

        <article className="dsv2-card dsv2-card--padded settings-contact-v2-panel">
          <header className="settings-contact-v2-panel__head">
            <div>
              <span className="settings-contact-v2-panel__eyebrow">02</span>
              <h2>العنوان والخريطة</h2>
              <p>نص الظهور في صفحة التواصل وساعات العمل ورابط Google Maps Embed.</p>
            </div>
            <span className={`dsv2-badge ${publicData.mapEmbedUrl ? "dsv2-badge--success" : ""}`}>
              {publicData.mapEmbedUrl ? "الخريطة مربوطة" : "بدون خريطة"}
            </span>
          </header>

          <div className="settings-contact-v2-form-grid settings-contact-v2-form-grid--location">
            <label className="dsv2-field settings-contact-v2-field--wide">
              <span className="dsv2-field__label">العنوان</span>
              <input
                className="dsv2-input"
                value={publicData.address || ""}
                onChange={(event) => onChange("address", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="شارع... حي... المدينة..."
              />
            </label>

            <label className="dsv2-field settings-contact-v2-field--wide">
              <span className="dsv2-field__label">العنوان المعروض في صفحة Contact</span>
              <input
                className="dsv2-input"
                value={publicData.locationText || ""}
                onChange={(event) => onChange("locationText", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="اتركه فارغًا لاستخدام العنوان تلقائيًا"
              />
              <small className="settings-contact-v2-field__hint">
                إذا كان فارغًا، يستخدم النظام قيمة العنوان تلقائيًا عند الحفظ.
              </small>
            </label>

            <label className="dsv2-field settings-contact-v2-field--wide">
              <span className="dsv2-field__label">ساعات العمل</span>
              <textarea
                className="dsv2-input settings-contact-v2-textarea"
                value={publicData.hoursText || ""}
                onChange={(event) => onChange("hoursText", event.target.value)}
                disabled={!hasAdminPower}
                placeholder={"السبت - الأربعاء: 10:00 ص - 10:00 م\nالخميس: ...\nالجمعة: ..."}
              />
            </label>

            <label className="dsv2-field settings-contact-v2-field--wide">
              <span className="dsv2-field__label">Google Maps Embed URL</span>
              <input
                className="dsv2-input"
                value={publicData.mapEmbedUrl || ""}
                onChange={(event) => onChange("mapEmbedUrl", event.target.value)}
                disabled={!hasAdminPower}
                placeholder="https://www.google.com/maps/embed?pb=..."
                dir="ltr"
              />
              <small className="settings-contact-v2-field__hint">
                استخدم رابط Embed نفسه المستخدم داخل iframe في صفحة التواصل.
              </small>
            </label>
          </div>
        </article>
      </section>

      {showMessages ? (
        <section className="dsv2-card dsv2-card--padded settings-contact-v2-panel settings-contact-v2-messages-panel">
          <header className="settings-contact-v2-panel__head">
            <div>
              <span className="settings-contact-v2-panel__eyebrow">03</span>
              <h2>آخر الرسائل</h2>
              <p>آخر 20 رسالة واردة من نموذج التواصل، مع حالة القراءة.</p>
            </div>
            <div className="settings-contact-v2-message-counts">
              <span className="dsv2-badge">{messages.length} رسالة</span>
              {unreadCount ? <span className="dsv2-badge dsv2-badge--gold">{unreadCount} جديدة</span> : null}
            </div>
          </header>

          {messages.length ? (
            <div className="settings-contact-v2-messages">
              {messages.map((message) => {
                const isNew = (message.status || "new") === "new";
                const messageDate = formatMessageDate(message.createdAt);

                return (
                  <article
                    key={message.id}
                    className={`settings-contact-v2-message ${isNew ? "is-new" : ""}`}
                  >
                    <header className="settings-contact-v2-message__head">
                      <div className="settings-contact-v2-message__title">
                        <strong>{message.subject || "رسالة"}</strong>
                        <div className="settings-contact-v2-message__badges">
                          {isNew ? <span className="dsv2-badge dsv2-badge--gold">جديدة</span> : <span className="dsv2-badge dsv2-badge--success">مقروءة</span>}
                          {messageDate ? <span className="dsv2-badge">{messageDate}</span> : null}
                        </div>
                      </div>

                      {hasAdminPower ? (
                        <button
                          className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                          type="button"
                          onClick={() => void markRead(message.id)}
                          disabled={!isNew}
                        >
                          تحديد كمقروء
                        </button>
                      ) : null}
                    </header>

                    <div className="settings-contact-v2-message__meta">
                      {message.name ? <span><strong>الاسم</strong>{message.name}</span> : null}
                      {message.phone ? <span><strong>الجوال</strong>{message.phone}</span> : null}
                      {message.email ? <span><strong>البريد</strong>{message.email}</span> : null}
                    </div>

                    <p className="settings-contact-v2-message__body">{message.message || "—"}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <DashboardEmptyStateV2
              title="لا توجد رسائل حالياً"
              description="ستظهر رسائل العميلات هنا عند وصولها من نموذج التواصل."
              compact
              tone="gold"
            />
          )}
        </section>
      ) : null}

      <section className="dsv2-card dsv2-card--padded settings-contact-v2-savebar">
        <div className="settings-contact-v2-savebar__copy">
          <strong>حفظ بيانات التواصل</strong>
          <p>
            {hasAdminPower
              ? "احفظ بعد تعديل البيانات حتى تنعكس على الصفحات التي تعتمد على مستند settings/public."
              : "الحساب الحالي يملك صلاحية العرض فقط ولا يستطيع تعديل بيانات التواصل."}
          </p>
          {savedMsg ? (
            <span
              className={`dsv2-badge ${saveFailed ? "dsv2-badge--danger" : "dsv2-badge--success"}`}
              role={saveFailed ? "alert" : "status"}
            >
              {savedMsg}
            </span>
          ) : null}
        </div>

        <button
          className="dsv2-btn dsv2-btn--primary"
          type="button"
          disabled={!hasAdminPower || saving}
          onClick={() => void handleSave()}
          title={!hasAdminPower ? "تحتاج صلاحية settings.content.manage" : "حفظ بيانات التواصل"}
        >
          {saving ? "جاري الحفظ…" : "حفظ التغييرات"}
        </button>
      </section>
    </main>
  );
}
