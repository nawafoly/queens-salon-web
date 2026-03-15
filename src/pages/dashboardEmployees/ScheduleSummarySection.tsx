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
  if (!normalized) return "مغلق اليوم";
  return normalized.replace(/\s-\s/g, " → ");
}

export default function ScheduleSummarySection({
  isVisible,
  nowTick,
  summary,
}: ScheduleSummarySectionProps) {
  if (!summary || !isVisible) return null;

  const savedOverrideRows = Array.isArray(summary.savedOverrideRows)
    ? summary.savedOverrideRows.filter(Boolean)
    : [];
  const details = Array.isArray(summary.detailRows) ? summary.detailRows.filter(Boolean) : [];
  const overrideTimelineSummary = String(summary.overrideTimelineSummary || "").trim();
  const overrideTimelineFallback = String(summary.overrideTimelineFallback || "").trim();
  const upcomingReturn = summary?.upcomingReturn || null;
  const upcomingReturnWindow = upcomingReturn?.windowLabel
    ? formatWindowLabel(String(upcomingReturn.windowLabel))
    : "";
  const finalWindowLabel = formatWindowLabel(summary.finalWindowLabel || "مغلق اليوم");

  return (
    <section className="emp-modal-live-summary emp-schedule-card emp-schedule-card-timeline-only">
      <div className="emp-schedule-section-header">
        <h4 className="emp-schedule-section-title">ساعات العمل الفعلية اليوم</h4>
      </div>

      <div className={`emp-schedule-result ${summary.operationalState === "closed" ? "is-closed" : ""}`}>
        <div className="emp-schedule-result-window">{finalWindowLabel}</div>
      </div>

      {upcomingReturn ? (
        <section className="emp-schedule-return-card">
          <div className="emp-schedule-return-head">
            <div className="emp-schedule-return-title">العودة القادمة</div>
            {upcomingReturn.leaveEndsLabel ? (
              <div className="emp-schedule-return-caption">
                تنتهي الحالة الحالية في {upcomingReturn.leaveEndsLabel}
              </div>
            ) : null}
          </div>

          <div className="emp-schedule-return-dates">
            <strong className="emp-schedule-return-date-primary">
              {upcomingReturn.gregorianDate || "غير محدد حتى الآن"}
            </strong>
            <div className="emp-schedule-return-date-secondary">{upcomingReturn.hijriDate || ""}</div>
          </div>

          <div className="emp-schedule-return-window">{upcomingReturnWindow || "سيُحدد لاحقًا"}</div>

          <div className="emp-schedule-return-support">
            <div className="emp-schedule-return-support-row">
              <span className="emp-schedule-return-support-label">المصدر</span>
              <strong className="emp-schedule-return-support-value">
                {upcomingReturn.sourceLabel || "-"}
              </strong>
            </div>
            <div className="emp-schedule-return-support-row">
              <span className="emp-schedule-return-support-label">إتاحة الحجز</span>
              <strong className="emp-schedule-return-support-value">
                {upcomingReturn.availabilityLabel || "-"}
              </strong>
            </div>
            {upcomingReturn.note ? (
              <div className="emp-schedule-return-support-row">
                <span className="emp-schedule-return-support-label">ملاحظة</span>
                <strong className="emp-schedule-return-support-value">{upcomingReturn.note}</strong>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="emp-schedule-card-foot is-compact">
        <span className="emp-schedule-card-updated">
          <FontAwesomeIcon icon={faClock} />
          آخر تحديث: {formatUpdatedTime(nowTick)}
        </span>
      </div>

      <section className="emp-schedule-overrides-panel">
        <div className="emp-schedule-overrides-head">
          <div className="emp-schedule-overrides-title">الجدول الزمني لاستثناءات الدوام</div>
          <div className="emp-schedule-overrides-subtitle">
            المرجع الكامل لجميع فترات الاستثناء المحفوظة بترتيب زمني واضح
          </div>
        </div>

        {overrideTimelineSummary ? (
          <div className="emp-schedule-overrides-summary">{overrideTimelineSummary}</div>
        ) : null}

        {savedOverrideRows.length ? (
          <div className="emp-schedule-timeline-list">
            {savedOverrideRows.map((row: any, idx: number) => {
              const hoursLabel = formatWindowLabel(String(row?.hoursLabel || "-"));
              const isClosedOverride = String(row?.hoursLabel || "").includes("إغلاق");
              const supportRows = [
                row?.note ? { label: "السبب", value: row.note } : null,
                row?.appliesToLabel ? { label: "ينطبق على", value: row.appliesToLabel } : null,
                isClosedOverride ? { label: "الإغلاق", value: "مغلق بالكامل خلال هذه الفترة" } : null,
              ].filter(Boolean) as Array<{ label: string; value: string }>;

              return (
                <div
                  className={`emp-schedule-timeline-item is-${String(row?.tone || "upcoming")}`}
                  key={row?.id || `saved_override_${idx}`}
                >
                  <div className={`emp-schedule-timeline-marker is-${String(row?.tone || "upcoming")}`} />

                  <div className={`emp-schedule-override-card is-${String(row?.tone || "upcoming")}`}>
                    <div className="emp-schedule-override-headline">
                      <span className={`emp-schedule-override-badge is-${String(row?.tone || "upcoming")}`}>
                        {row?.badge || "محفوظ"}
                      </span>
                      <div className="emp-schedule-override-title">{row?.title || "استثناء محفوظ"}</div>
                    </div>

                    <div className="emp-schedule-override-main">
                      <div className="emp-schedule-override-hero">{hoursLabel}</div>

                      <div className="emp-schedule-override-dates">
                        <div className="emp-schedule-override-date-block">
                          <span className="emp-schedule-override-date-label">الميلادي</span>
                          <strong className="emp-schedule-override-date-value">
                            {row?.gregorianRange || "-"}
                          </strong>
                        </div>
                        <div className="emp-schedule-override-date-block">
                          <span className="emp-schedule-override-date-label">الهجري</span>
                          <strong className="emp-schedule-override-date-value">
                            {row?.hijriRange || "-"}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {supportRows.length ? (
                      <div className="emp-schedule-override-support">
                        {supportRows.map((supportRow, supportIdx) => (
                          <div
                            className="emp-schedule-override-support-row"
                            key={`saved_override_${idx}_support_${supportIdx}`}
                          >
                            <span className="emp-schedule-override-support-label">{supportRow.label}</span>
                            <strong className="emp-schedule-override-support-value">{supportRow.value}</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="emp-schedule-overrides-empty">لا توجد استثناءات دوام محفوظة حالياً.</div>
        )}

        {overrideTimelineFallback ? (
          <div className="emp-schedule-overrides-endstate">{overrideTimelineFallback}</div>
        ) : null}
      </section>

      <details className="emp-schedule-details">
        <summary>التفصيل</summary>
        <div className="emp-schedule-details-grid">
          {details.map((row: any, idx: number) => {
            const extraLines = Array.isArray(row?.details)
              ? row.details
                  .map((line: any) => String(line || "").trim())
                  .filter(Boolean)
              : [];

            return (
              <div className="emp-schedule-detail-card" key={`schedule_detail_${idx}`}>
                <div className="emp-schedule-detail-label">{row?.label || "تفصيل"}</div>
                <div className="emp-schedule-detail-value">{formatWindowLabel(String(row?.value || "-"))}</div>
                {row?.note ? <div className="emp-schedule-detail-note">{row.note}</div> : null}
                {extraLines.length ? (
                  <div className="emp-schedule-detail-lines">
                    {extraLines.map((line: string, lineIdx: number) => (
                      <div className="emp-schedule-detail-line" key={`schedule_detail_${idx}_line_${lineIdx}`}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
