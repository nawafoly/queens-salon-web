import { useEffect, useRef, useState } from "react";
import {
  CoreHrService,
  type CoreAttendancePolicyState,
} from "../../services/CoreHrService";
import { useEmployeeLanguage } from "./employeeLanguage";

type Props = {
  employeeId: string;
  canManage: boolean;
};

export default function AttendancePolicySection(props: Props) {
  return (
    <AttendancePolicyEditor
      key={props.employeeId}
      {...props}
    />
  );
}

function AttendancePolicyEditor({
  employeeId,
  canManage,
}: Props) {
  const { tr } = useEmployeeLanguage();

  const [state, setState] =
    useState<CoreAttendancePolicyState | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [adoptLegacy, setAdoptLegacy] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [endingDate, setEndingDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setState(null);
    setError("");

    CoreHrService.getAttendancePolicy(employeeId)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            String(err?.message || err)
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId, refresh]);

  const legacyExempt =
    state?.authority === "legacy" &&
    state.legacyMode === "exempt";

  const blocked =
    !canManage ||
    loading ||
    saving ||
    !state;

  const run = async (
    action: () => Promise<unknown>
  ) => {
    if (blocked || pending.current) return;

    pending.current = true;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await action();

      window.dispatchEvent(
        new CustomEvent(
          "malikat:attendance-policy-changed",
          { detail: { employeeId } }
        )
      );

      if (!mounted.current) return;

      setFrom("");
      setTo("");
      setReason("");
      setAdoptLegacy(false);
      setEditingId("");
      setEndingDate("");
      setCancelReason("");

      setNotice(
        tr(
          "تم حفظ سياسة الحضور بنجاح.",
          "Attendance policy saved successfully."
        )
      );

      setRefresh((value) => value + 1);

    } catch (err) {
      if (mounted.current) {
        setError(
          String(
            (err as Error)?.message || err
          )
        );
      }
    } finally {
      pending.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  const create = () => {
    if (blocked) return;

    if (
      !from ||
      !reason.trim() ||
      (to && to < from) ||
      (legacyExempt && !adoptLegacy)
    ) {
      setError(
        tr(
          "حدد التواريخ والسبب وأكد نقل الإعفاء القديم عند الحاجة.",
          "Specify valid dates, a reason and legacy adoption when required."
        )
      );

      return;
    }

    if (
      !window.confirm(
        tr(
          "سيطبق الإعفاء على الفترة المحددة بما فيها الأيام السابقة. هل تريد المتابعة؟",
          "Apply the exemption to the selected period, including historical dates?"
        )
      )
    ) return;

    void run(() =>
      CoreHrService.createAttendancePolicy(
        employeeId,
        {
          mode: "exempt",
          effectiveFrom: from,
          effectiveTo: to || null,
          reason: reason.trim(),
          confirmLegacyAdoption: adoptLegacy,
        }
      )
    );
  };

  return (
    <section className="dsv2-card dsv2-card--padded">
      <div className="dsv2-stack dsv2-stack--sm">

        <h3 className="dsv2-section-title">
          {tr(
            "سياسة الحضور والإعفاء من البصمة",
            "Attendance and fingerprint exemption"
          )}
        </h3>

        <p className="dsv2-section-caption">
          {tr(
            "إدارة الإعفاء حسب التاريخ دون حذف البصمات أو سجلات الغياب الأصلية.",
            "Manage dated exemptions without deleting original attendance or absence records."
          )}
        </p>

        {loading && (
          <p>{tr("جاري التحميل...", "Loading...")}</p>
        )}

        {error && (
          <div
            role="alert"
            className="dsv2-badge dsv2-badge--danger"
          >
            {error}
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="dsv2-badge dsv2-badge--success"
          >
            {notice}
          </div>
        )}

        <button
          type="button"
          className="dsv2-btn dsv2-btn--sm"
          disabled={loading || saving}
          onClick={() => setRefresh(v => v + 1)}
        >
          {tr("تحديث السياسة", "Refresh policy")}
        </button>

        {legacyExempt && (
          <div role="alert">
            <p>
              {tr(
                "الموظف لديه إعفاء قديم غير محدد بتاريخ.",
                "This employee has an undated legacy exemption."
              )}
            </p>

            <p>{state?.legacyReason}</p>

            {canManage && (
              <label>
                <input
                  type="checkbox"
                  checked={adoptLegacy}
                  disabled={blocked}
                  onChange={e =>
                    setAdoptLegacy(e.target.checked)
                  }
                />

                {tr(
                  "أوافق على اعتماد الفترات المحددة وإعادة إلزام البصمة خارجها.",
                  "Adopt dated periods and require attendance outside them."
                )}
              </label>
            )}
          </div>
        )}

        {canManage && state && (
          <fieldset disabled={blocked}>
            <legend>
              {tr("إضافة فترة إعفاء", "Add exemption period")}
            </legend>

            <div className="dsv2-stack dsv2-stack--sm">

              <label>
                {tr("تاريخ بداية الإعفاء", "Start date")}
                <input
                  type="date"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
              </label>

              <label>
                {tr(
                  "آخر يوم إعفاء (اختياري)",
                  "Last exempt day (optional)"
                )}

                <input
                  type="date"
                  min={from || undefined}
                  value={to}
                  onChange={e => setTo(e.target.value)}
                />
              </label>

              {!to && (
                <small>
                  {tr(
                    "الإعفاء مستمر حتى تحديد تاريخ نهايته.",
                    "Exemption remains open until an end date is set."
                  )}
                </small>
              )}

              <label>
                {tr("سبب الإعفاء", "Exemption reason")}
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>

              <button
                type="button"
                className="dsv2-btn"
                disabled={blocked}
                onClick={create}
              >
                {tr("اعتماد الإعفاء", "Save exemption")}
              </button>
            </div>
          </fieldset>
        )}

        <h4>{tr("سجل الفترات", "Policy history")}</h4>

        {state && !state.periods.length && (
          <p>
            {tr(
              "لا توجد فترات إعفاء محددة بالتاريخ.",
              "No dated policy periods."
            )}
          </p>
        )}

        {state?.periods.map(period => (
          <article
            key={period.id}
            className="dsv2-card dsv2-card--padded"
          >
            <div className="dsv2-stack dsv2-stack--sm">

              <strong
                style={{
                  color:
                    period.policy_mode === "exempt" &&
                    period.status === "active"
                      ? "#8b5cf6"
                      : undefined,
                }}
              >
                {period.status === "cancelled"
                  ? tr("ملغى", "Cancelled")
                  : period.policy_mode === "exempt"
                    ? tr("معفى من البصمة", "Exempt")
                    : tr("إلزامي بالبصمة", "Required")}
              </strong>

              <span>
                {period.effective_from}
                {" — "}
                {period.effective_to ||
                  tr("مفتوح", "Open-ended")}
              </span>

              <span>{period.reason}</span>

              {canManage &&
                period.status === "active" &&
                period.policy_mode === "exempt" && (
                  <>
                    <button
                      type="button"
                      className="dsv2-btn dsv2-btn--sm"
                      disabled={blocked}
                      onClick={() => {
                        setEditingId(period.id);
                        setEndingDate(
                          period.effective_to || ""
                        );
                        setCancelReason("");
                      }}
                    >
                      {tr("إدارة الفترة", "Manage period")}
                    </button>

                    {editingId === period.id && (
                      <fieldset disabled={blocked}>
                        <div className="dsv2-stack dsv2-stack--sm">

                          <label>
                            {tr(
                              "آخر يوم للإعفاء",
                              "Last exempt day"
                            )}
                            <input
                              type="date"
                              min={period.effective_from}
                              value={endingDate}
                              onChange={e =>
                                setEndingDate(e.target.value)
                              }
                            />
                          </label>

                          <button
                            type="button"
                            className="dsv2-btn"
                            disabled={
                              blocked ||
                              !endingDate ||
                              endingDate < period.effective_from ||
                              Boolean(
                                period.effective_to &&
                                endingDate > period.effective_to
                              )
                            }
                            onClick={() => {
                              if (
                                !window.confirm(
                                  tr(
                                    "ستصبح البصمة إلزامية بعد آخر يوم للإعفاء ما لم توجد فترة أخرى. متابعة؟",
                                    "Attendance becomes required after this date unless another policy applies. Continue?"
                                  )
                                )
                              ) return;

                              void run(() =>
                                CoreHrService.updateAttendancePolicy(
                                  employeeId,
                                  period.id,
                                  {
                                    version: period.version,
                                    effectiveTo: endingDate,
                                  }
                                )
                              );
                            }}
                          >
                            {tr(
                              "إنهاء الإعفاء",
                              "End exemption"
                            )}
                          </button>

                          <label>
                            {tr(
                              "سبب الإلغاء بأثر رجعي",
                              "Retroactive cancellation reason"
                            )}

                            <textarea
                              value={cancelReason}
                              onChange={e =>
                                setCancelReason(e.target.value)
                              }
                            />
                          </label>

                          <button
                            type="button"
                            className="dsv2-btn dsv2-btn--danger"
                            disabled={
                              blocked ||
                              !cancelReason.trim()
                            }
                            onClick={() => {
                              if (
                                !window.confirm(
                                  tr(
                                    "إلغاء كامل الفترة بأثر رجعي وإعادة تطبيق سياسة الحضور على أيامها؟",
                                    "Cancel the entire period retroactively and restore attendance rules?"
                                  )
                                )
                              ) return;

                              void run(() =>
                                CoreHrService.cancelAttendancePolicy(
                                  employeeId,
                                  period.id,
                                  {
                                    version: period.version,
                                    reason: cancelReason.trim(),
                                  }
                                )
                              );
                            }}
                          >
                            {tr(
                              "إلغاء الإعفاء بأثر رجعي",
                              "Cancel exemption retroactively"
                            )}
                          </button>

                          <button
                            type="button"
                            className="dsv2-btn"
                            onClick={() => setEditingId("")}
                          >
                            {tr("إغلاق", "Close")}
                          </button>
                        </div>
                      </fieldset>
                    )}
                  </>
                )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
