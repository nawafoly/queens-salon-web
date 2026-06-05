// ✅ src/pages/settings/SettingsContact.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  setDoc, // ✅ NEW
} from "firebase/firestore";
import { db } from "../../services/firebase";

import { AppSettingsService } from "../../services/AppSettingsService";
import {
  SettingsPageActions,
  SettingsPageFrame,
  SettingsPageHeader,
  SettingsSection,
  SettingsStats,
} from "./SettingsFrame";

const SALON_ID = "main";

type ContactPublic = {
  phone?: string;
  whatsapp?: string;
  email?: string;
  city?: string;

  // ✅ نخليها address (لوحة التحكم)
  address?: string;

  // ✅ نخليها locationText (للتوافق مع Contact.tsx عندك)
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

function safeStr(v: any) {
  return String(v ?? "").trim();
}

const SettingsContact: React.FC<{ hasAdminPower: boolean }> = ({
  hasAdminPower,
}) => {
  // ✅ public settings doc
  const publicRef = useMemo(
    () => doc(db, "salons", SALON_ID, "settings", "public"),
    []
  );

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

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

  // ✅ messages
  const [showMessages, setShowMessages] = useState(false);
  const [messages, setMessages] = useState<ContactMessage[]>([]);

  const unreadCount = useMemo(
    () => messages.filter((m) => (m.status || "new") === "new").length,
    [messages]
  );

  const contactStats = useMemo(() => {
    const filledFields = [
      publicData.phone,
      publicData.whatsapp,
      publicData.email,
      publicData.city,
      publicData.address,
      publicData.hoursText,
      publicData.mapEmbedUrl,
    ].filter((v) => safeStr(v)).length;

    return [
      {
        label: "الحقول المعبأة",
        value: String(filledFields),
        hint: "من بيانات التواصل الأساسية",
      },
      {
        label: "إجمالي الرسائل",
        value: String(messages.length),
        hint: "آخر 20 رسالة فقط",
      },
      {
        label: "الرسائل الجديدة",
        value: String(unreadCount),
        hint: "تحتاج مراجعة",
      },
      {
        label: "الخريطة",
        value: publicData.mapEmbedUrl ? "مربوطة" : "غير مربوطة",
        hint: "رابط Google Maps Embed",
      },
    ];
  }, [
    messages.length,
    publicData.address,
    publicData.city,
    publicData.email,
    publicData.hoursText,
    publicData.mapEmbedUrl,
    publicData.phone,
    publicData.whatsapp,
    unreadCount,
  ]);

  // Load public settings realtime
  useEffect(() => {
    const unsub = onSnapshot(
      publicRef,
      (snap) => {
        if (!snap.exists()) {
          // ✅ لو الوثيقة مو موجودة: خلها فاضية (ولا ترجع)
          setPublicData((p) => ({
            phone: p.phone ?? "",
            whatsapp: p.whatsapp ?? "",
            email: p.email ?? "",
            city: p.city ?? "",
            address: p.address ?? "",
            locationText: p.locationText ?? "",
            hoursText: p.hoursText ?? "",
            mapEmbedUrl: p.mapEmbedUrl ?? "",
          }));
          return;
        }

        const d = snap.data() as any;
        setPublicData({
          phone: d?.phone || "",
          whatsapp: d?.whatsapp || "",
          email: d?.email || "",
          city: d?.city || "",
          address: d?.address || "",
          locationText: d?.locationText || d?.address || "",
          hoursText: d?.hoursText || "",
          mapEmbedUrl: d?.mapEmbedUrl || "",
        });
      },
      (err) => console.error("public settings snapshot error:", err)
    );

    return () => unsub();
  }, [publicRef]);

  // Load messages realtime (آخر 20)
  useEffect(() => {
    const qy = query(
      collection(db, "salons", SALON_ID, "contact_messages"),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: ContactMessage[] = snap.docs.map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            name: x?.name,
            email: x?.email,
            phone: x?.phone,
            subject: x?.subject,
            message: x?.message,
            status: (x?.status as any) || "new",
            createdAt: x?.createdAt,
          };
        });
        setMessages(list);
      },
      (err) => console.error("messages snapshot error:", err)
    );

    return () => unsub();
  }, []);

  const onChange = (key: keyof ContactPublic, value: string) => {
    setPublicData((p) => ({ ...p, [key]: value }));
  };

  const handleSave = async () => {
    if (!hasAdminPower) return;

    try {
      setSaving(true);

      const address = safeStr(publicData.address);
      const locationText = safeStr(publicData.locationText) || address;

      const payload: any = {
        phone: safeStr(publicData.phone),
        whatsapp: safeStr(publicData.whatsapp),
        email: safeStr(publicData.email),
        city: safeStr(publicData.city),

        // ✅ نخزن الاثنين عشان أي صفحة تعتمد على أي اسم
        address,
        locationText,

        hoursText: safeStr(publicData.hoursText),
        mapEmbedUrl: safeStr(publicData.mapEmbedUrl),

        updatedAt: serverTimestamp(),
      };

      // ✅ بدل updateDoc: setDoc مع merge (ينشئ تلقائيًا)
      await setDoc(publicRef, payload, { merge: true });

      setSavedMsg("✅ تم حفظ بيانات التواصل");
      setTimeout(() => setSavedMsg(""), 2000);
    } catch (e) {
      console.error("save contact public error:", e);
      setSavedMsg("❌ تعذر الحفظ");
      setTimeout(() => setSavedMsg(""), 2500);
    } finally {
      setSaving(false);
    }
  };

  const markRead = async (id: string) => {
    if (!hasAdminPower) return;

    try {
      const ref = doc(db, "salons", SALON_ID, "contact_messages", id);
      await updateDoc(ref, { status: "read", readAt: serverTimestamp() });
    } catch (e) {
      console.error("mark read error:", e);
    }
  };

  return (
    <SettingsPageFrame className="settings-contact-page">
      <SettingsPageHeader
        eyebrow="الوحدة 05"
        title="بيانات التواصل واللوكيشن"
        hint="بيانات التواصل التي تظهر في صفحة الموقع والخرائط ورسائل العميلات."
        actions={
          <button
            className="exp-btn"
            type="button"
            onClick={() => setShowMessages((s) => !s)}
            title="عرض آخر الرسائل"
          >
            الرسائل {unreadCount ? `(${unreadCount} جديد)` : ""}
          </button>
        }
        compact
      />

      <SettingsStats items={contactStats} />

      <SettingsSection
        eyebrow="01"
        title="بيانات التواصل الأساسية"
        hint="حقول مختصرة ومباشرة تظهر في الموقع ورسائل العميلات."
        className="settings-contact-section"
      >
        <div className="settings-grid">
          <div className="settings-field">
            <label>الجوال</label>
            <input
              className="settings-input"
              value={publicData.phone || ""}
              onChange={(e) => onChange("phone", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="05xxxxxxxx"
            />
          </div>

          <div className="settings-field">
            <label>واتساب</label>
            <input
              className="settings-input"
              value={publicData.whatsapp || ""}
              onChange={(e) => onChange("whatsapp", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="05xxxxxxxx"
            />
          </div>

          <div className="settings-field">
            <label>الإيميل</label>
            <input
              className="settings-input"
              value={publicData.email || ""}
              onChange={(e) => onChange("email", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="salon@email.com"
            />
          </div>

          <div className="settings-field">
            <label>المدينة</label>
            <input
              className="settings-input"
              value={publicData.city || ""}
              onChange={(e) => onChange("city", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="المدينة المنورة"
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow="02"
        title="العنوان والخريطة"
        hint="نصوص الظهور في صفحة التواصل ورابط Google Maps Embed."
        className="settings-contact-section"
      >
        <div className="settings-grid">
          <div className="settings-field settings-field--wide">
            <label>العنوان</label>
            <input
              className="settings-input"
              value={publicData.address || ""}
              onChange={(e) => onChange("address", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="شارع... حي... المدينة..."
            />
          </div>

          <div className="settings-field settings-field--wide">
            <label>العنوان (للعرض في صفحة Contact)</label>
            <input
              className="settings-input"
              value={publicData.locationText || ""}
              onChange={(e) => onChange("locationText", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="إذا تبي نص مختلف عن العنوان"
            />
            <div className="settings-field-help">
              إذا تركتيه فاضي، النظام بيستخدم “العنوان” تلقائيًا.
            </div>
          </div>

          <div className="settings-field settings-field--wide">
            <label>ساعات العمل (نص)</label>
            <textarea
              className="settings-input settings-textarea"
              value={publicData.hoursText || ""}
              onChange={(e) => onChange("hoursText", e.target.value)}
              disabled={!hasAdminPower}
              placeholder={
                "السبت - الأربعاء: 10:00 ص - 10:00 م\n الخميس: ...\n الجمعة: ..."
              }
            />
          </div>

          <div className="settings-field settings-field--wide">
            <label>رابط الخريطة (Google Maps Embed URL)</label>
            <input
              className="settings-input"
              value={publicData.mapEmbedUrl || ""}
              onChange={(e) => onChange("mapEmbedUrl", e.target.value)}
              disabled={!hasAdminPower}
              placeholder="https://www.google.com/maps/embed?pb=..."
            />
            <div className="settings-field-help">
              ملاحظة: هذا نفس الرابط اللي تحطه داخل iframe في صفحة Contact.
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* ✅ صندوق رسائل صغير مو مزعج */}
      {showMessages ? (
        <SettingsSection
          eyebrow="03"
          title="آخر الرسائل"
          hint="آخر 20 رسالة واردة من نموذج التواصل."
          className="settings-contact-section"
          actions={<span className="settings-shell__pill settings-shell__pill--outline">{messages.length} رسالة</span>}
        >

          {!messages.length ? (
            <div className="settings-state">
              <strong>لا توجد رسائل حالياً</strong>
              <p>ستظهر رسائل العميلات هنا عند وصولها.</p>
            </div>
          ) : (
            <div className="settings-contact-messages">
              {messages.map((m) => {
                const isNew = (m.status || "new") === "new";
                return (
                  <div
                    key={m.id}
                    className={`settings-contact-message ${isNew ? "is-new" : ""}`}
                  >
                    <div className="settings-contact-message__head">
                      <div>
                        {m.subject ? m.subject : "رسالة"}
                        {isNew ? (
                          <span className="settings-contact-message__new">
                            • جديد
                          </span>
                        ) : null}
                      </div>

                      {hasAdminPower ? (
                        <button
                          className="exp-btn"
                          type="button"
                          onClick={() => markRead(m.id)}
                          disabled={!isNew}
                          title="تحديد كمقروء"
                        >
                          مقروء
                        </button>
                      ) : null}
                    </div>

                    <div className="settings-contact-message__meta">
                      {m.name ? `الاسم: ${m.name}` : ""}
                      {m.phone ? ` • الجوال: ${m.phone}` : ""}
                      {m.email ? ` • الإيميل: ${m.email}` : ""}
                    </div>

                    <div className="settings-contact-message__body">
                      {m.message || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>
      ) : null}

      <SettingsPageActions
        note={
          <>
            {savedMsg ? <span className="settings-saved">{savedMsg}</span> : null}
            {!hasAdminPower ? (
              <div className="settings-note" style={{ marginTop: savedMsg ? 8 : 0 }}>
                * للتعديل تحتاج صلاحية Owner / Admin. (الاستقبال/الموظفات عرض فقط)
              </div>
            ) : (
              <div className="settings-footnote" style={{ marginTop: savedMsg ? 8 : 0 }}>
                * احفظ بعد تعديل بيانات التواصل حتى تنعكس في صفحة الموقع فورًا.
              </div>
            )}
          </>
        }
        actions={
          <button
            className={`exp-btn ${!hasAdminPower ? "is-disabled" : ""}`}
            type="button"
            disabled={!hasAdminPower || saving}
            onClick={handleSave}
            title={!hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ بيانات التواصل"}
          >
            {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
          </button>
        }
      />
    </SettingsPageFrame>
  );
};

export default SettingsContact;
