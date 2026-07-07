import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons";

type ScheduleSummarySectionProps = {
  isVisible: boolean;
  nowTick: number;
  summary: any;
};

function formatUpdatedTime(nowTick: number): string {
  return new Date(nowTick).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWindowLabel(label: string): string {
  const normalized = String(label || "").trim();

  if (!normalized) {
    return "مغلق اليوم";
  }

  return normalized.replace(/\s-\s/g, " → ");
}

export default function ScheduleSummarySection({
  isVisible,
  nowTick,
  summary,
}: ScheduleSummarySectionProps) {
  if (!summary || !isVisible) {
    return null;
  }

  const savedOverrideRows = Array.isArray(
    summary.savedOverrideRows
  )
    ? summary.savedOverrideRows.filter(Boolean)
    : [];

  const details = Array.isArray(summary.detailRows)
    ? summary.detailRows.filter(Boolean)
    : [];

  const overrideTimelineSummary = String(
    summary.overrideTimelineSummary || ""
  ).trim();

  const overrideTimelineFallback = String(
    summary.overrideTimelineFallback || ""
  ).trim();

  const upcomingReturn = summary?.upcomingReturn || null;

  const upcomingReturnWindow =
    upcomingReturn?.windowLabel
      ? formatWindowLabel(
          String(upcomingReturn.windowLabel)
        )
      : "";

  const finalWindowLabel = formatWindowLabel(
    summary.finalWindowLabel || "مغلق اليوم"
  );

  const isClosed =
    String(summary.operationalState || "")
      .trim()
      .toLowerCase() === "closed";

  const statusLabel = isClosed
    ? "مغلق اليوم"
    : "متاح اليوم";

  const firstOverrideTitle =
    savedOverrideRows[0]?.title ||
    savedOverrideRows[0]?.badge ||
    "لا توجد استثناءات";

  return (
    <section className="emp-modal-live-summary emp-schedule-card emp-schedule-card--refined">
      <header className="emp-schedule-hero">
        <div className="emp-schedule-hero__copy">
          <span>WORK SCHEDULE</span>

          <h4>ساعات العمل الفعلية اليوم</h4>

          <p>
            ملخص دوام الموظفة بعد تطبيق الجدول الأسبوعي
            والاستثناءات المحفوظة.
          </p>
        </div>

        <span
          className={`emp-schedule-state-badge ${
            isClosed ? "is-closed" : "is-open"
          }`}
        >
          {statusLabel}
        </span>
      </header>

      <div className="emp-schedule-kpi-grid">
        <article className="emp-schedule-kpi">
          <span className="emp-schedule-kpi__label">
            حالة اليوم
          </span>

          <strong className="emp-schedule-kpi__value">
            {statusLabel}
          </strong>

          <small className="emp-schedule-kpi__note">
            {summary?.weeklyOffToday &&
            summary?.weeklyOffTodayLabel
              ? String(summary.weeklyOffTodayLabel)
              : "حسب الجدول الفعلي"}
          </small>
        </article>

        <article className="emp-schedule-kpi emp-schedule-kpi--window">
          <span className="emp-schedule-kpi__label">
            نافذة العمل
          </span>

          <strong className="emp-schedule-kpi__value">
            {finalWindowLabel}
          </strong>

          <small className="emp-schedule-kpi__note">
            بعد تطبيق جميع الاستثناءات
          </small>
        </article>

        <article className="emp-schedule-kpi">
          <span className="emp-schedule-kpi__label">
            الاستثناءات
          </span>

          <strong className="emp-schedule-kpi__value">
            {savedOverrideRows.length}
          </strong>

          <small className="emp-schedule-kpi__note">
            {firstOverrideTitle}
          </small>
        </article>

        <article className="emp-schedule-kpi">
          <span className="emp-schedule-kpi__label">
            آخر تحديث
          </span>

          <strong className="emp-schedule-kpi__value emp-schedule-kpi__value--time">
            <FontAwesomeIcon icon={faClock} />
            {formatUpdatedTime(nowTick)}
          </strong>

          <small className="emp-schedule-kpi__note">
            تحديث تلقائي للحالة
          </small>
        </article>
      </div>

      {summary?.weeklyOffToday &&
      summary?.weeklyOffTodayLabel ? (
        <div className="emp-schedule-inline-note">
          <strong>سبب الإغلاق</strong>
          <span>
            {String(summary.weeklyOffTodayLabel)}
          </span>
        </div>
      ) : null}

      {upcomingReturn ? (
        <section className="emp-schedule-return-compact">
          <div className="emp-schedule-return-compact__head">
            <div>
              <span>العودة القادمة</span>
              <strong>
                {upcomingReturnWindow ||
                  "سيُحدد لاحقًا"}
              </strong>
            </div>

            <span className="emp-schedule-return-compact__badge">
              قادم
            </span>
          </div>

          <div className="emp-schedule-return-compact__dates">
            <div>
              <span>الميلادي</span>
              <strong>
                {upcomingReturn.gregorianDate ||
                  "غير محدد"}
              </strong>
            </div>

            <div>
              <span>الهجري</span>
              <strong>
                {upcomingReturn.hijriDate || "-"}
              </strong>
            </div>
          </div>

          <div className="emp-schedule-return-compact__meta">
            <div>
              <span>المصدر</span>
              <strong>
                {upcomingReturn.sourceLabel || "-"}
              </strong>
            </div>

            <div>
              <span>إتاحة الحجز</span>
              <strong>
                {upcomingReturn.availabilityLabel ||
                  "-"}
              </strong>
            </div>

            {upcomingReturn.leaveEndsLabel ? (
              <div>
                <span>نهاية الحالة</span>
                <strong>
                  {upcomingReturn.leaveEndsLabel}
                </strong>
              </div>
            ) : null}

            {upcomingReturn.note ? (
              <div className="is-wide">
                <span>ملاحظة</span>
                <strong>
                  {upcomingReturn.note}
                </strong>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <details className="emp-schedule-disclosure">
        <summary>
          <div className="emp-schedule-disclosure__title">
            <strong>استثناءات الدوام</strong>
            <span>
              عرض الفترات والتواريخ والأسباب المحفوظة
            </span>
          </div>

          <span className="emp-schedule-disclosure__count">
            {savedOverrideRows.length}
          </span>
        </summary>

        <div className="emp-schedule-disclosure__body">
          {overrideTimelineSummary ? (
            <div className="emp-schedule-disclosure__note">
              {overrideTimelineSummary}
            </div>
          ) : null}

          {savedOverrideRows.length ? (
            <div className="emp-schedule-exceptions-grid">
              {savedOverrideRows.map(
                (row: any, idx: number) => {
                  const tone = String(
                    row?.tone || "upcoming"
                  );

                  const hoursLabel =
                    formatWindowLabel(
                      String(row?.hoursLabel || "-")
                    );

                  const isClosedOverride =
                    String(
                      row?.hoursLabel || ""
                    ).includes("إغلاق");

                  const supportRows = [
                    row?.note
                      ? {
                          label: "السبب",
                          value: row.note,
                        }
                      : null,

                    row?.appliesToLabel
                      ? {
                          label: "ينطبق على",
                          value:
                            row.appliesToLabel,
                        }
                      : null,

                    isClosedOverride
                      ? {
                          label: "الحالة",
                          value:
                            "مغلق بالكامل خلال الفترة",
                        }
                      : null,
                  ].filter(Boolean) as Array<{
                    label: string;
                    value: string;
                  }>;

                  return (
                    <article
                      key={
                        row?.id ||
                        `saved_override_${idx}`
                      }
                      className={`emp-schedule-exception-card is-${tone}`}
                    >
                      <header>
                        <span>
                          {row?.badge || "محفوظ"}
                        </span>

                        <strong>
                          {row?.title ||
                            "استثناء محفوظ"}
                        </strong>
                      </header>

                      <div className="emp-schedule-exception-card__window">
                        {hoursLabel}
                      </div>

                      <div className="emp-schedule-exception-card__dates">
                        <div>
                          <span>الميلادي</span>
                          <strong>
                            {row?.gregorianRange ||
                              "-"}
                          </strong>
                        </div>

                        <div>
                          <span>الهجري</span>
                          <strong>
                            {row?.hijriRange || "-"}
                          </strong>
                        </div>
                      </div>

                      {supportRows.length ? (
                        <div className="emp-schedule-exception-card__support">
                          {supportRows.map(
                            (
                              supportRow,
                              supportIdx
                            ) => (
                              <div
                                key={`saved_override_${idx}_support_${supportIdx}`}
                              >
                                <span>
                                  {
                                    supportRow.label
                                  }
                                </span>

                                <strong>
                                  {
                                    supportRow.value
                                  }
                                </strong>
                              </div>
                            )
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                }
              )}
            </div>
          ) : (
            <div className="emp-schedule-disclosure__empty">
              لا توجد استثناءات دوام محفوظة حاليًا.
            </div>
          )}

          {overrideTimelineFallback ? (
            <div className="emp-schedule-disclosure__end">
              {overrideTimelineFallback}
            </div>
          ) : null}
        </div>
      </details>

      {details.length ? (
        <details className="emp-schedule-disclosure emp-schedule-disclosure--technical">
          <summary>
            <div className="emp-schedule-disclosure__title">
              <strong>تفاصيل احتساب الدوام</strong>
              <span>
                المصدر والجدول الأسبوعي والنتيجة النهائية
              </span>
            </div>

            <span className="emp-schedule-disclosure__count">
              {details.length}
            </span>
          </summary>

          <div className="emp-schedule-disclosure__body">
            <div className="emp-schedule-data-grid">
              {details.map(
                (row: any, idx: number) => {
                  const extraLines =
                    Array.isArray(row?.details)
                      ? row.details
                          .map((line: any) =>
                            String(
                              line || ""
                            ).trim()
                          )
                          .filter(Boolean)
                      : [];

                  return (
                    <article
                      className="emp-schedule-data-card"
                      key={`schedule_detail_${idx}`}
                    >
                      <span>
                        {row?.label || "تفصيل"}
                      </span>

                      <strong>
                        {formatWindowLabel(
                          String(
                            row?.value || "-"
                          )
                        )}
                      </strong>

                      {row?.note ? (
                        <p>{row.note}</p>
                      ) : null}

                      {extraLines.length ? (
                        <div>
                          {extraLines.map(
                            (
                              line: string,
                              lineIdx: number
                            ) => (
                              <small
                                key={`schedule_detail_${idx}_line_${lineIdx}`}
                              >
                                {line}
                              </small>
                            )
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                }
              )}
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}