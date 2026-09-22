import { useEffect, useState } from "react";
import { CoreServicePromoPriceService, type ServicePromoPrice } from "../services/CoreServicePromoPriceService";
import { coreApiRequest } from "../services/coreApiClient";

type ServiceRow = { id: string; name: string; price_halalas: number };

function riyal(halalas: number) {
  return (Number(halalas || 0) / 100).toFixed(2);
}

export default function DashboardServicePromoPrices() {
  const [rows, setRows] = useState<ServicePromoPrice[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [promoRiyal, setPromoRiyal] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const [promoRows, serviceRows] = await Promise.all([
      CoreServicePromoPriceService.list(),
      coreApiRequest<ServiceRow[]>("/api/core/services", { query: { active: "1" } }),
    ]);
    setRows(promoRows || []);
    setServices(serviceRows || []);
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    setMsg("");
    if (!serviceId || !promoRiyal || !startsAt || !endsAt) {
      setMsg("أكمل الخدمة وسعر العرض والفترة.");
      return;
    }
    setLoading(true);
    try {
      await CoreServicePromoPriceService.create({
        serviceId,
        promoPriceHalalas: Math.round(Number(promoRiyal) * 100),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setMsg("تم حفظ السعر الترويجي.");
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "تعذر الحفظ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dash-card" dir="rtl">
      <h2 className="h5 mb-1">أسعار العروض</h2>
      <p className="text-muted">هذا سعر الخدمة أثناء فترة العرض. ليس باقة وليس كوبون.</p>
      {msg ? <p>{msg}</p> : null}
      <div className="d-flex flex-wrap gap-2 mb-3">
        <select className="form-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">اختر خدمة</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {riyal(s.price_halalas)} ر.س</option>
          ))}
        </select>
        <input className="form-control" placeholder="سعر العرض بالريال" value={promoRiyal} onChange={(e) => setPromoRiyal(e.target.value)} />
        <input className="form-control" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        <input className="form-control" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        <button type="button" className="btn btn-dark" disabled={loading} onClick={() => void save()}>حفظ</button>
      </div>
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              <th>الخدمة</th>
              <th>قبل</th>
              <th>سعر العرض</th>
              <th>من</th>
              <th>إلى</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.service_name || row.service_id}</td>
                <td>{riyal(row.catalog_price_halalas)}</td>
                <td>{riyal(row.promo_price_halalas)}</td>
                <td>{row.starts_at}</td>
                <td>{row.ends_at}</td>
                <td>{Number(row.is_active) === 1 ? "نشط" : "واقف"}</td>
                <td>
                  {Number(row.is_active) === 1 ? (
                    <button type="button" className="btn btn-outline-dark btn-sm" onClick={() => void CoreServicePromoPriceService.deactivate(row.id).then(load)}>إيقاف</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
