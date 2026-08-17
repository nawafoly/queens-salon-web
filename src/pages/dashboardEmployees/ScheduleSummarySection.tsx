import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";

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
  return normalized ? normalized.replace(/\s-\s/g, " → ") : "مغلق اليوم";
}

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function getStatus(summary: any) {
  const isClosed = cleanText(summary?.operationalState).toLowerCase() === "closed";
  return {
    isClosed,
    label: isClosed ? "مغلق اليوم" : "متاح اليوم",
  };
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

  const details = Array.isArray(summary.detailRows)
    ? summary.detailRows.filter(Boolean)
    : [];

  const overrideTimelineSummary = cleanText(summary.overrideTimelineSummary);
  const overrideTimelineFallback = cleanText(summary.overrideTimelineFallback);
  const upcomingReturn = summary?.upcomingReturn || null;
  const status = getStatus(summary);
  const finalWindowLabel = formatWindowLabel(summary.finalWindowLabel || "مغلق اليوم");
  const firstOverrideTitle =
    cleanText(savedOverrideRows[0]?.title) || cleanText(savedOverrideRows[0]?.badge) || "لا توجد استثناءات";

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-schedule-summary">
      <WorkspaceTabHeaderV2
        title="ساعات العمل الفعلية اليوم"
        description="ملخص مباشر بعد تطبيق الجدول الأسبوعي والاستثناءات المحفوظة."
        badge={
          <WorkspaceStatusBadgeV2 tone={status.isClosed ? "danger" : "success"}>
            {status.label}
          </WorkspaceStatusBadgeV2>
        }
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2
          label="حالة اليوم"
          value={status.label}
          tone={status.isClosed ? "danger" : "success"}
          note={summary?.weeklyOffToday && summary?.weeklyOffTodayLabel ? String(summary.weeklyOffTodayLabel) : "حسب الجدول الفعلي"}
        />
        <WorkspaceMetricV2
          label="نافذة العمل"
          value={finalWindowLabel}
          tone={status.isClosed ? "gold" : "success"}
          note="بعد تطبيق جميع الاستثناءات"
        />
        <WorkspaceMetricV2
          label="الاستثناءات"
          value={savedOverrideRows.length}
          note={firstOverrideTitle}
        />
        <WorkspaceMetricV2
          label="آخر تحديث"
          value={formatUpdatedTime(nowTick)}
          note="تحديث تلقائي للحالة"
        />
      </div>

      {summary?.weeklyOffToday && summary?.weeklyOffTodayLabel ? (
        <WorkspaceNoticeV2
          title="سبب الإغلاق"
          description={String(summary.weeklyOffTodayLabel)}
          tone="gold"
        />
      ) : null}

      {upcomingReturn ? (
        <WorkspaceCardV2 title="الدوام القادم" description="أقرب نافذة دوام قادمة حسب Malikat Core.">
          <div className="dsv2-ew-metrics dsv2-ew-metrics--compact">
            <WorkspaceMetricV2
              label="نافذة العودة"
              value={upcomingReturn?.windowLabel ? formatWindowLabel(String(upcomingReturn.windowLabel)) : "سيُحدد لاحقًا"}
              tone="success"
            />
            <WorkspaceMetricV2 label="الميلادي" value={upcomingReturn.gregorianDate || "غير محدد"} />
            <WorkspaceMetricV2 label="الهجري" value={upcomingReturn.hijriDate || "-"} />
            <WorkspaceMetricV2 label="المصدر" value={upcomingReturn.sourceLabel || "-"} />
            <WorkspaceMetricV2 label="حالة الدوام" value={upcomingReturn.availabilityLabel || "-"} />
            {upcomingReturn.leaveEndsLabel ? (
              <WorkspaceMetricV2 label="نهاية الحالة" value={upcomingReturn.leaveEndsLabel} tone="gold" />
            ) : null}
          </div>
          {upcomingReturn.note ? (
            <WorkspaceNoticeV2 title="ملاحظة" description={String(upcomingReturn.note)} tone="neutral" />
          ) : null}
        </WorkspaceCardV2>
      ) : null}

      <WorkspaceCardV2 title="استثناءات الدوام" description="الفترات والتواريخ والأسباب المحفوظة.">
        {overrideTimelineSummary ? (
          <WorkspaceNoticeV2 title="ملخص الاستثناءات" description={overrideTimelineSummary} tone="neutral" />
        ) : null}

        <WorkspaceTableV2
          headers={["الحالة", "العنوان", "الوقت", "الميلادي", "الهجري", "تفاصيل"]}
          rows={savedOverrideRows.map((row: any) => [
            cleanText(row?.badge) || "محفوظ",
            cleanText(row?.title) || "استثناء محفوظ",
            formatWindowLabel(cleanText(row?.hoursLabel) || "-"),
            cleanText(row?.gregorianRange) || "-",
            cleanText(row?.hijriRange) || "-",
            [row?.note, row?.appliesToLabel].map(cleanText).filter(Boolean).join(" · ") || "-",
          ])}
          emptyText="لا توجد استثناءات دوام محفوظة حاليًا."
        />

        {overrideTimelineFallback ? (
          <WorkspaceNoticeV2 title="ملاحظة الجدول" description={overrideTimelineFallback} tone="gold" />
        ) : null}
      </WorkspaceCardV2>

      {details.length ? (
        <WorkspaceCardV2 title="تفاصيل احتساب الدوام" description="المصدر والجدول الأسبوعي والنتيجة النهائية.">
          <WorkspaceTableV2
            headers={["البند", "القيمة", "ملاحظة", "تفاصيل"]}
            rows={details.map((row: any, index: number) => {
              const extraLines = Array.isArray(row?.details)
                ? row.details.map(cleanText).filter(Boolean)
                : [];
              return [
                cleanText(row?.label) || `تفصيل ${index + 1}`,
                formatWindowLabel(cleanText(row?.value) || "-"),
                cleanText(row?.note) || "-",
                extraLines.join(" · ") || "-",
              ];
            })}
            emptyText="لا توجد تفاصيل احتساب إضافية."
          />
        </WorkspaceCardV2>
      ) : null}
    </div>
  );
}
