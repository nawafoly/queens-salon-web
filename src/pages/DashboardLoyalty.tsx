/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  FiAward,
  FiSearch,
  FiSettings,
  FiStar,
  FiTrendingUp,
  FiUsers,
} from "react-icons/fi";
import { DashboardSelectV2 } from "../components/dashboard-v2";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  setDoc,
} from "firebase/firestore";

import { db } from "../services/firebase";
import { FirestoreReadStats } from "../services/firestoreReadStats";

const SALON_ID = "main";

/* =========================
   Types
========================= */

type LoyaltySettings = {
  pointsMode: "service" | "amount";
  amountPointsStep: number;
  loyaltyWindowDays: number;
  vipAutoEnabled: boolean;
  vipAutoThreshold: number;
};

type ClientRow = {
  id: string;
  name?: string;
  phone?: string;
  loyaltyPoints?: number;
  loyaltyStats?: {
    loyaltyScore?: number;
    completedCountWindow?: number;
    lastCompletedAt?: any;
  };
  vip?: {
    isVip?: boolean;
    vipOverride?: boolean;
  };
};

/* =========================
   Helpers
========================= */

function formatDate(ts?: any) {
  if (!ts) return "-";
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("ar-SA-u-nu-latn", {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
  } catch {
    return "-";
  }
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits }).format(
    Number.isFinite(value) ? value : 0
  );
}

const pointsModeOptions = [
  { value: "service", label: "حسب الخدمة (زيارة واحدة = نقطة)" },
  { value: "amount", label: "حسب المبلغ المدفوع" },
];

/* =========================
   Component
========================= */

