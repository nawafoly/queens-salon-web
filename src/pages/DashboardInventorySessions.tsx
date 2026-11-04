import { useEffect, useState } from "react";
import {
  DashboardActionFeedbackV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardNumberInputV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { usePermissions } from "../security/PermissionContext";
import {
  CoreInventoryService,
  type InventoryItem,
  type InventoryLocation,
  type InventoryStocktakeSession,
  type InventoryStocktakeSessionSummary,
} from "../services/CoreInventoryService";
import { CoreApiError } from "../services/coreApiClient";

type Pair = { itemId: string; locationId: string };
type CountDraft = { qty: string; note: string };
type Feedback = { tone: "success" | "danger"; message: string } | null;

function errorMessage(error: unknown) {
  return error instanceof CoreApiError
    ? [error.code, error.message].filter(Boolean).join(" — ")
    : "تعذر تنفيذ العملية. حاول مرة أخرى.";
}

function pairKey(pair: Pair) {
  return `${pair.itemId}:\u0000:${pair.locationId}`;
}

function formatQty(qty: number) {
  return Number(qty).toLocaleString("ar-SA", { maximumFractionDigits: 4 });
}

export default function DashboardInventorySessions() {
  const { hasPermission } = usePermissions();
  const canAdjust = hasPermission("inventory.adjust");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [sessions, setSessions] = useState<InventoryStocktakeSessionSummary[]>([]);
  const [selected, setSelected] = useState<InventoryStocktakeSession | null>(null);
  const [title, setTitle] = useState("");
  const [itemId, setItemId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CountDraft>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      CoreInventoryService.listStocktakeSessions(),
      canAdjust ? CoreInventoryService.listItems({ active: "1" }) : Promise.resolve([]),
      canAdjust ? CoreInventoryService.listLocations() : Promise.resolve([]),
    ]).then(([sessionRows, itemRows, locationRows]) => {
      if (cancelled) return;
      setSessions(sessionRows || []);
      setItems((itemRows || []).filter((item) => Number(item.is_active) === 1));
      setLocations((locationRows || []).filter((location) => Number(location.active ?? 1) === 1));
    }).catch((err: unknown) => {
      if (!cancelled) setError(errorMessage(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [canAdjust]);

  function showSession(session: InventoryStocktakeSession) {
    setSelected(session);
    setDrafts(Object.fromEntries(session.lines.map((line) => [line.id, {
      qty: line.counted_qty == null ? "" : String(line.counted_qty),
      note: line.note || "",
    }])));
    setReviewReasons(Object.fromEntries(session.lines.map((line) => [line.id, line.review_reason || ""])));
    setFeedback(null);
    setError("");
  }

  async function refreshList() {
    setSessions(await CoreInventoryService.listStocktakeSessions());
  }

  function addPairs(next: Pair[]) {
    setPairs((current) => {
      const known = new Set(current.map(pairKey));
      const updated = [...current];
      for (const pair of next) {
        if (known.has(pairKey(pair)) || updated.length >= 100) continue;
        updated.push(pair);
        known.add(pairKey(pair));
      }
      return updated;
    });
    setFeedback(null);
  }

  async function createSession() {
    if (!canAdjust || !title.trim() || !pairs.length || busy) return;
    setBusy("create");
    setError("");
    setFeedback(null);
    try {
      const session = await CoreInventoryService.createStocktakeSession({ title: title.trim(), lines: pairs });
      setTitle("");
      setPairs([]);
      showSession(session);
      await refreshList();
      setFeedback({ tone: "success", message: "تم إنشاء مسودة الجرد. لم يتغير أي رصيد مخزون." });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function openSession(id: string) {
    if (busy) return;
    setBusy("open");
    setError("");
    try {
      showSession(await CoreInventoryService.getStocktakeSession(id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  function editCount(lineId: string, patch: Partial<CountDraft>) {
    setDrafts((current) => ({ ...current, [lineId]: {
      qty: current[lineId]?.qty ?? "",
      note: current[lineId]?.note ?? "",
      ...patch,
    } }));
    setFeedback(null);
  }

  async function saveCount(lineId: string) {
    if (!selected || !canAdjust || busy) return;
    const input = drafts[lineId];
    const qty = input?.qty?.trim() === "" ? NaN : Number(input?.qty);
    if (!Number.isFinite(qty) || qty < 0) return;
    setBusy(lineId);
    setError("");
    setFeedback(null);
    try {
      showSession(await CoreInventoryService.recordStocktakeSessionCount(selected.id, {
        lineId,
        countedQty: qty,
        note: input?.note?.trim() || undefined,
      }));
      setFeedback({ tone: "success", message: "تم حفظ العدد في تقرير الجرد دون تغيير المخزون." });
      await refreshList();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function submitSession() {
    if (!selected || !canAdjust || busy || selected.summary.counted_lines !== selected.summary.total_lines) return;
    setBusy("submit");
    setError("");
    setFeedback(null);
    try {
      showSession(await CoreInventoryService.submitStocktakeSession(selected.id));
      await refreshList();
      setFeedback({ tone: "success", message: "تم إقفال تقرير العدّ فقط. لم تُنشأ تسويات أو حركات مخزون." });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function resolveLine(lineId: string, decision: "APPLY" | "DISMISS") {
    if (!selected || selected.status !== "submitted" || !canAdjust || busy) return;
    const reason = reviewReasons[lineId]?.trim() || "";
    if (reason.length < 3 || reason.length > 300) return;
    setBusy(`review:${lineId}`);
    setError("");
    setFeedback(null);
    try {
      showSession(await CoreInventoryService.resolveStocktakeSessionLine(selected.id, {
        lineId, decision, reason,
      }));
      await refreshList();
      setFeedback({ tone: "success", message: decision === "APPLY"
        ? "تم اعتماد الفرق وإنشاء حركة التسوية وتحديث الرصيد في معاملة واحدة."
        : "تم إغلاق الفرق دون إنشاء حركة مخزون أو تغيير الرصيد." });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  if (loading) return <DashboardSkeletonV2 lines={5} />;

  return (
    <div className="d-grid gap-3" dir="rtl">
      <div>
        <h3 className="h6 mb-1">جلسات الجرد الدوري</h3>
        <p className="small text-muted mb-0">
          جرد عدة مواد في مواقع مختلفة، وحفظ الأعداد والفروقات للمراجعة. اعتماد التقرير لا يغيّر الرصيد؛
          أي تسوية لاحقة تتم بقرار مستقل لكل فرق مع التحقق من الرصيد الحالي وتسجيل حركة تدقيق.
        </p>
      </div>

      {error ? <DashboardErrorStateV2 title="تعذر تنفيذ عملية الجرد" description={error} /> : null}
      {feedback ? (
        <DashboardActionFeedbackV2
          compact revealOnMount tone={feedback.tone}
          title={feedback.tone === "success" ? "تمت العملية" : "تعذرت العملية"}
          description={feedback.message}
        />
      ) : null}

      {canAdjust ? (
        <section className="dsv2-card dsv2-card--padded">
          <h4 className="h6 mb-3">بدء جلسة جرد جديدة</h4>
          <DashboardFieldV2 id="periodic-title" label="عنوان محضر الجرد">
            <input id="periodic-title" className="form-control" maxLength={140} value={title}
              placeholder="مثال: جرد المخزن والصالون — نوفمبر"
              onChange={(event) => setTitle(event.target.value)} />
          </DashboardFieldV2>
          <div className="row g-2 align-items-end mb-3">
            <div className="col-12 col-md-5">
              <DashboardFieldV2 id="periodic-item" label="المادة">
                <DashboardSelectV2 id="periodic-item" value={itemId} placeholder="اختاري المادة"
                  options={items.map((item) => ({ value: item.id, label: `${item.name} (${item.unit})` }))}
                  onChange={setItemId} />
              </DashboardFieldV2>
            </div>
            <div className="col-12 col-md-4">
              <DashboardFieldV2 id="periodic-location" label="الموقع">
                <DashboardSelectV2 id="periodic-location" value={locationId} placeholder="اختاري الموقع"
                  options={locations.map((location) => ({ value: location.id, label: location.name }))}
                  onChange={setLocationId} />
              </DashboardFieldV2>
            </div>
            <div className="col-12 col-md-3 d-grid gap-1">
              <button type="button" className="btn btn-outline-dark"
                disabled={!itemId || !locationId || pairs.length >= 100}
                onClick={() => addPairs([{ itemId, locationId }])}>إضافة المادة للموقع</button>
              <button type="button" className="btn btn-link btn-sm"
                disabled={!locationId || !items.length || pairs.length >= 100}
                onClick={() => addPairs(items.map((item) => ({ itemId: item.id, locationId })))}>
                إضافة كل المواد لهذا الموقع
              </button>
            </div>
          </div>
          {pairs.length ? (
            <div className="table-responsive mb-3">
              <table className="table table-sm align-middle">
                <thead><tr><th>المادة</th><th>الموقع</th><th>إزالة</th></tr></thead>
                <tbody>
                  {pairs.map((pair) => (
                    <tr key={pairKey(pair)}>
                      <td>{items.find((item) => item.id === pair.itemId)?.name || pair.itemId}</td>
                      <td>{locations.find((location) => location.id === pair.locationId)?.name || pair.locationId}</td>
                      <td><button type="button" className="btn btn-sm btn-outline-danger"
                        aria-label="إزالة المادة من الجلسة"
                        onClick={() => setPairs((current) => current.filter((row) => pairKey(row) !== pairKey(pair)))}>
                        إزالة
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="small text-muted">اختاري مادة وموقعًا لإضافتهما. الحد الأقصى 100 بند لكل محضر.</p>}
          <button type="button" className="btn btn-dark" onClick={() => void createSession()}
            disabled={!title.trim() || !pairs.length || !!busy}>
            {busy === "create" ? "جاري الإنشاء..." : `إنشاء مسودة (${pairs.length} بند)`}
          </button>
        </section>
      ) : null}

      <section className="dsv2-card dsv2-card--padded">
        <h4 className="h6 mb-3">محاضر الجرد السابقة</h4>
        {!sessions.length ? (
          <DashboardEmptyStateV2 title="لا توجد محاضر جرد" description="أنشئي محضرًا لاختبار العدّ والمقارنة حسب الموقع." />
        ) : (
          <div className="table-responsive">
            <table className="table align-middle">
              <thead><tr><th>المحضر</th><th>الحالة</th><th>العدّ</th><th>الفروقات</th><th>المراجعة</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <th scope="row">{session.title}</th>
                    <td>{session.status === "submitted" ? "مقفل" : session.status === "draft" ? "مسودة" : "ملغي"}</td>
                    <td>{session.counted_count} / {session.line_count}</td>
                    <td>{session.variance_count}</td>
                    <td>{session.reviewed_count} / {session.variance_count}</td>
                    <td><button type="button" className="btn btn-sm btn-outline-dark"
                      disabled={!!busy} onClick={() => void openSession(session.id)}>
                      عرض
                    </button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <section className="dsv2-card dsv2-card--padded">
          <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
            <div>
              <h4 className="h6 mb-1">{selected.title}</h4>
              <p className="small text-muted mb-0">
                {selected.status === "draft" ? "مسودة قابلة للتعديل" : "تقرير عدّ مقفل"}
                {" — "}{selected.summary.counted_lines} من {selected.summary.total_lines} بند معدود
                {" — "}{selected.summary.variance_lines} بند فيه فرق
                {selected.status === "submitted" ? ` — ${selected.summary.reviewed_lines} قرار مراجعة` : ""}
              </p>
            </div>
            <button type="button" className="btn btn-outline-secondary btn-sm"
              onClick={() => { setSelected(null); setFeedback(null); }}>إغلاق التفاصيل</button>
          </div>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr><th>المادة والموقع</th><th>الرصيد المرجعي</th><th>العدد الفعلي</th><th>الفرق</th><th>سبب الفرق</th><th>الحفظ / المراجعة</th></tr>
              </thead>
              <tbody>
                {selected.lines.map((line) => {
                  const draft = drafts[line.id] || { qty: "", note: "" };
                  const qty = draft.qty.trim() === "" ? NaN : Number(draft.qty);
                  const valid = Number.isFinite(qty) && qty >= 0;
                  const variance = valid ? qty - Number(line.expected_qty) : null;
                  const reasonValid = variance === 0 || draft.note.trim().length >= 3;
                  const editable = selected.status === "draft" && canAdjust;
                  return (
                    <tr key={line.id}>
                      <th scope="row">
                        {line.item_name || line.item_id}
                        <div className="small text-muted">{line.location_name || line.location_id} · {line.item_unit}</div>
                      </th>
                      <td>{formatQty(line.expected_qty)}</td>
                      <td>
                        {editable ? (
                          <DashboardNumberInputV2 value={draft.qty} min={0}
                            aria-label={`الكمية المعدودة: ${line.item_name || line.item_id}`}
                            onChange={(event) => editCount(line.id, { qty: event.target.value })} />
                        ) : line.counted_qty === null ? "لم يُعدّ" : formatQty(line.counted_qty)}
                      </td>
                      <td className={variance === null ? "" : variance === 0 ? "text-success" : "text-danger"}>
                        {editable ? variance === null ? "—" : formatQty(variance)
                          : line.variance_qty === null ? "—" : formatQty(line.variance_qty)}
                      </td>
                      <td>
                        {editable ? (
                          <input className="form-control form-control-sm" maxLength={300}
                            aria-label={`سبب فرق الجرد: ${line.item_name || line.item_id}`}
                            placeholder={variance !== 0 ? "سبب الفرق (إلزامي)" : "ملاحظة اختيارية"}
                            value={draft.note}
                            onChange={(event) => editCount(line.id, { note: event.target.value })} />
                        ) : line.note || "—"}
                      </td>
                      <td>
                        {editable ? (
                          <button type="button" className="btn btn-sm btn-outline-dark"
                            disabled={!!busy || !valid || !reasonValid}
                            onClick={() => void saveCount(line.id)}>
                            {busy === line.id ? "حفظ..." : "حفظ العدّ"}
                          </button>
                        ) : line.review_decision ? (
                          <div className="small">
                            <span className={line.review_decision === "APPLY" ? "text-success" : "text-secondary"}>
                              {line.review_decision === "APPLY" ? "تم اعتماد التسوية" : "تم إغلاق الفرق دون تسوية"}
                            </span>
                            <div>{line.review_reason}</div>
                            {line.reviewed_by_name ? <div className="text-muted">بواسطة: {line.reviewed_by_name}</div> : null}
                            {line.review_movement_id ? <div className="text-muted">الحركة: {line.review_movement_id}</div> : null}
                          </div>
                        ) : selected.status === "submitted" && line.variance_qty !== null && line.variance_qty !== 0 ? (
                          canAdjust ? (
                            <div className="d-grid gap-2" style={{ minWidth: 200 }}>
                              <input className="form-control form-control-sm" maxLength={300}
                                aria-label={`سبب قرار تسوية: ${line.item_name || line.item_id}`}
                                placeholder="سبب قرار المراجعة (إلزامي)"
                                value={reviewReasons[line.id] || ""}
                                onChange={(event) => setReviewReasons((current) => ({ ...current, [line.id]: event.target.value }))} />
                              <button type="button" className="btn btn-sm btn-dark"
                                disabled={!!busy || (reviewReasons[line.id]?.trim().length || 0) < 3}
                                onClick={() => void resolveLine(line.id, "APPLY")}>
                                {busy === `review:${line.id}` ? "جاري التنفيذ..." : "اعتماد التسوية وتحديث الرصيد"}
                              </button>
                              <button type="button" className="btn btn-sm btn-outline-secondary"
                                disabled={!!busy || (reviewReasons[line.id]?.trim().length || 0) < 3}
                                onClick={() => void resolveLine(line.id, "DISMISS")}>إغلاق الفرق دون تسوية</button>
                            </div>
                          ) : "بانتظار مسؤول المخزون"
                        ) : "لا توجد تسوية"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected.status === "draft" && canAdjust ? (
            <div className="d-flex flex-wrap align-items-center gap-3">
              <button type="button" className="btn btn-dark"
                disabled={!!busy || selected.summary.counted_lines !== selected.summary.total_lines}
                onClick={() => void submitSession()}>
                {busy === "submit" ? "جاري الإقفال..." : "إقفال تقرير العدّ"}
              </button>
              <span className="small text-muted">
                الإقفال يحفظ المحضر فقط ولا يسجل أي تعديل مالي أو مخزني.
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
