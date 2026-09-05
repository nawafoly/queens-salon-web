/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAward,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiStar,
  FiTrendingUp,
  FiUsers,
} from "react-icons/fi";

import { CoreClientService } from "../services/CoreClientService";
import type { CoreClient } from "../types/coreApi";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export default function DashboardLoyalty() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<CoreClient[]>([]);
  const [search, setSearch] = useState("");
  const [busyClientId, setBusyClientId] = useState("");
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const rows = await CoreClientService.list("", { includeLoyalty: true });
      if (generation !== loadGenerationRef.current) return;
      setClients(rows);
    } catch (cause) {
      if (generation !== loadGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : "تعذر تحميل بيانات الولاء من Core D1.");
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    let inFlight = false;
    const refreshWhenActive = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshWhenActive();
    };

    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const toggleVip = async (client: CoreClient) => {
    if (busyClientId) return;
    const nextVip = !Boolean(client.vip);
    setBusyClientId(client.id);
    setError("");
    try {
      const updated = await CoreClientService.patch(client.id, { vip: nextVip });
      setClients((current) =>
        current.map((row) =>
          row.id === client.id
            ? {
                ...row,
                ...updated,
                loyaltyBalance: row.loyaltyBalance,
                loyaltyEarned: row.loyaltyEarned,
                loyaltyUsed: row.loyaltyUsed,
                loyaltyReversed: row.loyaltyReversed,
                lastCompletedAt: row.lastCompletedAt,
              }
            : row
        )
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحديث حالة VIP في Core D1.");
    } finally {
      setBusyClientId("");
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) =>
      `${client.name || ""} ${client.phoneNormalized || ""}`
        .toLowerCase()
        .includes(query)
    );
  }, [clients, search]);

  const vipCount = useMemo(
    () => clients.filter((client) => Boolean(client.vip)).length,
    [clients]
  );

  const totalPoints = useMemo(
    () =>
      clients.reduce(
        (sum, client) => sum + Number(client.loyaltyBalance || 0),
        0
      ),
    [clients]
  );

  const activeLoyaltyCount = useMemo(
    () => clients.filter((client) => Number(client.loyaltyBalance || 0) > 0).length,
    [clients]
  );

  return (
    <main className="dsv2-page dsv2-loyalty-page" dir="rtl">
      <header className="dsv2-page-head dsv2-loyalty-page-head">
        <div>
          <p className="dsv2-loyalty-eyebrow">Customer Retention</p>
          <h1 className="dsv2-page-title">برنامج الولاء والعملاء المميزون</h1>
          <p className="dsv2-page-subtitle">
            رصيد النقاط وحالة VIP هنا من Core D1 فقط؛ لا توجد نسخة تشغيلية موازية في Firestore.
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

      {error ? <div className="dsv2-error-state" role="alert">{error}</div> : null}

      <section className="dsv2-grid--metrics dsv2-loyalty-metrics" aria-label="ملخص الولاء">
        <article className="dsv2-metric-card dsv2-metric-card--gold dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiUsers /></span>
          <div>
            <p className="dsv2-metric-card__label">إجمالي العملاء</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(clients.length)}</p>
            <p className="dsv2-metric-card__meta">من سجل العملاء Canonical</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiStar /></span>
          <div>
            <p className="dsv2-metric-card__label">عملاء VIP</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(vipCount)}</p>
            <p className="dsv2-metric-card__meta">حالة VIP في Core D1</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiTrendingUp /></span>
          <div>
            <p className="dsv2-metric-card__label">لديهم رصيد نقاط</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(activeLoyaltyCount)}</p>
            <p className="dsv2-metric-card__meta">رصيد موجب في سجل حركات الولاء</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiAward /></span>
          <div>
            <p className="dsv2-metric-card__label">إجمالي رصيد النقاط</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(totalPoints)}</p>
            <p className="dsv2-metric-card__meta">محسوب من loyalty_point_transactions</p>
          </div>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded dsv2-loyalty-settings" aria-label="مصدر بيانات الولاء">
        <div className="dsv2-section-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">مصدر الحقيقة</p>
            <h2 className="dsv2-section-title">سياسة الولاء التشغيلية</h2>
            <p className="dsv2-section-caption">
              هذه الشاشة لم تعد تحفظ إعدادات ولاء محلية أو في Firestore. أي تغيير في سياسة احتساب النقاط يجب أن يمر عبر Core حتى يطبّق على الداشبورد وبوابة العميلة بنفس القاعدة.
            </p>
          </div>
          <span className="dsv2-loyalty-panel-icon" aria-hidden="true"><FiShield /></span>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary dsv2-loyalty-save"
          onClick={() => void load()}
          disabled={loading}
        >
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث من Core D1
        </button>
      </section>

      <section className="dsv2-table-card dsv2-loyalty-clients" aria-labelledby="loyalty-clients-title">
        <div className="dsv2-card--padded dsv2-loyalty-clients-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">قائمة العملاء</p>
            <h2 id="loyalty-clients-title" className="dsv2-section-title">قائمة العملاء والولاء</h2>
            <p className="dsv2-section-caption">عرض الرصيد والحركات المجمعة من Core وتحديث VIP على السجل Canonical.</p>
          </div>
          <label className="dsv2-loyalty-search">
            <FiSearch aria-hidden="true" />
            <input
              className="dsv2-input"
              placeholder="بحث باسم العميل أو رقم الجوال..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
                  <th>الرصيد</th>
                  <th>مكتسبة</th>
                  <th>مستخدمة / معكوسة</th>
                  <th>آخر زيارة مكتملة</th>
                  <th>VIP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? (
                  filtered.map((client) => (
                    <tr key={client.id}>
                      <td data-label="الاسم"><span className="dsv2-table__primary">{client.name || "عميل غير مسمى"}</span></td>
                      <td data-label="الجوال"><bdi dir="ltr">{client.phoneNormalized || "-"}</bdi></td>
                      <td data-label="الرصيد"><span className="dsv2-badge dsv2-badge--gold">{formatNumber(Number(client.loyaltyBalance || 0))} نقطة</span></td>
                      <td data-label="مكتسبة">{formatNumber(Number(client.loyaltyEarned || 0))}</td>
                      <td data-label="مستخدمة / معكوسة">{formatNumber(Number(client.loyaltyUsed || 0))} / {formatNumber(Number(client.loyaltyReversed || 0))}</td>
                      <td data-label="آخر زيارة مكتملة">{formatDate(client.lastCompletedAt)}</td>
                      <td data-label="VIP">
                        <button
                          className={`dsv2-btn dsv2-btn--sm ${client.vip ? "dsv2-btn--danger" : "dsv2-btn--success"}`}
                          onClick={() => void toggleVip(client)}
                          type="button"
                          disabled={Boolean(busyClientId)}
                        >
                          {busyClientId === client.id
                            ? "جارٍ الحفظ..."
                            : client.vip
                              ? "إلغاء VIP"
                              : "ترقية لـ VIP"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="dsv2-loyalty-empty-cell">لا توجد نتائج للبحث</td>
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
