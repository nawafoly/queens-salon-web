import { useEffect, useMemo, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import {
  CoreInventoryService,
  type InventoryLocation,
  type InventoryStaffLocation,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

function errorMessage(error: unknown) {
  return error instanceof CoreApiError ? error.message : "تعذر تحميل أو حفظ مواقع الموظفات.";
}

export default function DashboardInventoryStaffLocations() {
  const [staff, setStaff] = useState<InventoryStaffLocation[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<"success" | "danger" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      CoreInventoryService.listStaffHomeLocations(),
      CoreInventoryService.listLocations(),
    ]).then(([staffRows, locationRows]) => {
      if (cancelled) return;
      const available = (Array.isArray(locationRows) ? locationRows : []) as InventoryLocation[];
      setStaff(staffRows || []);
      setLocations(available.filter((row) => Number(row.active ?? 1) === 1));
    }).catch((err: unknown) => {
      if (!cancelled) setError(errorMessage(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const selected = staff.find((row) => row.employee_id === employeeId);
  const filtered = useMemo(
    () => staff.filter((row) => row.employee_name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
    [staff, search]
  );

  async function save() {
    if (!employeeId || !locationId || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await CoreInventoryService.setStaffHomeLocation({ employeeId, locationId });
      const name = locations.find((row) => row.id === locationId)?.name || null;
      setStaff((current) => current.map((row) => row.employee_id === employeeId
        ? { ...row, location_id: locationId, location_name: name }
        : row));
      setFeedback("success");
    } catch (err) {
      setError(errorMessage(err));
      setFeedback("danger");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={6} />;
  if (error && !feedback) return <DashboardErrorStateV2 title="تعذر تحميل مواقع الموظفات" description={error} />;

  return (
    <div className="d-grid gap-3">
      <div>
        <h3 className="h6 mb-1">مواقع مخزون الموظفات</h3>
        <p className="small text-muted mb-0">
          عند تأكيد استهلاك خدمة، يخصم Core من موقع الموظفة المحدد هنا. بدون تعيين صريح يستخدم الموقع الافتراضي للمخزون.
        </p>
      </div>
      <section className="dsv2-card dsv2-card--padded">
        <DashboardFieldV2 id="inv-staff-location-staff" label="الموظفة">
          <DashboardSelectV2
            id="inv-staff-location-staff"
            value={employeeId}
            placeholder="اختاري موظفة"
            options={staff.map((row) => ({ value: row.employee_id, label: row.employee_name }))}
            onChange={(id) => {
              setEmployeeId(id);
              setLocationId(staff.find((row) => row.employee_id === id)?.location_id || "");
              setFeedback(null);
              setError("");
            }}
          />
        </DashboardFieldV2>
        <DashboardFieldV2 id="inv-staff-location-target" label="موقع المخزون">
          <DashboardSelectV2
            id="inv-staff-location-target"
            value={locationId}
            placeholder="اختاري موقعًا نشطًا"
            options={locations.map((row) => ({ value: row.id, label: row.name }))}
            onChange={(id) => { setLocationId(id); setFeedback(null); setError(""); }}
          />
        </DashboardFieldV2>
        {selected ? (
          <p className="small text-muted">
            التعيين الحالي: {selected.location_name || "تلقائي (لا يوجد تعيين صريح)"}
          </p>
        ) : null}
        {feedback ? (
          <DashboardActionFeedbackV2
            compact revealOnMount tone={feedback === "success" ? "success" : "danger"}
            title={feedback === "success" ? "تم حفظ الموقع" : "تعذر حفظ الموقع"}
            description={feedback === "success" ? "التعيين الجديد سيُستخدم للاستهلاكات القادمة فقط؛ لا يغير الحركات السابقة." : error}
          />
        ) : null}
        <button
          type="button" className="btn btn-dark"
          disabled={saving || !selected || !locationId || selected.location_id === locationId}
          onClick={() => void save()}
        >
          {saving ? "جاري الحفظ..." : "حفظ موقع الموظفة"}
        </button>
      </section>
      <section className="dsv2-card dsv2-card--padded">
        <h3 className="h6 mb-3">التعيينات الحالية</h3>
        <input
          className="form-control mb-3" aria-label="بحث بالموظفة"
          placeholder="بحث باسم الموظفة" value={search} onChange={(event) => setSearch(event.target.value)}
        />
        {!filtered.length ? (
          <DashboardEmptyStateV2 title="لا توجد موظفات" description="لا توجد نتائج مطابقة للبحث." />
        ) : (
          <div className="table-responsive">
            <table className="table align-middle">
              <thead><tr><th scope="col">الموظفة</th><th scope="col">موقع المخزون</th></tr></thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.employee_id}>
                    <th scope="row">{row.employee_name}</th>
                    <td>{row.location_name || "تلقائي"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
