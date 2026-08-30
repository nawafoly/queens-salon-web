import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { EmployeeScheduleTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";
import WorkHourOverridesEditor, { type WorkHourOverridesEditorProps } from "./WorkHourOverridesEditor";
import TemporaryWeeklyOffPeriodCard from "./TemporaryWeeklyOffPeriodCard";
import { WEEKDAY_OPTIONS, normalizeTimeHHMM, type StaffWorkingDay, type WeekdayKey } from "./shared";
import type { WorkZone } from "../../services/attendanceSettingsService";
import { CoreHrService } from "../../services/CoreHrService";
import type { CoreShiftTemplate } from "../../types/hrCoreApi";

type BookingSettingsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  employmentEndDate: string;
  modalUseCustomWorkingHours: boolean;
  modalCustomWorkingHours: Record<WeekdayKey, StaffWorkingDay>;
  modalExceptionalLeaveWeekdays: WeekdayKey[];
  scheduleEffectiveFrom: string;
  scheduleChangeReason: string;
  scheduleVersionCount: number;
  attendanceZones: WorkZone[];
  attendanceZonesLoading: boolean;
  selectedAttendanceZoneId: string;
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
  overrideEditor: WorkHourOverridesEditorProps["editor"];
  onEmploymentEndDateChange: (value: string) => void;
  onModalUseCustomWorkingHoursChange: (value: boolean) => void;
  onScheduleEffectiveFromChange: (value: string) => void;
  onScheduleChangeReasonChange: (value: string) => void;
  onSelectedAttendanceZoneIdChange: (value: string) => void;
  onReloadAttendanceZones: () => void;
  onUpdateModalWorkingDay: (day: WeekdayKey, patch: StaffWorkingDay) => void;
  onCopyModalWorkingDayToAll: (day: WeekdayKey) => void;
};

type ResolvedWorkingDay = {
  enabled: boolean;
  shiftTemplateId: string;
  shiftName: string;
  start: string;
  end: string;
};

function shiftTemplateIsActive(value: unknown) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function resolveWorkingDay(day: WeekdayKey, rows: Record<WeekdayKey, StaffWorkingDay>): ResolvedWorkingDay {
  const current = rows[day] || { enabled: true, start: "10:00", end: "22:00" };
  return {
    enabled: current.enabled !== false,
    shiftTemplateId: String(current.shiftTemplateId || "").trim(),
    shiftName: String(current.shiftName || "").trim(),
    start: normalizeTimeHHMM(current.start) || "10:00",
    end: normalizeTimeHHMM(current.end) || "22:00",
  };
}

function findOperationalWeekBody(root: HTMLElement | null) {
  if (!root) return null;
  const cards = Array.from(root.querySelectorAll<HTMLElement>("article.dsv2-ew-card"));
  const operationalCard = cards.find((card) =>
    card.querySelector<HTMLElement>(".dsv2-ew-card__title")?.textContent?.trim() === "الأسبوع التشغيلي"
  );
  return operationalCard?.querySelector<HTMLElement>(".dsv2-ew-card__body") || null;
}

