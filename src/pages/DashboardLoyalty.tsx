/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import "../styles/DashboardLoyalty.css";

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
    return d.toLocaleDateString("ar-SA", {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
  } catch {
    return "-";
  }
}

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

  /* =========================
     UI
  ========================= */

  return (
    <div className="loyalty-page">
      {/* SETTINGS */}
      <div className="dashboard-card">
        <h3>
          <span style={{ fontSize: '1.5rem' }}>⚙️</span>
          إعدادات برنامج الولاء
        </h3>
  
        <div className="dash-grid">
          <div>
            <label>وضع احتساب النقاط</label>
            <select
              value={settings.pointsMode}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  pointsMode: e.target.value as any,
                }))
              }
            >
              <option value="service">حسب الخدمة (زيارة واحدة = نقطة)</option>
              <option value="amount">حسب المبلغ المدفوع</option>
            </select>
          </div>
  
          {settings.pointsMode === "amount" && (
            <div>
              <label>قيمة النقطة (كل كم ريال = نقطة)</label>
              <input
                type="number"
                value={settings.amountPointsStep}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    amountPointsStep: Number(e.target.value),
                  }))
                }
              />
            </div>
          )}
  
          <div>
            <label>فترة تقييم الولاء (بالأيام)</label>
            <input
              type="number"
              value={settings.loyaltyWindowDays}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  loyaltyWindowDays: Number(e.target.value),
                }))
              }
            />
          </div>
  
          <div className="checkbox-container">
            <label>تفعيل VIP تلقائي</label>
            <input
              type="checkbox"
              checked={settings.vipAutoEnabled}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  vipAutoEnabled: e.target.checked,
                }))
              }
            />
          </div>
  
          <div>
            <label>حد التأهل لـ VIP (Loyalty Score)</label>
            <input
              type="number"
              value={settings.vipAutoThreshold}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  vipAutoThreshold: Number(e.target.value),
                }))
              }
            />
          </div>
        </div>
  
        <button 
            className="dash-btn-primary" 
            onClick={saveSettings} 
            type="button"
            disabled={saving}
        >
          {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
        </button>
      </div>
  
      {/* CLIENTS */}
      <div className="dashboard-card">
        <h3>
            <span style={{ fontSize: '1.5rem' }}>👥</span>
            قائمة العملاء والولاء
        </h3>
  
        <div className="search-box">
            <input
              placeholder="بحث باسم العميل أو رقم الجوال..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
        </div>
  
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#777' }}>
              <div className="loader">جاري تحميل بيانات العملاء...</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="dash-table">
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
                        <td data-label="الاسم">{c.name || "عميل غير مسمى"}</td>
                        <td data-label="الجوال">{c.phone || "-"}</td>
                        <td data-label="رصيد النقاط">
                            <span className="points-badge">{c.loyaltyPoints || 0} نقطة</span>
                        </td>
                        <td data-label="مستوى الولاء">
                            <span className="score-badge">{c?.loyaltyStats?.loyaltyScore || 0}</span>
                        </td>
                        <td data-label="آخر زيارة">{formatDate(c?.loyaltyStats?.lastCompletedAt)}</td>
                        <td data-label="الحالة VIP">
                            <button
                            className={c?.vip?.isVip ? "dash-btn-danger" : "dash-btn"}
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
                        <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: '#999' }}>
                            لا يوجد نتائج للبحث
                        </td>
                    </tr>
                )}
                </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
