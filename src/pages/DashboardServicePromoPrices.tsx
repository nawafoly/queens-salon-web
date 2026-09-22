import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faPen, faRotateRight, faSave, faTag } from "@fortawesome/free-solid-svg-icons";
import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { CoreCatalogService } from "../services/CoreCatalogService";
import {
  CoreServicePromoPriceService,
  type ServicePromoPrice,
} from "../services/CoreServicePromoPriceService";
import type { CoreService } from "../types/coreApi";

type PromoForm = {
  id: string;
  serviceId: string;
  promoRiyal: string;
  startsAt: string;
  endsAt: string;
  note: string;
};

const emptyForm: PromoForm = {
  id: "",
  serviceId: "",
  promoRiyal: "",
  startsAt: "",
  endsAt: "",
  note: "",
};

function halalasToRiyal(value: unknown) {
  return (Number(value || 0) / 100).toFixed(2);
}

function riyalInputToHalalas(value: string) {
  const amount = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function localDateTimeValue(value: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoFromLocalInput(value: string) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function promoIsCurrent(row?: ServicePromoPrice | null) {
  if (!row || Number(row.is_active) !== 1) return false;
  const now = Date.now();
  return Date.parse(row.starts_at) <= now && Date.parse(row.ends_at) >= now;
}

function serviceCatalogPrice(service: CoreService) {
  return Number(service.catalogPriceHalalas ?? service.priceHalalas ?? 0);
}

export default function DashboardServicePromoPrices() {
  const [promos, setPromos] = useState<ServicePromoPrice[]>([]);
  const [services, setServices] = useState<CoreService[]>([]);
  const [form, setForm] = useState<PromoForm>(emptyForm);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activePromoByService = useMemo(() => {
    const map = new Map<string, ServicePromoPrice>();
    for (const promo of promos) {
      if (promoIsCurrent(promo) && !map.has(promo.service_id)) {
        map.set(promo.service_id, promo);
      }
    }
    return map;
  }, [promos]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === form.serviceId) || null,
    [form.serviceId, services]
  );

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const [promoRows, serviceRows] = await Promise.all([
        CoreServicePromoPriceService.list(),
        CoreCatalogService.listServices({ activeOnly: true }),
      ]);
      setPromos(promoRows || []);
      setServices(serviceRows || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحميل أسعار العروض.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function editPromo(row: ServicePromoPrice) {
    setForm({
      id: row.id,
      serviceId: row.service_id,
      promoRiyal: halalasToRiyal(row.promo_price_halalas),
      startsAt: localDateTimeValue(row.starts_at),
      endsAt: localDateTimeValue(row.ends_at),
      note: row.note || "",
    });
    setMessage("");
  }

  async function save() {
    setMessage("");
    if (!form.serviceId || !form.promoRiyal || !form.startsAt || !form.endsAt) {
      setMessage("أكمل الخدمة وسعر العرض وفترة العرض.");
      return;
    }
    const promoPriceHalalas = riyalInputToHalalas(form.promoRiyal);
    const startsAt = isoFromLocalInput(form.startsAt);
    const endsAt = isoFromLocalInput(form.endsAt);
    if (!startsAt || !endsAt || Date.parse(endsAt) < Date.parse(startsAt)) {
      setMessage("تأكد من أن تاريخ النهاية بعد تاريخ البداية.");
      return;
    }
    setSaving(true);
    try {
      await CoreServicePromoPriceService.create({
        id: form.id || undefined,
        serviceId: form.serviceId,
        promoPriceHalalas,
        startsAt,
        endsAt,
        note: form.note.trim() || undefined,
      });
      setForm(emptyForm);
      setMessage("تم حفظ سعر العرض.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ سعر العرض.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    setSaving(true);
    setMessage("");
    try {
      await CoreServicePromoPriceService.deactivate(id);
      if (form.id === id) setForm(emptyForm);
      setMessage("تم إيقاف سعر العرض.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إيقاف سعر العرض.");
    } finally {
      setSaving(false);
    }
  }

  const activeCount = activePromoByService.size;
  const selectedCatalogPrice = selectedService ? serviceCatalogPrice(selectedService) : 0;

  return (
    <section className="dsv2-service-promos-page" dir="rtl">
      <header className="service-promos-header">
        <div className="service-promos-head-main">
          <span className="service-promos-kicker">Service Promo Price</span>
          <h1><FontAwesomeIcon icon={faTag} />أسعار العروض</h1>
          <p className="service-promos-sub">
            سعر ترويجي للخدمة نفسها أثناء فترة محددة، بدون باقة وبدون كوبون وبدون سطر خصم منفصل.
          </p>
        </div>
        <div className="service-promos-actions">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void load()} disabled={loading || saving}>
            <FontAwesomeIcon icon={faRotateRight} spin={loading} />
            تحديث
          </button>
        </div>
      </header>

      {message ? <p className="service-promos-notice">{message}</p> : null}

      <div className="service-promos-metrics">
        <article><span>الخدمات</span><strong>{services.length}</strong><small>خدمات نشطة من الكتالوج</small></article>
        <article><span>نشطة الآن</span><strong>{activeCount}</strong><small>أسعار ترويجية ضمن الفترة</small></article>
        <article><span>السجل</span><strong>{promos.length}</strong><small>كل السجلات الترويجية</small></article>
      </div>

      <section className="service-promos-editor">
        <div className="service-promos-editor__head">
          <div>
            <h2>{form.id ? "تعديل سعر عرض" : "إنشاء سعر عرض"}</h2>
            <p>اختاري الخدمة وحددي السعر الترويجي والفترة. سعر الكتالوج الأصلي يبقى محفوظاً كما هو.</p>
          </div>
          {form.id ? (
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setForm(emptyForm)} disabled={saving}>
              إلغاء التعديل
            </button>
          ) : null}
        </div>

        <div className="service-promos-form">
          <DashboardFieldV2 id="service-promo-service" label="الخدمة" required>
            <DashboardSelectV2
              id="service-promo-service"
              value={form.serviceId}
              placeholder="اختاري خدمة"
              options={services.map((service) => ({
                value: service.id,
                label: `${service.name} - ${halalasToRiyal(serviceCatalogPrice(service))} ر.س`,
              }))}
              onChange={(serviceId) => setForm((current) => ({ ...current, serviceId }))}
              disabled={saving}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-price" label="سعر العرض" hint={selectedService ? `سعر الكتالوج: ${halalasToRiyal(selectedCatalogPrice)} ر.س` : undefined} required>
            <input
              id="service-promo-price"
              className="dsv2-input"
              inputMode="decimal"
              value={form.promoRiyal}
              onChange={(event) => setForm((current) => ({ ...current, promoRiyal: event.target.value.replace(/[^0-9.]/g, "") }))}
              placeholder="0.00"
              disabled={saving}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-starts" label="البداية" required>
            <input id="service-promo-starts" className="dsv2-input" type="text" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} placeholder="2026-09-22T09:00" disabled={saving} />
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-ends" label="النهاية" required>
            <input id="service-promo-ends" className="dsv2-input" type="text" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} placeholder="2026-09-30T22:00" disabled={saving} />
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-note" label="ملاحظة" className="service-promos-field--wide">
            <input id="service-promo-note" className="dsv2-input" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="اختياري" disabled={saving} />
          </DashboardFieldV2>

          <div className="service-promos-form__actions">
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void save()} disabled={saving || loading}>
              <FontAwesomeIcon icon={faSave} />
              {saving ? "جار الحفظ" : "حفظ"}
            </button>
          </div>
        </div>
      </section>

      <section className="service-promos-table-shell">
        <div className="service-promos-section-head">
          <h2>الخدمات والأسعار الحالية</h2>
          <span>{services.length}</span>
        </div>
        {loading ? (
          <div className="service-promos-skeleton">
            <DashboardSkeletonV2 />
            <DashboardSkeletonV2 />
            <DashboardSkeletonV2 />
          </div>
        ) : services.length ? (
          <div className="service-promos-table-wrap">
            <table className="service-promos-table">
              <thead>
                <tr>
                  <th>الخدمة</th>
                  <th>سعر الكتالوج</th>
                  <th>سعر العرض الحالي</th>
                  <th>الفترة</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => {
                  const activePromo = activePromoByService.get(service.id);
                  return (
                    <tr key={service.id}>
                      <td><strong>{service.name}</strong><small>{service.durationMinutes || 0} دقيقة</small></td>
                      <td>{halalasToRiyal(serviceCatalogPrice(service))} ر.س</td>
                      <td>{activePromo ? <b>{halalasToRiyal(activePromo.promo_price_halalas)} ر.س</b> : <span className="service-promos-muted">لا يوجد</span>}</td>
                      <td>{activePromo ? <span>{localDateTimeValue(activePromo.starts_at)} - {localDateTimeValue(activePromo.ends_at)}</span> : <span className="service-promos-muted">السعر الأصلي</span>}</td>
                      <td><span className={`service-promos-status ${activePromo ? "is-active" : ""}`}>{activePromo ? "نشط" : "بدون عرض"}</span></td>
                      <td>
                        <div className="service-promos-row-actions">
                          {activePromo ? (
                            <>
                              <button type="button" className="dsv2-icon-btn" title="تعديل" aria-label="تعديل" onClick={() => editPromo(activePromo)} disabled={saving}>
                                <FontAwesomeIcon icon={faPen} />
                              </button>
                              <button type="button" className="dsv2-icon-btn service-promos-stop" title="إيقاف" aria-label="إيقاف" onClick={() => void deactivate(activePromo.id)} disabled={saving}>
                                <FontAwesomeIcon icon={faBan} />
                              </button>
                            </>
                          ) : (
                            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setForm((current) => ({ ...emptyForm, serviceId: service.id, startsAt: current.startsAt, endsAt: current.endsAt }))} disabled={saving}>
                              إنشاء
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <DashboardEmptyStateV2 title="لا توجد خدمات" description="أضيفي الخدمات في الكتالوج أولاً، ثم ارجعي لتحديد أسعار العروض." />
        )}
      </section>
    </section>
  );
}
