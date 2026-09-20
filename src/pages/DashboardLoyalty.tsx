/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FiAward,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiStar,
  FiTrendingUp,
  FiUsers,
} from "react-icons/fi";

import { CoreClientService, type CoreClientLoyaltySummary } from "../services/CoreClientService";
import type { CoreClient } from "../types/coreApi";
import { loyaltyText, type DashboardLanguage } from "../helpers/dashboardLoyaltyLanguage";

function formatDate(value: string | null | undefined, language: DashboardLanguage) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatNumber(value: number, language: DashboardLanguage, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export default function DashboardLoyalty({ language = "ar" }: { language?: DashboardLanguage }) {
  const t = (arabic: string) => loyaltyText(language, arabic);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<CoreClient[]>([]);
  const [summary, setSummary] = useState<CoreClientLoyaltySummary>({
    totalClients: 0,
    vipCount: 0,
    activeLoyaltyCount: 0,
    totalPoints: 0,
  });
  const [search, setSearch] = useState("");
  const [busyClientId, setBusyClientId] = useState("");
  const loadGenerationRef = useRef(0);
  const summaryGenerationRef = useRef(0);
  const searchRef = useRef("");
  const searchEffectReadyRef = useRef(false);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const summaryGeneration = ++summaryGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const [rows, nextSummary] = await Promise.all([
        CoreClientService.list(searchRef.current.trim(), { includeLoyalty: true }),
        CoreClientService.loyaltySummary(),
      ]);
      if (generation === loadGenerationRef.current) {
        setClients(rows);
      }
      if (summaryGeneration === summaryGenerationRef.current) {
        setSummary(nextSummary);
      }
    } catch (cause) {
      if (generation !== loadGenerationRef.current) return;
      setError(language === "en" ? t("تعذر تحميل بيانات الولاء من Core D1.") : cause instanceof Error ? cause.message : t("تعذر تحميل بيانات الولاء من Core D1."));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
      summaryGenerationRef.current += 1;
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

      const summaryGeneration = ++summaryGenerationRef.current;
      try {
        const nextSummary = await CoreClientService.loyaltySummary();
        if (summaryGeneration === summaryGenerationRef.current) {
          setSummary(nextSummary);
        }
      } catch (summaryCause) {
        if (summaryGeneration !== summaryGenerationRef.current) return;
        setError(
          language === "en"
            ? t("تم تحديث حالة VIP في Core D1، لكن تعذر تحديث ملخص الولاء.")
            : summaryCause instanceof Error
              ? `تم تحديث حالة VIP في Core D1، لكن تعذر تحديث الملخص: ${summaryCause.message}`
              : t("تم تحديث حالة VIP في Core D1، لكن تعذر تحديث ملخص الولاء.")
        );
      }
    } catch (cause) {
      setError(language === "en" ? t("تعذر تحديث حالة VIP في Core D1.") : cause instanceof Error ? cause.message : t("تعذر تحديث حالة VIP في Core D1."));
    } finally {
      setBusyClientId("");
    }
  };

  useEffect(() => {
    if (!searchEffectReadyRef.current) {
      searchEffectReadyRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      const generation = ++loadGenerationRef.current;
      setLoading(true);
      setError("");

      void CoreClientService.list(search.trim(), { includeLoyalty: true })
        .then((rows) => {
          if (generation !== loadGenerationRef.current) return;
          setClients(rows);
        })
        .catch((cause) => {
          if (generation !== loadGenerationRef.current) return;
          setError(
            language === "en"
              ? t("تعذر البحث في بيانات الولاء من Core D1.")
              : cause instanceof Error
                ? cause.message
                : t("تعذر البحث في بيانات الولاء من Core D1.")
          );
        })
        .finally(() => {
          if (generation === loadGenerationRef.current) {
            setLoading(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [search, language]);





  return (
    <main className="dsv2-page dsv2-loyalty-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <header className="dsv2-page-head dsv2-loyalty-page-head">
        <div>
          <p className="dsv2-loyalty-eyebrow">Customer Retention</p>
          <h1 className="dsv2-page-title">{t("برنامج الولاء والعملاء المميزون")}</h1>
          <p className="dsv2-page-subtitle">
            {t("رصيد النقاط وحالة VIP هنا من Core D1 فقط؛ لا توجد نسخة تشغيلية موازية في Firestore.")}
          </p>
        </div>

        <div className="dsv2-card dsv2-card--padded dsv2-loyalty-summary">
          <span className="dsv2-loyalty-summary__icon" aria-hidden="true"><FiAward /></span>
          <div>
            <span>{t("إجمالي العملاء")}</span>
            <strong>{formatNumber(summary.totalClients, language)}</strong>
            <small>{formatNumber(clients.length, language)} {t("نتيجة محملة — حد العرض 500")}</small>
          </div>
        </div>
      </header>

      {error ? <div className="dsv2-error-state" role="alert">{error}</div> : null}

      <section className="dsv2-grid--metrics dsv2-loyalty-metrics" aria-label={t("ملخص الولاء")}>
        <article className="dsv2-metric-card dsv2-metric-card--gold dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiUsers /></span>
          <div>
            <p className="dsv2-metric-card__label">{t("إجمالي العملاء")}</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(summary.totalClients, language)}</p>
            <p className="dsv2-metric-card__meta">{t("من سجل العملاء Canonical")}</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiStar /></span>
          <div>
            <p className="dsv2-metric-card__label">{t("عملاء VIP")}</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(summary.vipCount, language)}</p>
            <p className="dsv2-metric-card__meta">{t("حالة VIP في Core D1")}</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiTrendingUp /></span>
          <div>
            <p className="dsv2-metric-card__label">{t("لديهم رصيد نقاط")}</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(summary.activeLoyaltyCount, language)}</p>
            <p className="dsv2-metric-card__meta">{t("رصيد موجب محسوب من المصدر التشغيلي Canonical في Core D1")}</p>
          </div>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger dsv2-loyalty-metric">
          <span className="dsv2-metric-card__icon"><FiAward /></span>
          <div>
            <p className="dsv2-metric-card__label">{t("إجمالي رصيد النقاط")}</p>
            <p className="dsv2-metric-card__value">{loading ? <span className="dsv2-skeleton dsv2-loyalty-skeleton-value" /> : formatNumber(summary.totalPoints, language)}</p>
            <p className="dsv2-metric-card__meta">{t("محسوب من الحجوزات والاستردادات المكتملة والتعديلات اليدوية في Core D1")}</p>
          </div>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded dsv2-loyalty-settings" aria-label={t("مصدر بيانات الولاء")}>
        <div className="dsv2-section-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">{t("مصدر الحقيقة")}</p>
            <h2 className="dsv2-section-title">{t("سياسة الولاء التشغيلية")}</h2>
            <p className="dsv2-section-caption">
              {t("هذه الشاشة لم تعد تحفظ إعدادات ولاء محلية أو في Firestore. أي تغيير في سياسة احتساب النقاط يجب أن يمر عبر Core حتى يطبّق على الداشبورد وبوابة العميلة بنفس القاعدة.")}
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
          {t("تحديث من Core D1")}
        </button>
      </section>

      <section className="dsv2-table-card dsv2-loyalty-clients" aria-labelledby="loyalty-clients-title">
        <div className="dsv2-card--padded dsv2-loyalty-clients-head">
          <div>
            <p className="dsv2-loyalty-eyebrow">{t("قائمة العملاء")}</p>
            <h2 id="loyalty-clients-title" className="dsv2-section-title">{t("قائمة العملاء والولاء")}</h2>
            <p className="dsv2-section-caption">{t("عرض الرصيد والحركات المجمعة من Core وتحديث VIP على السجل Canonical.")}</p>
          </div>
          <label className="dsv2-loyalty-search">
            <FiSearch aria-hidden="true" />
            <input
              className="dsv2-input"
              placeholder={t("بحث باسم العميل أو رقم الجوال...")}
              value={search}
              onChange={(event) => {
                const value = event.target.value;
                searchRef.current = value;
                setSearch(value);
              }}
            />
          </label>
        </div>

        {loading ? (
          <div className="dsv2-loyalty-loading" role="status">
            <span className="dsv2-skeleton dsv2-skeleton--title" />
            <span className="dsv2-skeleton" />
            <span className="dsv2-skeleton" />
            <span className="dsv2-sr-only">{t("جارٍ تحميل بيانات العملاء...")}</span>
          </div>
        ) : (
          <div className="dsv2-table-scroll">
            <table className="dsv2-table dsv2-loyalty-table">
              <thead>
                <tr>
                  <th>{t("الاسم")}</th>
                  <th>{t("الجوال")}</th>
                  <th>{t("الرصيد")}</th>
                  <th>{t("مكتسبة")}</th>
                  <th>{t("مستخدمة / معكوسة")}</th>
                  <th>{t("آخر زيارة مكتملة")}</th>
                  <th>VIP</th>
                </tr>
              </thead>
              <tbody>
                {clients.length ? (
                  clients.map((client) => (
                    <tr key={client.id}>
                      <td data-label={t("الاسم")}><span className="dsv2-table__primary">{client.name || t("عميل غير مسمى")}</span></td>
                      <td data-label={t("الجوال")}><bdi dir="ltr">{client.phoneNormalized || "-"}</bdi></td>
                      <td data-label={t("الرصيد")}><span className="dsv2-badge dsv2-badge--gold">{formatNumber(Number(client.loyaltyBalance || 0), language)} {t("نقطة")}</span></td>
                      <td data-label={t("مكتسبة")}>{formatNumber(Number(client.loyaltyEarned || 0), language)}</td>
                      <td data-label={t("مستخدمة / معكوسة")}>{formatNumber(Number(client.loyaltyUsed || 0), language)} / {formatNumber(Number(client.loyaltyReversed || 0), language)}</td>
                      <td data-label={t("آخر زيارة مكتملة")}>{formatDate(client.lastCompletedAt, language)}</td>
                      <td data-label="VIP">
                        <button
                          className={`dsv2-btn dsv2-btn--sm ${client.vip ? "dsv2-btn--danger" : "dsv2-btn--success"}`}
                          onClick={() => void toggleVip(client)}
                          type="button"
                          disabled={Boolean(busyClientId)}
                        >
                          {busyClientId === client.id
                            ? t("جارٍ الحفظ...")
                            : client.vip
                              ? t("إلغاء VIP")
                              : t("ترقية لـ VIP")}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="dsv2-loyalty-empty-cell">{t("لا توجد نتائج للبحث")}</td>
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
