import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faPen, faRotateRight, faSave, faTag } from "@fortawesome/free-solid-svg-icons";
import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
  DashboardTimePickerV2,
} from "../components/dashboard-v2";
import { translateBookingCatalogLabel } from "../helpers/dashboardBookingsLanguage";
import type { DashboardLanguage } from "../helpers/dashboardLanguage";
import "../styles/dashboard-v2/service-promos.css";
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

const text = {
  ar: {
    title: "أسعار العروض",
    kicker: "Service Promo Price",
    subtitle: "سعر ترويجي للخدمة نفسها أثناء فترة محددة، بدون باقة وبدون كوبون وبدون سطر خصم منفصل.",
    refresh: "تحديث",
    services: "الخدمات",
    activeNow: "نشطة الآن",
    records: "السجل",
    activeServicesHint: "خدمات نشطة من الكتالوج",
    activePromosHint: "أسعار ترويجية ضمن الفترة",
    recordsHint: "كل السجلات الترويجية",
    editTitle: "تعديل سعر عرض",
    createTitle: "إنشاء سعر عرض",
    editorHint: "اختاري الخدمة وحددي السعر الترويجي والفترة. سعر الكتالوج الأصلي يبقى محفوظا كما هو.",
    cancelEdit: "إلغاء التعديل",
    service: "الخدمة",
    chooseService: "اختاري خدمة",
    promoPrice: "سعر العرض",
    catalogPrice: "سعر الكتالوج",
    startsAt: "البداية",
    endsAt: "النهاية",
    note: "ملاحظة",
    optional: "اختياري",
    save: "حفظ",
    saving: "جاري الحفظ",
    currentPrices: "الخدمات والأسعار الحالية",
    currentPromoPrice: "سعر العرض الحالي",
    period: "الفترة",
    status: "الحالة",
    action: "إجراء",
    durationMinute: "دقيقة",
    noPromo: "لا يوجد",
    originalPrice: "السعر الأصلي",
    active: "نشط",
    withoutPromo: "بدون عرض",
    edit: "تعديل",
    deactivate: "إيقاف",
    create: "إنشاء",
    noServicesTitle: "لا توجد خدمات",
    noServicesDescription: "أضيفي الخدمات في الكتالوج أولا، ثم ارجعي لتحديد أسعار العروض.",
    requiredMessage: "أكمل الخدمة وسعر العرض وفترة العرض.",
    invalidDateMessage: "تأكد من أن تاريخ النهاية بعد تاريخ البداية.",
    loadError: "تعذر تحميل أسعار العروض.",
    saveError: "تعذر حفظ سعر العرض.",
    deactivateError: "تعذر إيقاف سعر العرض.",
    saved: "تم حفظ سعر العرض.",
    deactivated: "تم إيقاف سعر العرض.",
    bookingApplied: "عند الحجز سيظهر سعر العرض كسعر الخدمة النهائي خلال الفترة.",
    linkedServices: "الخدمات مرتبطة مباشرة بكتالوج Core.",
    sar: "ر.س",
  },
  en: {
    title: "Promo Prices",
    kicker: "Service Promo Price",
    subtitle: "A temporary service sale price. It is not a package, coupon, or separate discount line.",
    refresh: "Refresh",
    services: "Services",
    activeNow: "Active now",
    records: "Records",
    activeServicesHint: "Active catalog services",
    activePromosHint: "Promo prices inside their date range",
    recordsHint: "All promo price records",
    editTitle: "Edit promo price",
    createTitle: "Create promo price",
    editorHint: "Choose a service, promo price, and date range. The original catalog price stays unchanged.",
    cancelEdit: "Cancel edit",
    service: "Service",
    chooseService: "Choose service",
    promoPrice: "Promo price",
    catalogPrice: "Catalog price",
    startsAt: "Starts at",
    endsAt: "Ends at",
    note: "Note",
    optional: "Optional",
    save: "Save",
    saving: "Saving",
    currentPrices: "Services and current prices",
    currentPromoPrice: "Current promo price",
    period: "Period",
    status: "Status",
    action: "Action",
    durationMinute: "min",
    noPromo: "None",
    originalPrice: "Original price",
    active: "Active",
    withoutPromo: "No promo",
    edit: "Edit",
    deactivate: "Deactivate",
    create: "Create",
    noServicesTitle: "No services",
    noServicesDescription: "Add services in the catalog first, then come back to set promo prices.",
    requiredMessage: "Complete the service, promo price, and date range.",
    invalidDateMessage: "Make sure the end date is after the start date.",
    loadError: "Could not load promo prices.",
    saveError: "Could not save the promo price.",
    deactivateError: "Could not deactivate the promo price.",
    saved: "Promo price saved.",
    deactivated: "Promo price deactivated.",
    bookingApplied: "During the promo period, booking uses this as the final service price.",
    linkedServices: "Services are linked directly to the Core catalog.",
    sar: "SAR",
  },
} satisfies Record<DashboardLanguage, Record<string, string>>;

