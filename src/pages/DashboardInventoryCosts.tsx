import { useEffect, useState } from "react";
import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import {
  CoreInventoryService,
  type InventoryConsumptionCostReport,
  type InventoryCostBreakdown,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

const costSar = (halalas: number) =>
  new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(halalas || 0) / 100);

function CostBreakdown({ title, rows }: { title: string; rows: InventoryCostBreakdown[] }) {
  return (
    <section className="dsv2-card dsv2-card--padded">
      <h3 className="h6 mb-3">{title}</h3>
      {!rows.length ? (
        <DashboardEmptyStateV2 title="لا توجد بيانات" description="لم يُسجّل استهلاك في الفترة المحددة." />
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th scope="col">الاسم</th>
                <th scope="col">تأكيدات</th>
                <th scope="col">تكلفة مسجلة (ر.س)</th>
                <th scope="col">عمليات بتكلفة ناقصة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.confirmations}</td>
                  <td>{costSar(row.known_cost_halalas)}</td>
                  <td>{row.uncosted_confirmations || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function DashboardInventoryCosts() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [report, setReport] = useState<InventoryConsumptionCostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setReport(null);
    void CoreInventoryService.getConsumptionCostReport(days)
      .then((result) => { if (!cancelled) setReport(result); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof CoreApiError ? err.message : "تعذر تحميل تقرير التكلفة.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <div className="d-grid gap-3" aria-label="تقرير تكلفة استهلاك المواد">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div>
          <h3 className="h6 mb-1">تكلفة استهلاك المواد الفعلية</h3>
          <p className="text-muted small mb-0">من التأكيدات المنفذة، دون احتساب الحجوزات المستقبلية أو الاستهلاك الملغى.</p>
        </div>
        <div className="d-flex flex-wrap gap-2" role="group" aria-label="فترة التقرير">
          {([7, 30, 90] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={days === value}
              className={days === value ? "btn btn-dark btn-sm" : "btn btn-outline-dark btn-sm"}
              onClick={() => setDays(value)}
            >
              {value} يوم
            </button>
          ))}
        </div>
      </div>
      {error ? <DashboardErrorStateV2 title="تعذر تحميل تكلفة الاستهلاك" description={error} /> : null}
      {loading ? <DashboardSkeletonV2 lines={6} /> : null}
      {!loading && report ? (
        <>
          <p className="small text-muted mb-0">الفترة: {report.period.from} إلى {report.period.through} (بتوقيت السعودية)</p>
          <div className="dsv2-grid dsv2-grid--metrics">
            <article className="dsv2-metric-card dsv2-metric-card--gold">
              <p className="dsv2-metric-card__label">تكلفة مواد مسجلة (ر.س)</p>
              <strong className="dsv2-metric-card__value">{costSar(report.summary.known_cost_halalas)}</strong>
              <p className="dsv2-metric-card__meta">لا تشمل المواد التي لم تتوفر لها تكلفة</p>
            </article>
            <article className="dsv2-metric-card dsv2-metric-card--success">
              <p className="dsv2-metric-card__label">خدمات تأكد استهلاكها</p>
              <strong className="dsv2-metric-card__value">{report.summary.confirmations}</strong>
              <p className="dsv2-metric-card__meta">كل بند خدمة يُحسب مرة واحدة</p>
            </article>
            <article className="dsv2-metric-card dsv2-metric-card--danger">
              <p className="dsv2-metric-card__label">عمليات بتكلفة غير مكتملة</p>
              <strong className="dsv2-metric-card__value">{report.summary.uncosted_confirmations}</strong>
              <p className="dsv2-metric-card__meta">تحتاج تسجيل تكلفة شراء موثوقة</p>
            </article>
          </div>
          {report.summary.uncosted_confirmations > 0 ? (
            <div className="alert alert-warning mb-0" role="status">
              إجمالي التكلفة المسجلة ليس التكلفة النهائية؛ توجد عمليات تشمل مواد بلا تكلفة معتمدة.
            </div>
          ) : null}
          <div className="d-grid gap-3">
            <CostBreakdown title="التكلفة حسب الخدمة" rows={report.by_service} />
            <CostBreakdown title="التكلفة حسب الموظفة" rows={report.by_employee} />
          </div>
        </>
      ) : null}
    </div>
  );
}