export default function BookingSettingsSection({
  isVisible,
  busy,
  loading,
  employmentEndDate,
  modalUseCustomWorkingHours,
  modalCustomWorkingHours,
  modalExceptionalLeaveWeekdays,
  scheduleEffectiveFrom,
  scheduleChangeReason,
  scheduleVersionCount,
  attendanceZones,
  attendanceZonesLoading,
  selectedAttendanceZoneId,
  modalHourOverrideHijriPickerRef,
  overrideEditor,
  onEmploymentEndDateChange,
  onModalUseCustomWorkingHoursChange,
  onScheduleEffectiveFromChange,
  onScheduleChangeReasonChange,
  onSelectedAttendanceZoneIdChange,
  onReloadAttendanceZones,
  onUpdateModalWorkingDay,
  onCopyModalWorkingDayToAll,
}: BookingSettingsSectionProps) {
  const [shiftTemplates, setShiftTemplates] = useState<CoreShiftTemplate[]>([]);
  const [shiftTemplatesLoading, setShiftTemplatesLoading] = useState(false);
  const [shiftTemplatesError, setShiftTemplatesError] = useState("");
  const [operationalWeekBody, setOperationalWeekBody] = useState<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const shiftTemplatesRequestRef = useRef(0);

  const loadShiftTemplates = useCallback(async () => {
    const requestId = ++shiftTemplatesRequestRef.current;
    setShiftTemplatesLoading(true);
    setShiftTemplatesError("");

    try {
      const rows = await CoreHrService.listShiftTemplates({ active: "all" });
      if (requestId !== shiftTemplatesRequestRef.current) return;

      setShiftTemplates(
        rows.filter((row) => shiftTemplateIsActive((row as { active?: unknown }).active))
      );
    } catch (error) {
      if (requestId !== shiftTemplatesRequestRef.current) return;

      console.warn("load shift templates for weekly schedule failed", error);
      // SHIFT_TEMPLATE_HYDRATION_SAFETY_V1
      // Keep the last known-good rows. A network/API failure is not the same
      // thing as a canonical empty result.
      setShiftTemplatesError(
        "تعذر تحميل قوالب الشفتات من Malikat Core. سيتم إعادة المحاولة عند عودة الاتصال."
      );
    } finally {
      if (requestId === shiftTemplatesRequestRef.current) {
        setShiftTemplatesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    void loadShiftTemplates();

    const retry = () => {
      void loadShiftTemplates();
    };

    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);

    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      shiftTemplatesRequestRef.current += 1;
    };
  }, [isVisible, loadShiftTemplates]);

  const templateByWindow = useMemo(() => {
    const rows = new Map<string, CoreShiftTemplate>();
    for (const template of shiftTemplates) {
      const key = `${normalizeTimeHHMM(template.startTime) || ""}|${normalizeTimeHHMM(template.endTime) || ""}`;
      if (key !== "|" && !rows.has(key)) rows.set(key, template);
    }
    return rows;
  }, [shiftTemplates]);

  useEffect(() => {
    if (!isVisible || shiftTemplatesLoading || shiftTemplates.length === 0) return;

    WEEKDAY_OPTIONS.forEach((day) => {
      const current = resolveWorkingDay(day.key, modalCustomWorkingHours);
      if (current.shiftTemplateId) return;

      const matchedTemplate = templateByWindow.get(`${current.start}|${current.end}`) || null;
      if (!matchedTemplate?.id) return;

      onUpdateModalWorkingDay(day.key, {
        ...current,
        shiftTemplateId: matchedTemplate.id,
        shiftName: String(matchedTemplate.name || current.shiftName || "").trim(),
        start: normalizeTimeHHMM(matchedTemplate.startTime) || current.start,
        end: normalizeTimeHHMM(matchedTemplate.endTime) || current.end,
      });
    });
  }, [
    isVisible,
    modalCustomWorkingHours,
    onUpdateModalWorkingDay,
    shiftTemplates,
    shiftTemplatesLoading,
    templateByWindow,
  ]);

  useEffect(() => {
    if (!isVisible) {
      setOperationalWeekBody(null);
      return;
    }
    const root = sectionRef.current;
    if (!root) return;

    const syncTarget = () => {
      const next = findOperationalWeekBody(root);
      setOperationalWeekBody((current) => current === next ? current : next);
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isVisible]);

  if (!isVisible) return null;

  const weeklyOffDays = new Set(modalExceptionalLeaveWeekdays);
  const workingDays = WEEKDAY_OPTIONS.map((day) => {
    const row = resolveWorkingDay(day.key, modalCustomWorkingHours);
    const matchedTemplate = row.shiftTemplateId
      ? shiftTemplates.find((template) => template.id === row.shiftTemplateId) || null
      : templateByWindow.get(`${row.start}|${row.end}`) || null;
    return {
      key: day.key,
      label: day.label,
      enabled: modalUseCustomWorkingHours ? row.enabled : !weeklyOffDays.has(day.key),
      shiftTemplateId: matchedTemplate?.id || row.shiftTemplateId,
      shiftName: matchedTemplate?.name || row.shiftName,
      start: normalizeTimeHHMM(matchedTemplate?.startTime) || row.start,
      end: normalizeTimeHHMM(matchedTemplate?.endTime) || row.end,
    };
  });

  const weeklyOffManager = operationalWeekBody
    ? createPortal(
        <TemporaryWeeklyOffPeriodCard
          busy={busy}
          workingDays={workingDays}
          overrides={overrideEditor.modalCustomHourOverrides || []}
          onOverridesChange={overrideEditor.setModalCustomHourOverrides}
        />,
        operationalWeekBody
      )
    : null;

  return (
    <section ref={sectionRef} className="dsv2-ew-tab-panel">
      {weeklyOffManager}

      <EmployeeScheduleTabLiveV2
        readOnly={busy}
        loading={loading}
        employmentEndDate={employmentEndDate}
        useCustomWorkingHours={modalUseCustomWorkingHours}
        workingDays={workingDays}
        shiftTemplates={shiftTemplates}
        shiftTemplatesLoading={shiftTemplatesLoading}
        shiftTemplatesError={shiftTemplatesError}
        attendanceZones={attendanceZones.map((zone) => ({
          id: zone.id,
          name: `${zone.name || zone.id}${zone.active ? "" : " - غير نشط"}${zone.radiusMeters ? ` - ${zone.radiusMeters} م` : ""}`,
        }))}
        attendanceZonesLoading={attendanceZonesLoading}
        selectedAttendanceZoneId={selectedAttendanceZoneId}
        scheduleEffectiveFrom={scheduleEffectiveFrom}
        scheduleChangeReason={scheduleChangeReason || (scheduleVersionCount > 0 ? "" : "أول نسخة")}
        onEmploymentEndDateChange={onEmploymentEndDateChange}
        onUseCustomWorkingHoursChange={onModalUseCustomWorkingHoursChange}
        onSelectedAttendanceZoneIdChange={onSelectedAttendanceZoneIdChange}
        onScheduleEffectiveFromChange={onScheduleEffectiveFromChange}
        onScheduleChangeReasonChange={onScheduleChangeReasonChange}
        onReloadAttendanceZones={onReloadAttendanceZones}
        onCopyWorkingDayToAll={(dayKey) => onCopyModalWorkingDayToAll(dayKey as WeekdayKey)}
        onWorkingDayChange={(dayKey, patch) => {
          const typedDay = dayKey as WeekdayKey;
          const current = resolveWorkingDay(typedDay, modalCustomWorkingHours);
          onUpdateModalWorkingDay(typedDay, {
            ...current,
            ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
            ...(patch.shiftTemplateId !== undefined ? { shiftTemplateId: patch.shiftTemplateId } : {}),
            ...(patch.shiftName !== undefined ? { shiftName: patch.shiftName } : {}),
            ...(patch.start !== undefined ? { start: patch.start } : {}),
            ...(patch.end !== undefined ? { end: patch.end } : {}),
          });
        }}
      />

      {modalUseCustomWorkingHours ? (
        <WorkHourOverridesEditor
          loading={loading}
          busy={busy}
          editor={overrideEditor}
          modalHourOverrideHijriPickerRef={modalHourOverrideHijriPickerRef}
        />
      ) : null}
    </section>
  );
}