function halalasToRiyal(value: unknown) {
  return (Number(value || 0) / 100).toFixed(2);
}

function formatMoney(value: unknown, language: DashboardLanguage) {
  return `${halalasToRiyal(value)} ${text[language].sar}`;
}

function serviceDisplayName(service: CoreService, language: DashboardLanguage) {
  return translateBookingCatalogLabel(language, service.name, "service");
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

function splitLocalDateTime(value: string) {
  const [datePart = "", timePart = ""] = String(value || "").split("T");
  return { date: datePart.slice(0, 10), time: timePart.slice(0, 5) };
}

function joinLocalDateTime(date: string, time: string) {
  if (!date) return "";
  return date + "T" + (time || "00:00");
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

export default function DashboardServicePromoPrices({
  language = "ar",
}: {
  language?: DashboardLanguage;
}) {
  const t = text[language];
  const dir = language === "en" ? "ltr" : "rtl";
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
    const [promoResult, serviceResult] = await Promise.allSettled([
      CoreServicePromoPriceService.list(),
      CoreCatalogService.listServices({ activeOnly: true }),
    ]);

    if (serviceResult.status === "fulfilled") {
      setServices(serviceResult.value || []);
    } else {
      setServices([]);
      setMessage(serviceResult.reason instanceof Error ? serviceResult.reason.message : t.loadError);
    }

    if (promoResult.status === "fulfilled") {
      setPromos(promoResult.value || []);
    } else {
      setPromos([]);
      setMessage(promoResult.reason instanceof Error ? promoResult.reason.message : t.loadError);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setMessage(t.requiredMessage);
      return;
    }
    const promoPriceHalalas = riyalInputToHalalas(form.promoRiyal);
    const startsAt = isoFromLocalInput(form.startsAt);
    const endsAt = isoFromLocalInput(form.endsAt);
    if (!startsAt || !endsAt || Date.parse(endsAt) < Date.parse(startsAt)) {
      setMessage(t.invalidDateMessage);
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
      setMessage(t.saved);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.saveError);
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
      setMessage(t.deactivated);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.deactivateError);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = activePromoByService.size;
  const selectedCatalogPrice = selectedService ? serviceCatalogPrice(selectedService) : 0;

  return (
    <section className="dsv2-service-promos-page" dir={dir} lang={language}>
      <header className="service-promos-header">
        <div className="service-promos-head-main">
          <span className="service-promos-kicker">{t.kicker}</span>
          <h1><FontAwesomeIcon icon={faTag} />{t.title}</h1>
          <p className="service-promos-sub">{t.subtitle}</p>
          <p className="service-promos-sub">{t.linkedServices} {t.bookingApplied}</p>
        </div>
        <div className="service-promos-actions">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void load()} disabled={loading || saving}>
            <FontAwesomeIcon icon={faRotateRight} spin={loading} />
            {t.refresh}
          </button>
        </div>
      </header>

      {message ? <p className="service-promos-notice">{message}</p> : null}

      <div className="service-promos-metrics">
        <article><span>{t.services}</span><strong>{services.length}</strong><small>{t.activeServicesHint}</small></article>
        <article><span>{t.activeNow}</span><strong>{activeCount}</strong><small>{t.activePromosHint}</small></article>
        <article><span>{t.records}</span><strong>{promos.length}</strong><small>{t.recordsHint}</small></article>
      </div>

      <section className="service-promos-editor">
        <div className="service-promos-editor__head">
          <div>
            <h2>{form.id ? t.editTitle : t.createTitle}</h2>
            <p>{t.editorHint}</p>
          </div>
          {form.id ? (
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setForm(emptyForm)} disabled={saving}>
              {t.cancelEdit}
            </button>
          ) : null}
        </div>

        <div className="service-promos-form">
          <DashboardFieldV2 id="service-promo-service" label={t.service} required>
            <DashboardSelectV2
              id="service-promo-service"
              value={form.serviceId}
              placeholder={t.chooseService}
              options={services.map((service) => ({
                value: service.id,
                label: `${serviceDisplayName(service, language)} - ${formatMoney(serviceCatalogPrice(service), language)}`,
              }))}
              onChange={(serviceId) => setForm((current) => ({ ...current, serviceId }))}
              disabled={saving}
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="service-promo-price"
            label={t.promoPrice}
            hint={selectedService ? `${t.catalogPrice}: ${formatMoney(selectedCatalogPrice, language)}` : undefined}
            required
          >
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

          <DashboardFieldV2 id="service-promo-starts" label={t.startsAt} required>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(110px, 0.8fr)", gap: 8 }}>
              <DashboardDatePickerV2
                id="service-promo-starts"
                language={language}
                value={splitLocalDateTime(form.startsAt).date}
                onChange={(date) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: joinLocalDateTime(date, splitLocalDateTime(current.startsAt).time || "09:00"),
                  }))
                }
                disabled={saving}
              />
              <DashboardTimePickerV2
                id="service-promo-starts-time"
                value={splitLocalDateTime(form.startsAt).time}
                onChange={(time) =>
                  setForm((current) => ({
                    ...current,
                    startsAt: joinLocalDateTime(splitLocalDateTime(current.startsAt).date, time),
                  }))
                }
                disabled={saving}
                clock="24h"
              />
            </div>
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-ends" label={t.endsAt} required>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(110px, 0.8fr)", gap: 8 }}>
              <DashboardDatePickerV2
                id="service-promo-ends"
                language={language}
                value={splitLocalDateTime(form.endsAt).date}
                onChange={(date) =>
                  setForm((current) => ({
                    ...current,
                    endsAt: joinLocalDateTime(date, splitLocalDateTime(current.endsAt).time || "22:00"),
                  }))
                }
                disabled={saving}
              />
              <DashboardTimePickerV2
                id="service-promo-ends-time"
                value={splitLocalDateTime(form.endsAt).time}
                onChange={(time) =>
                  setForm((current) => ({
                    ...current,
                    endsAt: joinLocalDateTime(splitLocalDateTime(current.endsAt).date, time),
                  }))
                }
                disabled={saving}
                clock="24h"
              />
            </div>
          </DashboardFieldV2>

          <DashboardFieldV2 id="service-promo-note" label={t.note} className="service-promos-field--wide">
            <input id="service-promo-note" className="dsv2-input" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={t.optional} disabled={saving} />
          </DashboardFieldV2>

          <div className="service-promos-form__actions">
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void save()} disabled={saving || loading}>
              <FontAwesomeIcon icon={faSave} />
              {saving ? t.saving : t.save}
            </button>
          </div>
        </div>
      </section>

      <section className="service-promos-table-shell">
        <div className="service-promos-section-head">
          <h2>{t.currentPrices}</h2>
          <span>{services.length}</span>
        </div>
        {loading ? (
          <div className="service-promos-skeleton">
            <DashboardSkeletonV2 />
            <DashboardSkeletonV2 />
            <DashboardSkeletonV2 />
          </div>
        ) : services.length ? (
          <div className="service-promos-results"><div className="service-promos-table-wrap">
            <table className="service-promos-table">
              <thead>
                <tr>
                  <th>{t.service}</th>
                  <th>{t.catalogPrice}</th>
                  <th>{t.currentPromoPrice}</th>
                  <th>{t.period}</th>
                  <th>{t.status}</th>
                  <th>{t.action}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => {
                  const activePromo = activePromoByService.get(service.id);
                  return (
                    <tr key={service.id}>
                      <td><strong>{serviceDisplayName(service, language)}</strong><small>{service.durationMinutes || 0} {t.durationMinute}</small></td>
                      <td>{formatMoney(serviceCatalogPrice(service), language)}</td>
                      <td>{activePromo ? <b>{formatMoney(activePromo.promo_price_halalas, language)}</b> : <span className="service-promos-muted">{t.noPromo}</span>}</td>
                      <td>{activePromo ? <span>{localDateTimeValue(activePromo.starts_at)} - {localDateTimeValue(activePromo.ends_at)}</span> : <span className="service-promos-muted">{t.originalPrice}</span>}</td>
                      <td><span className={`service-promos-status ${activePromo ? "is-active" : ""}`}>{activePromo ? t.active : t.withoutPromo}</span></td>
                      <td>
                        <div className="service-promos-row-actions">
                          {activePromo ? (
                            <>
                              <button type="button" className="dsv2-icon-btn" title={t.edit} aria-label={t.edit} onClick={() => editPromo(activePromo)} disabled={saving}>
                                <FontAwesomeIcon icon={faPen} />
                              </button>
                              <button type="button" className="dsv2-icon-btn service-promos-stop" title={t.deactivate} aria-label={t.deactivate} onClick={() => void deactivate(activePromo.id)} disabled={saving}>
                                <FontAwesomeIcon icon={faBan} />
                              </button>
                            </>
                          ) : (
                            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setForm((current) => ({ ...emptyForm, serviceId: service.id, startsAt: current.startsAt, endsAt: current.endsAt }))} disabled={saving}>
                              {t.create}
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
          <div className="service-promos-list">
            {services.map((service) => {
              const activePromo = activePromoByService.get(service.id);
              return (
                <article key={"card-" + service.id} className="service-promos-card">
                  <div className="service-promos-card__top">
                    <div>
                      <strong>{serviceDisplayName(service, language)}</strong>
                      <small>{service.durationMinutes || 0} {t.durationMinute}</small>
                    </div>
                    <span className={`service-promos-status ${activePromo ? "is-active" : ""}`}>
                      {activePromo ? t.active : t.withoutPromo}
                    </span>
                  </div>
                  <div className="service-promos-card__meta">
                    <div>
                      <span>{t.catalogPrice}</span>
                      <em>{formatMoney(serviceCatalogPrice(service), language)}</em>
                    </div>
                    <div>
                      <span>{t.currentPromoPrice}</span>
                      {activePromo ? <b>{formatMoney(activePromo.promo_price_halalas, language)}</b> : <em>{t.noPromo}</em>}
                    </div>
                    <div className="service-promos-card__period">
                      {activePromo ? `${localDateTimeValue(activePromo.starts_at)} — ${localDateTimeValue(activePromo.ends_at)}` : t.originalPrice}
                    </div>
                  </div>
                  <div className="service-promos-row-actions">
                    {activePromo ? (
                      <>
                        <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editPromo(activePromo)} disabled={saving}>{t.edit}</button>
                        <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void deactivate(activePromo.id)} disabled={saving}>{t.deactivate}</button>
                      </>
                    ) : (
                      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setForm((current) => ({ ...emptyForm, serviceId: service.id, startsAt: current.startsAt, endsAt: current.endsAt }))} disabled={saving}>{t.create}</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          </div>
        ) : (
          <DashboardEmptyStateV2 title={t.noServicesTitle} description={t.noServicesDescription} />
        )}
      </section>
    </section>
  );
}
