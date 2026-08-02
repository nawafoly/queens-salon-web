import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/DashboardShiftControl.css";
import { CoreHrService } from "../../services/CoreHrService";
import type {
  CoreScheduleException,
  CoreShiftAssignment,
  CoreShiftChangePreview,
  CoreShiftPayrollAdjustment,
  CoreShiftPayrollPeriodLock,
  CoreShiftTemplate,
} from "../../types/hrCoreApi";

type ShiftControlSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeName?: string;
  canManage: boolean;
};

type TemplateForm = {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: string;
  breakPaid: boolean;
  lateGraceMinutes: string;
  earlyLeaveGraceMinutes: string;
  overtimeAfterMinutes: string;
  active: boolean;
};

type AssignmentForm = {
  shiftTemplateId: string;
  effectiveFrom: string;
  effectiveTo: string;
  assignmentType: "permanent" | "temporary";
  replaceOverlaps: boolean;
  reason: string;
};

type ExceptionForm = {
  dateFrom: string;
  dateTo: string;
  exceptionType: "shift" | "off" | "custom";
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  note: string;
};

function todayKey() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function boolish(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function numberInput(value: unknown, fallback = "0") {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(number) : fallback;
}

function formatShiftWindow(row?: Partial<CoreShiftTemplate | CoreShiftAssignment | CoreScheduleException> | null) {
  const start = cleanText((row as any)?.startTime || (row as any)?.start_time || (row as any)?.templateStartTime || (row as any)?.template_start_time);
  const end = cleanText((row as any)?.endTime || (row as any)?.end_time || (row as any)?.templateEndTime || (row as any)?.template_end_time);
  if (!start && !end) return "بدون وقت محدد";
  return `${start || "--:--"} — ${end || "--:--"}`;
}

function isAssignmentExpired(assignment: CoreShiftAssignment, date = todayKey()) {
  return cleanText(assignment.status) !== "cancelled" && Boolean(assignment.effectiveTo) && cleanText(assignment.effectiveTo) < date;
}

function isAssignmentCurrent(assignment: CoreShiftAssignment, date = todayKey()) {
  if (cleanText(assignment.status) !== "published") return false;
  if (assignment.effectiveFrom > date) return false;
  if (assignment.effectiveTo && assignment.effectiveTo < date) return false;
  return true;
}

function assignmentStatusLabel(assignment: CoreShiftAssignment) {
  const status = cleanText(assignment.status);
  if (isAssignmentExpired(assignment)) return "منتهي";
  if (status === "published" && assignment.effectiveFrom > todayKey()) return "مجدول";
  if (isAssignmentCurrent(assignment)) return "نشط";
  if (status === "published") return "منشور";
  if (status === "draft") return "مسودة";
  if (status === "cancelled") return "ملغي";
  return status || "غير محدد";
}

function exceptionTypeLabel(type: string) {
  if (type === "shift") return "شفت بديل";
  if (type === "off") return "راحة / إغلاق يوم";
  if (type === "custom") return "وقت مخصص";
  return type || "استثناء";
}

function parseSnapshot(row: CoreShiftAssignment) {
  try {
    const parsed = JSON.parse(String(row.snapshotJson || "{}"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function activeAssignmentForDate(assignments: CoreShiftAssignment[], date: string) {
  const cleanDate = cleanText(date) || todayKey();
  return [...assignments]
    .filter((assignment) => isAssignmentCurrent(assignment, cleanDate))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] || null;
}

function shiftTemplateIdForDate(input: {
  date: string;
  assignments: CoreShiftAssignment[];
  templates: CoreShiftTemplate[];
  resolvedShift?: Record<string, unknown> | null;
}) {
  const date = cleanText(input.date) || todayKey();
  const resolvedDate = cleanText((input.resolvedShift as any)?.date);
  const resolvedTemplateId =
    resolvedDate === date
      ? cleanText(
          (input.resolvedShift as any)?.shiftTemplateId ||
            (input.resolvedShift as any)?.shift_template_id
        )
      : "";
  if (resolvedTemplateId) return resolvedTemplateId;

  const assignment = activeAssignmentForDate(input.assignments, date);
  const assignmentSnapshot = assignment ? parseSnapshot(assignment) : {};
  const assignmentTemplateId = cleanText(
    (assignment as any)?.shiftTemplateId ||
      (assignment as any)?.shift_template_id ||
      assignmentSnapshot.id
  );
  if (assignmentTemplateId) return assignmentTemplateId;

  const assignmentName = cleanText(assignment?.shiftName || assignmentSnapshot.name);
  if (assignmentName) {
    const matched = input.templates.find((template) => cleanText(template.name) === assignmentName);
    if (matched) return matched.id;
  }

  return input.templates.find((item) => boolish(item.active))?.id || "";
}

function previewCount(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function previewDateRange(preview?: CoreShiftChangePreview | null) {
  if (!preview) return "لا توجد معاينة بعد";
  const from = cleanText(preview.dateFrom || preview.date_from);
  const to = cleanText(preview.dateTo || preview.date_to);
  return `${from || "----"} ← ${to || from || "----"}`;
}

function emptyTemplateForm(): TemplateForm {
  return {
    id: "",
    name: "",
    code: "",
    startTime: "13:00",
    endTime: "21:00",
    crossesMidnight: false,
    breakMinutes: "0",
    breakPaid: false,
    lateGraceMinutes: "0",
    earlyLeaveGraceMinutes: "0",
    overtimeAfterMinutes: "0",
    active: true,
  };
}

function emptyAssignmentForm(): AssignmentForm {
  return {
    shiftTemplateId: "",
    effectiveFrom: todayKey(),
    effectiveTo: "",
    assignmentType: "permanent",
    replaceOverlaps: true,
    reason: "تعيين شفت من إدارة الدوام",
  };
}

function emptyExceptionForm(): ExceptionForm {
  const today = todayKey();
  return {
    dateFrom: today,
    dateTo: today,
    exceptionType: "shift",
    shiftTemplateId: "",
    startTime: "",
    endTime: "",
    note: "استثناء مؤقت من إدارة الدوام",
  };
}

export default function ShiftControlSection({
  isVisible,
  employeeId,
  employeeName,
  canManage,
}: ShiftControlSectionProps) {
  const [templates, setTemplates] = useState<CoreShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<CoreShiftAssignment[]>([]);
  const [exceptions, setExceptions] = useState<CoreScheduleException[]>([]);
  const [periodLocks, setPeriodLocks] = useState<CoreShiftPayrollPeriodLock[]>([]);
  const [payrollAdjustments, setPayrollAdjustments] = useState<CoreShiftPayrollAdjustment[]>([]);
  const [impactPreview, setImpactPreview] = useState<CoreShiftChangePreview | null>(null);
  const [allowLockedPeriodAdjustment, setAllowLockedPeriodAdjustment] = useState(false);
  const [resolvedDate, setResolvedDate] = useState(todayKey());
  const [resolvedShift, setResolvedShift] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [templateForm, setTemplateForm] = useState<TemplateForm>(() => emptyTemplateForm());
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(() => emptyAssignmentForm());
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>(() => emptyExceptionForm());

  const activeTemplates = useMemo(
    () => templates.filter((item) => boolish(item.active)),
    [templates]
  );

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === assignmentForm.shiftTemplateId) || null,
    [assignmentForm.shiftTemplateId, templates]
  );

  const openAssignment = useMemo(
    () => assignments.find((item) => isAssignmentCurrent(item) && !item.effectiveTo) || null,
    [assignments]
  );

  const defaultTemplateIdForExceptionDate = useCallback(
    (date: string) =>
      shiftTemplateIdForDate({
        date,
        assignments,
        templates,
        resolvedShift,
      }),
    [assignments, resolvedShift, templates]
  );

  const selectedExceptionTemplateName = useMemo(
    () =>
      activeTemplates.find((template) => template.id === exceptionForm.shiftTemplateId)?.name ||
      templates.find((template) => template.id === exceptionForm.shiftTemplateId)?.name ||
      "لا يوجد شفت محدد",
    [activeTemplates, exceptionForm.shiftTemplateId, templates]
  );

  const load = useCallback(async () => {
    if (!isVisible || !employeeId) return;
    setLoading(true);
    setError("");
    try {
      const [templateRows, assignmentRows, exceptionRows, locks, adjustments, resolved] = await Promise.all([
        CoreHrService.listShiftTemplates({ active: "all" }),
        CoreHrService.listShiftAssignments({ employeeId }),
        CoreHrService.listScheduleExceptions({ employeeId }),
        CoreHrService.listShiftPayrollPeriodLocks(),
        CoreHrService.listShiftPayrollAdjustments({ employeeId }),
        CoreHrService.resolveEmployeeShift(employeeId, resolvedDate),
      ]);
      setTemplates(templateRows);
      setAssignments(assignmentRows);
      setExceptions(exceptionRows);
      setPeriodLocks(locks);
      setPayrollAdjustments(adjustments);
      setResolvedShift(resolved);
      setAssignmentForm((current) => ({
        ...current,
        shiftTemplateId: current.shiftTemplateId || templateRows.find((item) => boolish(item.active))?.id || "",
      }));
      setExceptionForm((current) => ({
        ...current,
        shiftTemplateId:
          current.exceptionType === "shift" && current.shiftTemplateId
            ? current.shiftTemplateId
            : shiftTemplateIdForDate({
                date: current.dateFrom,
                assignments: assignmentRows,
                templates: templateRows,
                resolvedShift: resolved,
              }),
      }));
    } catch (err) {
      console.warn("shift control load failed", err);
      setError("تعذر تحميل نظام الشفتات من Core. تأكد من تشغيل Core Worker وتطبيق migration.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, isVisible, resolvedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTemplate = async () => {
    if (!canManage) return;
    if (!templateForm.name.trim()) {
      setError("اسم الشفت مطلوب.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.saveShiftTemplate({
        id: templateForm.id || undefined,
        name: templateForm.name,
        code: templateForm.code || null,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        crossesMidnight: templateForm.crossesMidnight,
        breakMinutes: Number(templateForm.breakMinutes || 0),
        breakPaid: templateForm.breakPaid,
        lateGraceMinutes: Number(templateForm.lateGraceMinutes || 0),
        earlyLeaveGraceMinutes: Number(templateForm.earlyLeaveGraceMinutes || 0),
        overtimeAfterMinutes: Number(templateForm.overtimeAfterMinutes || 0),
        active: templateForm.active,
        reason: "تحديث قالب شفت من واجهة إدارة الموظفات",
      });
      setTemplateForm(emptyTemplateForm());
      setMessage("تم حفظ قالب الشفت.");
      await load();
    } catch (err) {
      console.warn("save shift template failed", err);
      setError("تعذر حفظ قالب الشفت. راجع الوقت أو الصلاحيات.");
    } finally {
      setSaving(false);
    }
  };

  const editTemplate = (template: CoreShiftTemplate) => {
    setTemplateForm({
      id: template.id,
      name: template.name || "",
      code: template.code || "",
      startTime: template.startTime || "13:00",
      endTime: template.endTime || "21:00",
      crossesMidnight: boolish(template.crossesMidnight),
      breakMinutes: numberInput(template.breakMinutes),
      breakPaid: boolish(template.breakPaid),
      lateGraceMinutes: numberInput(template.lateGraceMinutes),
      earlyLeaveGraceMinutes: numberInput(template.earlyLeaveGraceMinutes),
      overtimeAfterMinutes: numberInput(template.overtimeAfterMinutes),
      active: boolish(template.active),
    });
  };

  const previewAssignmentChange = async () => {
    if (!employeeId || !assignmentForm.effectiveFrom) return null;
    const preview = await CoreHrService.previewShiftChange({
      employeeId,
      changeType: "assignment",
      effectiveFrom: assignmentForm.effectiveFrom,
      effectiveTo: assignmentForm.effectiveTo || assignmentForm.effectiveFrom,
    });
    setImpactPreview(preview);
    return preview;
  };

  const previewExceptionChange = async () => {
    if (!employeeId || !exceptionForm.dateFrom) return null;
    const preview = await CoreHrService.previewShiftChange({
      employeeId,
      changeType: "exception",
      dateFrom: exceptionForm.dateFrom,
      dateTo: exceptionForm.dateTo || exceptionForm.dateFrom,
    });
    setImpactPreview(preview);
    return preview;
  };

  const ensurePreviewAllowsSave = (preview: CoreShiftChangePreview | null) => {
    const lockedCount = previewCount(preview?.lockedPeriodsCount ?? preview?.locked_periods_count);
    if (lockedCount > 0 && !allowLockedPeriodAdjustment) {
      setError("الفترة مقفلة للرواتب. راجع معاينة أثر التعديل ثم فعّل خيار تسجيل تسوية بعد الإقفال.");
      return false;
    }
    return true;
  };

  const createAssignment = async () => {
    if (!canManage) return;
    if (!assignmentForm.shiftTemplateId || !assignmentForm.effectiveFrom || !assignmentForm.reason.trim()) {
      setError("اختيار الشفت وتاريخ السريان والسبب مطلوبة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const preview = await previewAssignmentChange();
      if (!ensurePreviewAllowsSave(preview)) return;
      await CoreHrService.createShiftAssignment({
        employeeId,
        shiftTemplateId: assignmentForm.shiftTemplateId,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo || null,
        assignmentType: assignmentForm.assignmentType,
        status: "published",
        replaceOverlaps: assignmentForm.replaceOverlaps,
        reason: assignmentForm.reason,
        snapshot: selectedTemplate || {},
        allowLockedPeriodAdjustment,
      });
      setAssignmentForm(emptyAssignmentForm());
      setMessage("تم تعيين الشفت للموظفة مع حفظ تاريخ السريان.");
      await load();
    } catch (err: any) {
      console.warn("create shift assignment failed", err);
      const text = String(err?.payload?.message || err?.message || "");
      setError(text.includes("overlap") ? "يوجد شفت منشور متداخل. فعّل خيار إغلاق التداخل أو استخدم استثناء يومي." : "تعذر تعيين الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    const reason = window.prompt("سبب إلغاء تعيين الشفت؟", "تصحيح من إدارة الدوام");
    if (!reason) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.cancelShiftAssignment(assignment.id, reason, { allowLockedPeriodAdjustment });
      setMessage("تم إلغاء تعيين الشفت.");
      await load();
    } catch (err) {
      console.warn("cancel shift assignment failed", err);
      setError("تعذر إلغاء تعيين الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const closeAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    const effectiveTo = window.prompt("أدخل تاريخ نهاية الشفت YYYY-MM-DD", todayKey());
    if (!effectiveTo) return;
    const reason = window.prompt("سبب إنهاء الشفت؟", "إنهاء شفت من إدارة الدوام") || "إنهاء شفت";
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateShiftAssignment(assignment.id, { effectiveTo, reason, allowLockedPeriodAdjustment });
      setMessage("تم إنهاء الشفت بتاريخ محدد.");
      await load();
    } catch (err) {
      console.warn("close shift assignment failed", err);
      setError("تعذر إنهاء الشفت. تأكد من صيغة التاريخ.");
    } finally {
      setSaving(false);
    }
  };

  const createException = async () => {
    if (!canManage) return;
    if (!exceptionForm.dateFrom || !exceptionForm.dateTo) {
      setError("تاريخ الاستثناء مطلوب.");
      return;
    }
    if (exceptionForm.exceptionType === "shift" && !exceptionForm.shiftTemplateId) {
      setError("اختر قالب الشفت للاستثناء.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const preview = await previewExceptionChange();
      if (!ensurePreviewAllowsSave(preview)) return;
      await CoreHrService.createScheduleException({
        employeeId,
        dateFrom: exceptionForm.dateFrom,
        dateTo: exceptionForm.dateTo,
        exceptionType: exceptionForm.exceptionType,
        shiftTemplateId: exceptionForm.exceptionType === "shift" ? exceptionForm.shiftTemplateId : null,
        enabled: exceptionForm.exceptionType !== "off",
        startTime: exceptionForm.exceptionType === "custom" ? exceptionForm.startTime : null,
        endTime: exceptionForm.exceptionType === "custom" ? exceptionForm.endTime : null,
        note: exceptionForm.note,
        status: "approved",
        allowLockedPeriodAdjustment,
      });
      setExceptionForm(emptyExceptionForm());
      setMessage("تم حفظ الاستثناء. الاستثناء يتقدم على الشفت الأساسي في تاريخ تطبيقه.");
      await load();
    } catch (err) {
      console.warn("create schedule exception failed", err);
      setError("تعذر حفظ الاستثناء. راجع التاريخ والوقت.");
    } finally {
      setSaving(false);
    }
  };

  const cancelException = async (exception: CoreScheduleException) => {
    if (!canManage) return;
    const note = window.prompt("سبب إلغاء الاستثناء؟", "تصحيح من إدارة الدوام");
    if (!note) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateScheduleException(exception.id, { status: "cancelled", enabled: false, note, allowLockedPeriodAdjustment });
      setMessage("تم إلغاء الاستثناء.");
      await load();
    } catch (err) {
      console.warn("cancel exception failed", err);
      setError("تعذر إلغاء الاستثناء.");
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible) return null;

  const resolvedSource = cleanText(resolvedShift?.source);

  return (
    <section className="emp-modal-section shift-control-section">
      <header className="emp-section-header shift-control-header">
        <div className="emp-section-header__main">
          <span className="shift-control-eyebrow">SHIFT CONTROL</span>
          <h3 className="emp-modal-section-title">إدارة الشفتات التاريخية</h3>
          <p className="emp-section-lead">
            قوالب شفتات مشتركة، تعيين بتاريخ سريان، استثناء يومي أو مؤقت، ومنع التداخل قبل تأثيره على الحضور والرواتب.
          </p>
        </div>
        <button type="button" className="exp-btn ghost" onClick={() => void load()} disabled={loading || saving}>
          تحديث
        </button>
      </header>

      {error ? <div className="shift-control-alert error">{error}</div> : null}
      {message ? <div className="shift-control-alert success">{message}</div> : null}

      <article className="shift-control-card shift-control-card--wide shift-control-impact-card">
        <div className="shift-control-card__head">
          <div>
            <strong>معاينة أثر التعديل قبل الحفظ</strong>
            <span>يعرض الأيام المتأثرة، التداخلات، وفترات الرواتب المقفلة قبل تطبيق أي تغيير.</span>
          </div>
        </div>
        <div className="shift-control-impact-grid">
          <div><span>نطاق التعديل</span><strong>{previewDateRange(impactPreview)}</strong></div>
          <div><span>الأيام المتأثرة</span><strong>{previewCount(impactPreview?.affectedDays ?? impactPreview?.affected_days)}</strong></div>
          <div><span>تداخلات الشفت</span><strong>{previewCount(impactPreview?.overlappingAssignmentsCount ?? impactPreview?.overlapping_assignments_count)}</strong></div>
          <div><span>فترات رواتب مقفلة</span><strong>{previewCount(impactPreview?.lockedPeriodsCount ?? impactPreview?.locked_periods_count)}</strong></div>
        </div>
        <div className="shift-control-actions">
          <button type="button" className="exp-btn ghost" onClick={() => void previewAssignmentChange()} disabled={!canManage || saving || !assignmentForm.effectiveFrom}>معاينة تعيين الشفت</button>
          <button type="button" className="exp-btn ghost" onClick={() => void previewExceptionChange()} disabled={!canManage || saving || !exceptionForm.dateFrom}>معاينة الاستثناء</button>
        </div>
        <label className="shift-control-lock-confirm">
          <input type="checkbox" checked={allowLockedPeriodAdjustment} onChange={(event) => setAllowLockedPeriodAdjustment(event.target.checked)} disabled={!canManage || saving} />
          السماح بتسجيل تسوية بعد إقفال الراتب عند تعديل فترة مقفلة
        </label>
        {periodLocks.length ? <p className="shift-control-note">فترات الرواتب المقفلة الحالية: {periodLocks.length}. أي تعديل داخلها لن يمر إلا كتسوية قابلة للمراجعة.</p> : null}
      </article>

      <div className="shift-control-grid">
        <article className="shift-control-card shift-control-card--wide">
          <div className="shift-control-card__head">
            <div>
              <strong>الشفت الفعلي في تاريخ محدد</strong>
              <span>اختبار سريع قبل تعديل أي جدول.</span>
            </div>
          </div>
          <div className="shift-control-inline-form">
            <label>
              <span>التاريخ</span>
              <input className="dash-input" type="date" value={resolvedDate} onChange={(event) => setResolvedDate(event.target.value)} />
            </label>
            <button type="button" className="exp-btn primary" onClick={() => void load()} disabled={loading || saving || !employeeId}>
              عرض الشفت
            </button>
          </div>
          <div className={`shift-control-resolved shift-control-resolved--${resolvedSource || "none"}`}>
            <span>الموظفة</span>
            <strong>{employeeName || employeeId}</strong>
            <span>المصدر</span>
            <strong>{resolvedSource === "exception" ? "استثناء" : resolvedSource === "assignment" ? "تعيين شفت" : "لا يوجد شفت"}</strong>
            <span>الوقت</span>
            <strong>{formatShiftWindow(resolvedShift as any)}</strong>
          </div>
        </article>

        <article className="shift-control-card">
          <div className="shift-control-card__head">
            <div>
              <strong>{templateForm.id ? "تعديل قالب شفت" : "إنشاء قالب شفت"}</strong>
              <span>القالب يستخدم لأكثر من موظفة.</span>
            </div>
          </div>
          <div className="shift-control-form-grid">
            <label><span>اسم الشفت</span><input className="dash-input" value={templateForm.name} onChange={(e) => setTemplateForm((x) => ({ ...x, name: e.target.value }))} placeholder="مثال: شفت الظهر" disabled={!canManage || saving} /></label>
            <label><span>الكود</span><input className="dash-input" value={templateForm.code} onChange={(e) => setTemplateForm((x) => ({ ...x, code: e.target.value }))} placeholder="MID" disabled={!canManage || saving} /></label>
            <label><span>البداية</span><input className="dash-input" type="time" value={templateForm.startTime} onChange={(e) => setTemplateForm((x) => ({ ...x, startTime: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>النهاية</span><input className="dash-input" type="time" value={templateForm.endTime} onChange={(e) => setTemplateForm((x) => ({ ...x, endTime: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>سماح التأخير بالدقائق</span><input className="dash-input" type="number" min="0" value={templateForm.lateGraceMinutes} onChange={(e) => setTemplateForm((x) => ({ ...x, lateGraceMinutes: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>سماح الخروج المبكر</span><input className="dash-input" type="number" min="0" value={templateForm.earlyLeaveGraceMinutes} onChange={(e) => setTemplateForm((x) => ({ ...x, earlyLeaveGraceMinutes: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>الاستراحة بالدقائق</span><input className="dash-input" type="number" min="0" value={templateForm.breakMinutes} onChange={(e) => setTemplateForm((x) => ({ ...x, breakMinutes: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>الإضافي بعد دقيقة</span><input className="dash-input" type="number" min="0" value={templateForm.overtimeAfterMinutes} onChange={(e) => setTemplateForm((x) => ({ ...x, overtimeAfterMinutes: e.target.value }))} disabled={!canManage || saving} /></label>
          </div>
          <div className="shift-control-checks">
            <label><input type="checkbox" checked={templateForm.crossesMidnight} onChange={(e) => setTemplateForm((x) => ({ ...x, crossesMidnight: e.target.checked }))} disabled={!canManage || saving} /> يمتد بعد منتصف الليل</label>
            <label><input type="checkbox" checked={templateForm.breakPaid} onChange={(e) => setTemplateForm((x) => ({ ...x, breakPaid: e.target.checked }))} disabled={!canManage || saving} /> الاستراحة مدفوعة</label>
            <label><input type="checkbox" checked={templateForm.active} onChange={(e) => setTemplateForm((x) => ({ ...x, active: e.target.checked }))} disabled={!canManage || saving} /> نشط</label>
          </div>
          <div className="shift-control-actions">
            <button type="button" className="exp-btn ghost" onClick={() => setTemplateForm(emptyTemplateForm())} disabled={saving}>تفريغ</button>
            <button type="button" className="exp-btn primary" onClick={() => void saveTemplate()} disabled={!canManage || saving}>حفظ القالب</button>
          </div>
        </article>

        <article className="shift-control-card">
          <div className="shift-control-card__head">
            <div>
              <strong>تعيين شفت للموظفة</strong>
              <span>يستخدم لتغيير دائم بتاريخ سريان.</span>
            </div>
          </div>
          <div className="shift-control-form-grid">
            <label><span>الشفت</span><select className="dash-input" value={assignmentForm.shiftTemplateId} onChange={(e) => setAssignmentForm((x) => ({ ...x, shiftTemplateId: e.target.value }))} disabled={!canManage || saving}>{activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} — {formatShiftWindow(template)}</option>)}</select></label>
            <label><span>نوع التعيين</span><select className="dash-input" value={assignmentForm.assignmentType} onChange={(e) => setAssignmentForm((x) => ({ ...x, assignmentType: e.target.value as AssignmentForm["assignmentType"] }))} disabled={!canManage || saving}><option value="permanent">دائم</option><option value="temporary">مؤقت</option></select></label>
            <label><span>يبدأ من</span><input className="dash-input" type="date" value={assignmentForm.effectiveFrom} onChange={(e) => setAssignmentForm((x) => ({ ...x, effectiveFrom: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>ينتهي في</span><input className="dash-input" type="date" value={assignmentForm.effectiveTo} onChange={(e) => setAssignmentForm((x) => ({ ...x, effectiveTo: e.target.value }))} disabled={!canManage || saving} /></label>
          </div>
          <label className="shift-control-full"><span>سبب التغيير</span><input className="dash-input" value={assignmentForm.reason} onChange={(e) => setAssignmentForm((x) => ({ ...x, reason: e.target.value }))} disabled={!canManage || saving} /></label>
          <div className="shift-control-checks">
            <label><input type="checkbox" checked={assignmentForm.replaceOverlaps} onChange={(e) => setAssignmentForm((x) => ({ ...x, replaceOverlaps: e.target.checked }))} disabled={!canManage || saving} /> إغلاق الشفت المفتوح السابق قبل تاريخ السريان</label>
          </div>
          <div className="shift-control-actions">
            <button type="button" className="exp-btn primary" onClick={() => void createAssignment()} disabled={!canManage || saving || !activeTemplates.length}>تعيين الشفت</button>
          </div>
          {openAssignment ? <p className="shift-control-note">الشفت المفتوح الحالي: {openAssignment.shiftName || "قالب محفوظ"} من {openAssignment.effectiveFrom}</p> : null}
        </article>

        <article className="shift-control-card shift-control-card--wide">
          <div className="shift-control-card__head">
            <div>
              <strong>استثناء يومي أو مؤقت</strong>
              <span>الأولوية للاستثناء قبل الشفت الأساسي.</span>
            </div>
          </div>
          <div className="shift-control-form-grid shift-control-form-grid--wide">
            <label><span>من تاريخ</span><input className="dash-input" type="date" value={exceptionForm.dateFrom} onChange={(e) => {
              const dateFrom = e.target.value;
              setExceptionForm((x) => ({
                ...x,
                dateFrom,
                dateTo: x.dateTo || dateFrom,
                shiftTemplateId: defaultTemplateIdForExceptionDate(dateFrom),
              }));
            }} disabled={!canManage || saving} /></label>
            <label><span>إلى تاريخ</span><input className="dash-input" type="date" value={exceptionForm.dateTo} onChange={(e) => setExceptionForm((x) => ({ ...x, dateTo: e.target.value }))} disabled={!canManage || saving} /></label>
            <label><span>نوع الاستثناء</span><select className="dash-input" value={exceptionForm.exceptionType} onChange={(e) => {
              const exceptionType = e.target.value as ExceptionForm["exceptionType"];
              setExceptionForm((x) => ({
                ...x,
                exceptionType,
                shiftTemplateId:
                  exceptionType === "shift" && x.exceptionType === "shift" && x.shiftTemplateId
                    ? x.shiftTemplateId
                    : defaultTemplateIdForExceptionDate(x.dateFrom),
              }));
            }} disabled={!canManage || saving}><option value="shift">شفت بديل</option><option value="custom">وقت مخصص</option><option value="off">راحة / لا دوام</option></select></label>
            <label><span>{exceptionForm.exceptionType === "shift" ? "قالب الشفت" : "الشفت الحالي"}</span>{exceptionForm.exceptionType === "shift" ? <select className="dash-input" value={exceptionForm.shiftTemplateId} onChange={(e) => setExceptionForm((x) => ({ ...x, shiftTemplateId: e.target.value }))} disabled={!canManage || saving}><option value="">{activeTemplates.length ? "اختر قالب الشفت" : "لا توجد قوالب نشطة"}</option>{activeTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select> : <input className="dash-input" value={selectedExceptionTemplateName} readOnly disabled />}</label>
            <label><span>بداية مخصصة</span><input className="dash-input" type="time" value={exceptionForm.startTime} onChange={(e) => setExceptionForm((x) => ({ ...x, startTime: e.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} /></label>
            <label><span>نهاية مخصصة</span><input className="dash-input" type="time" value={exceptionForm.endTime} onChange={(e) => setExceptionForm((x) => ({ ...x, endTime: e.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} /></label>
          </div>
          <label className="shift-control-full"><span>ملاحظة</span><input className="dash-input" value={exceptionForm.note} onChange={(e) => setExceptionForm((x) => ({ ...x, note: e.target.value }))} disabled={!canManage || saving} /></label>
          <div className="shift-control-actions">
            <button type="button" className="exp-btn primary" onClick={() => void createException()} disabled={!canManage || saving}>حفظ الاستثناء</button>
          </div>
        </article>
      </div>

      <div className="shift-control-lists">
        <article className="shift-control-list-card">
          <h4>قوالب الشفتات</h4>
          <div className="shift-control-list">
            {templates.map((template) => (
              <div className="shift-control-row" key={template.id}>
                <div><strong>{template.name}</strong><span>{formatShiftWindow(template)} · سماح {template.lateGraceMinutes || 0} د</span></div>
                <span className={boolish(template.active) ? "shift-badge success" : "shift-badge muted"}>{boolish(template.active) ? "نشط" : "موقف"}</span>
                <button type="button" className="exp-btn ghost" onClick={() => editTemplate(template)} disabled={!canManage || saving}>تعديل</button>
              </div>
            ))}
            {!templates.length && <p className="shift-control-empty">لا توجد قوالب شفتات بعد.</p>}
          </div>
        </article>

        <article className="shift-control-list-card">
          <h4>تعيينات الموظفة</h4>
          <div className="shift-control-list">
            {assignments.map((assignment) => {
              const snapshot = parseSnapshot(assignment);
              const isExpired = isAssignmentExpired(assignment);
              const isCurrent = isAssignmentCurrent(assignment);
              return (
                <div className="shift-control-row" key={assignment.id}>
                  <div><strong>{assignment.shiftName || cleanText(snapshot.name) || "شفت محفوظ"}</strong><span>{assignment.effectiveFrom} ← {assignment.effectiveTo || "مستمر"} · {formatShiftWindow(snapshot as any)}</span></div>
                  <span className={isCurrent ? "shift-badge success" : "shift-badge muted"}>{assignmentStatusLabel(assignment)}</span>
                  <div className="shift-control-row-actions">
                    <button type="button" className="exp-btn ghost" onClick={() => void closeAssignment(assignment)} disabled={!canManage || saving || assignment.status === "cancelled" || isExpired}>إنهاء</button>
                    <button type="button" className="exp-btn danger" onClick={() => void cancelAssignment(assignment)} disabled={!canManage || saving || assignment.status === "cancelled"}>إلغاء</button>
                  </div>
                </div>
              );
            })}
            {!assignments.length && <p className="shift-control-empty">لا توجد تعيينات شفتات لهذه الموظفة.</p>}
          </div>
        </article>

        <article className="shift-control-list-card shift-control-list-card--wide">
          <h4>استثناءات الجدول</h4>
          <div className="shift-control-list">
            {exceptions.map((exception) => (
              <div className="shift-control-row" key={exception.id}>
                <div><strong>{exceptionTypeLabel(exception.exceptionType)}</strong><span>{exception.dateFrom} ← {exception.dateTo} · {exception.shiftName || formatShiftWindow(exception)}</span></div>
                <span className={exception.status === "approved" ? "shift-badge success" : "shift-badge muted"}>{exception.status === "approved" ? "معتمد" : exception.status}</span>
                <button type="button" className="exp-btn danger" onClick={() => void cancelException(exception)} disabled={!canManage || saving || exception.status !== "approved"}>إلغاء</button>
              </div>
            ))}
            {!exceptions.length && <p className="shift-control-empty">لا توجد استثناءات لهذا الموظفة.</p>}
          </div>
        </article>
        <article className="shift-control-list-card shift-control-list-card--wide">
          <h4>تسويات بعد إقفال الراتب</h4>
          <div className="shift-control-list">
            {payrollAdjustments.map((adjustment) => (
              <div className="shift-control-row" key={adjustment.id}>
                <div><strong>{adjustment.changeType}</strong><span>{adjustment.dateFrom} ← {adjustment.dateTo} · {adjustment.reason || "بدون سبب"}</span></div>
                <span className="shift-badge muted">{adjustment.status}</span>
              </div>
            ))}
            {!payrollAdjustments.length && <p className="shift-control-empty">لا توجد تسويات بعد إقفال الراتب لهذه الموظفة.</p>}
          </div>
        </article>

      </div>
    </section>
  );
}
