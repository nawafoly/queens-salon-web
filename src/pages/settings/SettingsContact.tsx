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
    <div className="settings-card" style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <h3 className="settings-title" style={{ marginBottom: 0 }}>
          بيانات التواصل واللوكيشن
        </h3>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {savedMsg ? <span className="settings-saved">{savedMsg}</span> : null}

          <button
            className={`exp-btn ${!hasAdminPower ? "is-disabled" : ""}`}
            type="button"
            disabled={!hasAdminPower || saving}
            onClick={handleSave}
            title={!hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ بيانات التواصل"}
          >
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>

          <button
            className="exp-btn"
            type="button"
            onClick={() => setShowMessages((s) => !s)}
            title="عرض آخر الرسائل"
          >
            الرسائل {unreadCount ? `(${unreadCount} جديد)` : ""}
          </button>
        </div>
      </div>

      {/* ✅ حقول صغيرة ومضغوطة */}
      <div className="settings-grid" style={{ marginTop: 12 }}>
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

      <div className="settings-grid" style={{ marginTop: 10 }}>
        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
          <label>العنوان</label>
          <input
            className="settings-input"
            value={publicData.address || ""}
            onChange={(e) => onChange("address", e.target.value)}
            disabled={!hasAdminPower}
            placeholder="شارع... حي... المدينة..."
          />
        </div>

        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
          <label>العنوان (للعرض في صفحة Contact)</label>
          <input
            className="settings-input"
            value={publicData.locationText || ""}
            onChange={(e) => onChange("locationText", e.target.value)}
            disabled={!hasAdminPower}
            placeholder="إذا تبي نص مختلف عن العنوان"
          />
          <div style={{ marginTop: 8, opacity: 0.8, fontSize: 13 }}>
            إذا تركتيه فاضي، النظام بيستخدم “العنوان” تلقائيًا.
          </div>
        </div>

        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
          <label>ساعات العمل (نص)</label>
          <textarea
            className="settings-input"
            style={{ minHeight: 110, resize: "vertical", paddingTop: 10 }}
            value={publicData.hoursText || ""}
            onChange={(e) => onChange("hoursText", e.target.value)}
            disabled={!hasAdminPower}
            placeholder={
              "السبت - الأربعاء: 10:00 ص - 10:00 م\n الخميس: ...\n الجمعة: ..."
            }
          />
        </div>

        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
          <label>رابط الخريطة (Google Maps Embed URL)</label>
          <input
            className="settings-input"
            value={publicData.mapEmbedUrl || ""}
            onChange={(e) => onChange("mapEmbedUrl", e.target.value)}
            disabled={!hasAdminPower}
            placeholder="https://www.google.com/maps/embed?pb=..."
          />
          <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
            ملاحظة: هذا نفس الرابط اللي تحطه داخل iframe في صفحة Contact.
          </div>
        </div>
      </div>

      {/* ✅ صندوق رسائل صغير مو مزعج */}
      {showMessages ? (
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid rgba(0,0,0,0.06)",
            paddingTop: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 900 }}>آخر الرسائل</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>(آخر 20 رسالة فقط)</div>
          </div>

          {!messages.length ? (
            <div style={{ opacity: 0.75 }}>لا توجد رسائل حالياً.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {messages.map((m) => {
                const isNew = (m.status || "new") === "new";
                return (
                  <div
                    key={m.id}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.07)",
                      background: isNew
                        ? "rgba(64,1,13,0.05)"
                        : "rgba(0,0,0,0.02)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>
                        {m.subject ? m.subject : "رسالة"}
                        {isNew ? (
                          <span style={{ marginInlineStart: 8, color: "#40010D" }}>
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

                    <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                      {m.name ? `الاسم: ${m.name}` : ""}
                      {m.phone ? ` • الجوال: ${m.phone}` : ""}
                      {m.email ? ` • الإيميل: ${m.email}` : ""}
                    </div>

                    <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {m.message || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {!hasAdminPower ? (
        <div className="settings-note" style={{ marginTop: 10 }}>
          * للتعديل تحتاج صلاحية Owner / Admin. (الاستقبال/الموظفات عرض فقط)
        </div>
      ) : null}
    </div>
  );
};

export default SettingsContact;