export default function DashboardLoyalty() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<LoyaltySettings>({
    pointsMode: "service",
    amountPointsStep: 10,
    loyaltyWindowDays: 90,
    vipAutoEnabled: true,
    vipAutoThreshold: 70,
  });

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [search, setSearch] = useState("");

  /* =========================
     Load settings
  ========================= */
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const ref = doc(db, "salons", SALON_ID, "settings", "loyalty");
        FirestoreReadStats.bump(ref.path, "DashboardLoyalty.loadSettings", "getDoc");
        const snap = await getDoc(ref);
        
        if (snap.exists()) {
          setSettings((prev) => ({
            ...prev,
            ...(snap.data() as any),
          }));
        }
      } catch (e) {
        console.error("Error loading loyalty settings:", e);
      }
    };

    loadSettings();
  }, []);

  /* =========================
     Load clients
  ========================= */
  useEffect(() => {
    const loadClients = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "users"));
        snap.docs.forEach((d) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, "DashboardLoyalty.loadClients", "getDocs");
        });
        const rows: ClientRow[] = [];

        snap.forEach((d) => {
          const data = d.data() as any;
          if (data.role !== "client") return;

          rows.push({
            id: d.id,
            ...data,
          });
        });

        // Sort by loyalty score descending
        rows.sort((a, b) => (b.loyaltyStats?.loyaltyScore || 0) - (a.loyaltyStats?.loyaltyScore || 0));
        
        setClients(rows);
      } catch (e) {
        console.error("Error loading clients:", e);
      } finally {
        setLoading(false);
      }
    };

    loadClients();
  }, []);

  /* =========================
     Save settings
  ========================= */
  const saveSettings = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, "salons", SALON_ID, "settings", "loyalty"),
        settings,
        { merge: true }
      );
      alert("تم حفظ إعدادات الولاء بنجاح ✅");
    } catch (e) {
      console.error(e);
      alert("حدث خطأ أثناء حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  /* =========================
     VIP toggle
  ========================= */
  const toggleVip = async (c: ClientRow) => {
    const newVipStatus = !c?.vip?.isVip;
    try {
      await updateDoc(doc(db, "users", c.id), {
        "vip.isVip": newVipStatus,
        "vip.vipOverride": true,
      });

      setClients((prev) =>
        prev.map((x) =>
          x.id === c.id
            ? {
                ...x,
                vip: {
                  isVip: newVipStatus,
                  vipOverride: true,
                },
              }
            : x
        )
      );
    } catch (e) {
      console.error("Error toggling VIP:", e);
      alert("فشل في تحديث حالة VIP");
    }
  };

  /* =========================
     Filtered clients
  ========================= */
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clients;

    return clients.filter((c) =>
      `${c.name || ""} ${c.phone || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [clients, search]);

  const vipCount = useMemo(
    () => clients.filter((client) => client?.vip?.isVip).length,
    [clients]
  );

  const totalPoints = useMemo(
    () => clients.reduce((sum, client) => sum + Number(client.loyaltyPoints || 0), 0),
    [clients]
  );

  const averageScore = useMemo(
    () => clients.length
      ? clients.reduce((sum, client) => sum + Number(client.loyaltyStats?.loyaltyScore || 0), 0) / clients.length
      : 0,
    [clients]
  );

  /* =========================
     UI
  ========================= */

  return (
    <main className="dsv2-page dsv2-loyalty-page" dir="rtl">
      <header className="dsv2-page-head dsv2-loyalty-page-head">
        <div>
          <p className="dsv2-loyalty-eyebrow">Customer Retention</p>
          <h1 className="dsv2-page-title">برنامج الولاء والعملاء المميزون</h1>
          <p className="dsv2-page-subtitle">
            إدارة النقاط، درجة الولاء، والتأهيل التلقائي لعملاء VIP من شاشة واحدة.
          </p>
        </div>

        <div className="dsv2-card dsv2-card--padded dsv2-loyalty-summary">
          <span className="dsv2-loyalty-summary__icon" aria-hidden="true"><FiAward /></span>
          <div>
            <span>إجمالي العملاء</span>
            <strong>{formatNumber(clients.length)}</strong>
            <small>{formatNumber(filtered.length)} نتيجة ظاهرة</small>
          </div>
        </div>
      </header>

      <section className="dsv2-grid--metrics dsv2-loyalty-metrics" aria-label="ملخص الولاء">
        <article className="dsv2-metric-card dsv2-metric-card--gold dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiUsers /></span>
          <div>
            <p className="dsv2-metric-card__label">إجمالي العملاء</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(clients.length)}</p>
            <p className="dsv2-metric-card__meta">كل حسابات العملاء المحملة</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiStar /></span>
          <div>
            <p className="dsv2-metric-card__label">عملاء VIP</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(vipCount)}</p>
            <p className="dsv2-metric-card__meta">حسب حالة VIP الحالية</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiTrendingUp /></span>
          <div>
            <p className="dsv2-metric-card__label">متوسط Loyalty Score</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(averageScore, 1)}</p>
            <p className="dsv2-metric-card__meta">متوسط درجات العملاء</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiAward /></span>
          <div>
            <p className="dsv2-metric-card__label">رصيد النقاط</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(totalPoints)}</p>
            <p className="dsv2-metric-card__meta">مجموع النقاط الحالي</p>
          </div>
        </article>
      </section>

      {/* SETTINGS */}
      <section className="dsv2-card dsv2-card--padded dsv2-loyalty-settings" aria-labelledby="loyalty-settings-title">
        <div className="dsv2-section-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">إعدادات البرنامج</p>
            <h2 id="loyalty-settings-title" className="dsv2-section-title">إعدادات برنامج الولاء</h2>
            <p className="dsv2-section-caption">تحديد طريقة احتساب النقاط وحدود التأهيل التلقائي للعملاء المميزين.</p>
          </div>
          <span className="dsv2-loyalty-panel-icon" aria-hidden="true"><FiSettings /></span>
        </div>

        <div className="dsv2-loyalty-settings-grid">
          <label className="dsv2-field">
            <span className="dsv2-field__label">وضع احتساب النقاط</span>
            <DashboardSelectV2
              value={settings.pointsMode}
              options={pointsModeOptions}
              onChange={(value) =>
                setSettings((s) => ({
                  ...s,
                  pointsMode: value as LoyaltySettings["pointsMode"],
                }))
              }
            />
          </label>
  
          {settings.pointsMode === "amount" && (
            <label className="dsv2-field">
              <span className="dsv2-field__label">قيمة النقطة (كل كم ريال = نقطة)</span>
              <input dir="ltr" lang="en"
                className="dsv2-input"
                type="number"
                value={settings.amountPointsStep}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    amountPointsStep: Number(e.target.value),
                  }))
                }
              />
            </label>
          )}
  
          <label className="dsv2-field">
            <span className="dsv2-field__label">فترة تقييم الولاء (بالأيام)</span>
            <input dir="ltr" lang="en"
              className="dsv2-input"
              type="number"
              value={settings.loyaltyWindowDays}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  loyaltyWindowDays: Number(e.target.value),
                }))
              }
            />
          </label>
  
          <button
            type="button"
            className={`dsv2-loyalty-toggle ${settings.vipAutoEnabled ? "is-on" : ""}`}
            role="switch"
            aria-checked={settings.vipAutoEnabled}
            onClick={() =>
              setSettings((s) => ({
                ...s,
                vipAutoEnabled: !s.vipAutoEnabled,
              }))
            }
          >
            <span className="dsv2-loyalty-toggle__mark" aria-hidden="true">{settings.vipAutoEnabled ? "✓" : ""}</span>
            <span className="dsv2-loyalty-toggle__copy">
              <strong>تفعيل VIP تلقائي</strong>
              <small>يعتمد على حد التأهل المحدد في Loyalty Score.</small>
            </span>
            <span className="dsv2-loyalty-toggle__status">{settings.vipAutoEnabled ? "مفعل" : "متوقف"}</span>
          </button>
  
          <label className="dsv2-field">
            <span className="dsv2-field__label">حد التأهل لـ VIP (Loyalty Score)</span>
            <input dir="ltr" lang="en"
              className="dsv2-input"
              type="number"
              value={settings.vipAutoThreshold}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  vipAutoThreshold: Number(e.target.value),
                }))
              }
            />
          </label>
        </div>
  
        <button 
            className="dsv2-btn dsv2-btn--primary dsv2-loyalty-save"
            onClick={saveSettings} 
            type="button"
            disabled={saving}
        >
          {saving ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
        </button>
      </section>
  
      {/* CLIENTS */}
      <section className="dsv2-table-card dsv2-loyalty-clients" aria-labelledby="loyalty-clients-title">
        <div className="dsv2-card--padded dsv2-loyalty-clients-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">قائمة العملاء</p>
            <h2 id="loyalty-clients-title" className="dsv2-section-title">قائمة العملاء والولاء</h2>
            <p className="dsv2-section-caption">عرض النقاط ودرجة الولاء وتحديث حالة VIP يدويًا.</p>
          </div>
          <label className="dsv2-loyalty-search">
            <FiSearch aria-hidden="true" />
            <input
              className="dsv2-input"
              placeholder="بحث باسم العميل أو رقم الجوال..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
  
        {loading ? (
          <div className="dsv2-loyalty-loading" role="status">
            <span className="dsv2-skeleton dsv2-skeleton--title" />
            <span className="dsv2-skeleton" />
            <span className="dsv2-skeleton" />
            <span className="dsv2-sr-only">جارٍ تحميل بيانات العملاء...</span>
          </div>
        ) : (
          <div className="dsv2-table-scroll">
            <table className="dsv2-table dsv2-loyalty-table">
                <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الجوال</th>
                  <th>رصيد النقاط</th>
                  <th>مستوى الولاء</th>
                  <th>آخر زيارة</th>
                  <th>الحالة VIP</th>
                </tr>
                </thead>
    
                <tbody>
                {filtered.length > 0 ? (
                    filtered.map((c) => (
                        <tr key={c.id}>
                        <td data-label="الاسم"><span className="dsv2-table__primary">{c.name || "عميل غير مسمى"}</span></td>
                        <td data-label="الجوال"><bdi dir="ltr">{c.phone || "-"}</bdi></td>
                        <td data-label="رصيد النقاط">
                            <span className="dsv2-badge dsv2-badge--gold">{formatNumber(c.loyaltyPoints || 0)} نقطة</span>
                        </td>
                        <td data-label="مستوى الولاء">
                            <span className="dsv2-badge">{formatNumber(c?.loyaltyStats?.loyaltyScore || 0)}</span>
                        </td>
                        <td data-label="آخر زيارة">{formatDate(c?.loyaltyStats?.lastCompletedAt)}</td>
                        <td data-label="الحالة VIP">
                            <button
                            className={`dsv2-btn dsv2-btn--sm ${c?.vip?.isVip ? "dsv2-btn--danger" : "dsv2-btn--success"}`}
                            onClick={() => toggleVip(c)}
                            type="button"
                            >
                            {c?.vip?.isVip ? "إلغاء VIP" : "ترقية لـ VIP"}
                            </button>
                        </td>
                        </tr>
                    ))
                ) : (
                    <tr>
                      <td colSpan={6} className="dsv2-loyalty-empty-cell">لا يوجد نتائج للبحث</td>
                    </tr>
                )}
                </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
