import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { CoreHrService } from "../../services/CoreHrService";
import type {
  CoreResolvedShift,
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
  employeeUid?: string;
  employeeIds?: string[];
  employeeName?: string;
  canManage: boolean;
};

type TemplateForm = {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: string;
  lateGraceMinutes: string;
  earlyLeaveGraceMinutes: string;
  overtimeAfterMinutes: string;
  active: boolean;
};

type AssignmentForm = {
  id: string;
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

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function isFullShiftIdentifier(value: unknown) {
  return /^[A-Za-z0-9_-]{20,}$/.test(cleanText(value));
}

function readAliasValue(row: unknown, camelKey: string, snakeKey: string = camelKey) {
  const record = (row || {}) as Record<string, unknown>;
  return record[camelKey] ?? record[snakeKey];
}

function parseSnapshot(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function templateForAssignment(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const templateId = cleanText(assignment?.shiftTemplateId || (assignment as Record<string, unknown> | null | undefined)?.shift_template_id);
  return templates.find((template) => template.id === templateId) || null;
}

function assignmentShiftName(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const template = templateForAssignment(assignment, templates);
  const snapshot = parseSnapshot(assignment?.snapshotJson || (assignment as Record<string, unknown> | null | undefined)?.snapshot_json);
  return cleanText(assignment?.shiftName || (assignment as Record<string, unknown> | null | undefined)?.shift_name || template?.name || snapshot.name || snapshot.shiftName || snapshot.shift_name);
}

function assignmentShiftRecord(assignment: CoreShiftAssignment | null | undefined, templates: CoreShiftTemplate[]) {
  const template = templateForAssignment(assignment, templates);
  const snapshot = parseSnapshot(assignment?.snapshotJson || (assignment as Record<string, unknown> | null | undefined)?.snapshot_json);
  return { ...(snapshot || {}), ...(template || {}), ...(assignment || {}) } as Record<string, unknown>;
}

function isAssignmentActiveOnDate(assignment: CoreShiftAssignment, dateKey: string) {
  const status = cleanText(assignment.status);
  const fromDate = cleanText(assignment.effectiveFrom || (assignment as Record<string, unknown>).effective_from);
  const toDate = cleanText(assignment.effectiveTo || (assignment as Record<string, unknown>).effective_to);
  if (status === "cancelled") return false;
  if (!fromDate) return false;
  return fromDate <= dateKey && (!toDate || toDate >= dateKey);
}

function resolvedShiftRank(row?: CoreResolvedShift | null) {
  const source = cleanText(row?.source).toLowerCase();
  const exceptionType = cleanText(row?.exceptionType || row?.exception_type).toLowerCase();
  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;
  if (source === "assignment") return 3;
  if (source && source !== "none") return 2;
  return 0;
}

function pickBestResolvedShift(rows: Array<CoreResolvedShift | null | undefined>) {
  return rows
    .filter(Boolean)
    .sort((left, right) => resolvedShiftRank(right) - resolvedShiftRank(left))[0] || null;
}


function numberInput(value: unknown, fallback = "0") {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(number) : fallback;
}

function readNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatWindow(row?: Partial<CoreShiftTemplate | CoreShiftAssignment | CoreScheduleException | CoreResolvedShift> | null) {
  const record = row as Record<string, unknown> | null | undefined;
  const start = cleanText(record?.startTime || record?.start_time || record?.templateStartTime || record?.template_start_time);
  const end = cleanText(record?.endTime || record?.end_time || record?.templateEndTime || record?.template_end_time);
  if (!start && !end) return "بدون وقت";
  return `${start || "--:--"} - ${end || "--:--"}`;
}

function statusLabel(value: unknown) {
  const status = cleanText(value);
  if (status === "published") return "منشور";
  if (status === "draft") return "مسودة";
  if (status === "cancelled") return "ملغي";
  if (status === "approved") return "معتمد";
  return status || "غير محدد";
}

function assignmentStatus(assignment: CoreShiftAssignment) {
  const today = todayKey();
  const status = cleanText(assignment.status);
  if (status === "cancelled") return "ملغي";
  if (assignment.effectiveTo && assignment.effectiveTo < today) return "منتهي";
  if (assignment.effectiveFrom > today) return "مجدول";
  if (status === "published") return "نشط";
  return statusLabel(status);
}

function assignmentTone(assignment: CoreShiftAssignment): "success" | "gold" | "danger" | "default" {
  const label = assignmentStatus(assignment);
  if (label === "نشط") return "success";
  if (label === "مجدول") return "gold";
  if (label === "ملغي") return "danger";
  return "default";
}

function exceptionTypeLabel(type: string) {
  if (type === "shift") return "شفت بديل";
  if (type === "off") return "راحة";
  if (type === "custom") return "وقت مخصص";
  return type || "استثناء";
}

function emptyTemplateForm(): TemplateForm {
  return {
    id: "",
    name: "",
    code: "",
    startTime: "10:00",
    endTime: "18:00",
    breakMinutes: "0",
    lateGraceMinutes: "0",
    earlyLeaveGraceMinutes: "0",
    overtimeAfterMinutes: "0",
    active: true,
  };
}

function emptyAssignmentForm(): AssignmentForm {
  return {
    id: "",
    shiftTemplateId: "",
    effectiveFrom: todayKey(),
    effectiveTo: "",
    assignmentType: "permanent",
    replaceOverlaps: true,
    reason: "تعيين شفت من إدارة الموظفات",
  };
}

function emptyExceptionForm(): ExceptionForm {
  const today = todayKey();
  return {
    dateFrom: today,
    dateTo: today,
    exceptionType: "shift",
    shiftTemplateId: "",
    startTime: "10:00",
    endTime: "18:00",
    note: "استثناء من إدارة الموظفات",
  };
}

export default function ShiftControlSection({
  isVisible,
  employeeId,
  employeeUid = "",
  employeeIds = [],
  employeeName,
  canManage,
}: ShiftControlSectionProps) {
  const [templates, setTemplates] = useState<CoreShiftTemplate[]>([]);
  const [assignments, setAssignments] = useState<CoreShiftAssignment[]>([]);
  const [exceptions, setExceptions] = useState<CoreScheduleException[]>([]);
  const [locks, setLocks] = useState<CoreShiftPayrollPeriodLock[]>([]);
  const [adjustments, setAdjustments] = useState<CoreShiftPayrollAdjustment[]>([]);
  const [resolvedDate, setResolvedDate] = useState(todayKey());
  const [resolvedShift, setResolvedShift] = useState<CoreResolvedShift | null>(null);
  const [preview, setPreview] = useState<CoreShiftChangePreview | null>(null);
  const [allowLockedPeriodAdjustment, setAllowLockedPeriodAdjustment] = useState(false);
  const [templateForm, setTemplateForm] = useState<TemplateForm>(() => emptyTemplateForm());
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>(() => emptyAssignmentForm());
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>(() => emptyExceptionForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const shiftEmployeeIdsKey = uniqueCleanTexts([employeeUid, ...employeeIds, employeeId]).join("|");
  const shiftEmployeeIds = useMemo(
    () => shiftEmployeeIdsKey.split("|").filter(Boolean),
    [shiftEmployeeIdsKey]
  );

  const activeTemplates = useMemo(() => templates.filter((template) => boolish(template.active)), [templates]);
  const templateOptions = useMemo(() => {
    const source = activeTemplates.length ? activeTemplates : templates;
    return source.map((template) => ({
      value: template.id,
      label: `${template.name || template.id} - ${formatWindow(template)}`,
    }));
  }, [activeTemplates, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === assignmentForm.shiftTemplateId) || null,
    [assignmentForm.shiftTemplateId, templates],
  );

  const openAssignment = useMemo(
    () => assignments.find((assignment) => isAssignmentActiveOnDate(assignment, resolvedDate)) || null,
    [assignments, resolvedDate],
  );

  const targetShiftEmployeeId = useMemo(() => {
    const currentAssignmentEmployeeId = cleanText(openAssignment?.employeeId || (openAssignment as Record<string, unknown> | null)?.employee_id);
    return currentAssignmentEmployeeId || shiftEmployeeIds.find(isFullShiftIdentifier) || shiftEmployeeIds[0] || employeeId;
  }, [employeeId, openAssignment, shiftEmployeeIds]);

  const load = useCallback(async () => {
    if (!isVisible || !shiftEmployeeIds.length) return;
    setLoading(true);
    setError("");
    try {
      const [templateRows, assignmentGroups, exceptionGroups, lockRows, adjustmentGroups, resolvedRows] = await Promise.all([
        CoreHrService.listShiftTemplates({ active: "all" }),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listShiftAssignments({ employeeId: id }).catch(() => [] as CoreShiftAssignment[]))),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listScheduleExceptions({ employeeId: id }).catch(() => [] as CoreScheduleException[]))),
        CoreHrService.listShiftPayrollPeriodLocks(),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.listShiftPayrollAdjustments({ employeeId: id }).catch(() => [] as CoreShiftPayrollAdjustment[]))),
        Promise.all(shiftEmployeeIds.map((id) => CoreHrService.resolveEmployeeShift(id, resolvedDate).catch(() => null))),
      ]);

      const mergeById = <T extends { id: string }>(groups: T[][]) => Array.from(
        new Map(groups.flat().filter((row) => cleanText(row.id)).map((row) => [row.id, row])).values()
      );

      setTemplates(templateRows);
      setAssignments(mergeById(assignmentGroups));
      setExceptions(mergeById(exceptionGroups));
      setLocks(lockRows);
      setAdjustments(mergeById(adjustmentGroups));
      setResolvedShift(pickBestResolvedShift(resolvedRows));

      const firstTemplateId = templateRows.find((template) => boolish(template.active))?.id || templateRows[0]?.id || "";
      setAssignmentForm((current) => ({ ...current, shiftTemplateId: current.shiftTemplateId || firstTemplateId }));
      setExceptionForm((current) => ({ ...current, shiftTemplateId: current.shiftTemplateId || firstTemplateId }));
    } catch (err) {
      console.warn("shift control load failed", err);
      setError("تعذر تحميل الشفتات من Core.");
    } finally {
      setLoading(false);
    }
  }, [isVisible, resolvedDate, shiftEmployeeIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewAssignment = async () => {
    if (!targetShiftEmployeeId || !assignmentForm.effectiveFrom) return null;
    const result = await CoreHrService.previewShiftChange({
      employeeId: targetShiftEmployeeId,
      changeType: "assignment",
      effectiveFrom: assignmentForm.effectiveFrom,
      effectiveTo: assignmentForm.effectiveTo || assignmentForm.effectiveFrom,
    });
    setPreview(result);
    return result;
  };

  const previewException = async () => {
    if (!targetShiftEmployeeId || !exceptionForm.dateFrom) return null;
    const result = await CoreHrService.previewShiftChange({
      employeeId: targetShiftEmployeeId,
      changeType: "exception",
      dateFrom: exceptionForm.dateFrom,
      dateTo: exceptionForm.dateTo || exceptionForm.dateFrom,
    });
    setPreview(result);
    return result;
  };

  const previewAllowsSave = (result: CoreShiftChangePreview | null) => {
    const lockedCount = readNumber(result?.lockedPeriodsCount ?? result?.locked_periods_count);
    if (lockedCount > 0 && !allowLockedPeriodAdjustment) {
      setError("يوجد فترة رواتب مقفلة. فعّل خيار تسجيل تسوية بعد الإقفال قبل الحفظ.");
      return false;
    }
    return true;
  };

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
        name: templateForm.name.trim(),
        code: templateForm.code.trim() || null,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        crossesMidnight: false,
        breakMinutes: Number(templateForm.breakMinutes || 0),
        breakPaid: false,
        lateGraceMinutes: Number(templateForm.lateGraceMinutes || 0),
        earlyLeaveGraceMinutes: Number(templateForm.earlyLeaveGraceMinutes || 0),
        overtimeAfterMinutes: Number(templateForm.overtimeAfterMinutes || 0),
        active: templateForm.active,
        reason: "تحديث قالب شفت من مساحة الموظفة V2",
      });
      setTemplateForm(emptyTemplateForm());
      setMessage("تم حفظ قالب الشفت.");
      await load();
    } catch (err) {
      console.warn("save shift template failed", err);
      setError("تعذر حفظ قالب الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const editTemplate = (template: CoreShiftTemplate) => {
    setTemplateForm({
      id: template.id,
      name: template.name || "",
      code: template.code || "",
      startTime: template.startTime || "10:00",
      endTime: template.endTime || "18:00",
      breakMinutes: numberInput(template.breakMinutes),
      lateGraceMinutes: numberInput(template.lateGraceMinutes),
      earlyLeaveGraceMinutes: numberInput(template.earlyLeaveGraceMinutes),
      overtimeAfterMinutes: numberInput(template.overtimeAfterMinutes),
      active: boolish(template.active),
    });
  };

  const editAssignment = (assignment: CoreShiftAssignment) => {
    setAssignmentForm({
      id: assignment.id,
      shiftTemplateId: cleanText(assignment.shiftTemplateId || (assignment as Record<string, unknown>).shift_template_id),
      effectiveFrom: cleanText(assignment.effectiveFrom || (assignment as Record<string, unknown>).effective_from) || todayKey(),
      effectiveTo: cleanText(assignment.effectiveTo || (assignment as Record<string, unknown>).effective_to),
      assignmentType: cleanText(assignment.assignmentType || (assignment as Record<string, unknown>).assignment_type) === "temporary" ? "temporary" : "permanent",
      replaceOverlaps: true,
      reason: cleanText(assignment.reason) || "تعديل تعيين شفت من إدارة الموظفات",
    });
    setPreview(null);
    setMessage("تم تحميل تعيين الشفت للتعديل. عدّل الحقول ثم اضغط حفظ التعديل.");
  };

  const saveAssignment = async () => {
    if (!canManage) return;
    if (!assignmentForm.shiftTemplateId || !assignmentForm.effectiveFrom || !assignmentForm.reason.trim()) {
      setError("الشفت وتاريخ البداية وسبب التغيير مطلوبة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await previewAssignment();
      if (!previewAllowsSave(result)) return;
      const payload = {
        employeeId: targetShiftEmployeeId,
        shiftTemplateId: assignmentForm.shiftTemplateId,
        effectiveFrom: assignmentForm.effectiveFrom,
        effectiveTo: assignmentForm.effectiveTo || null,
        assignmentType: assignmentForm.assignmentType,
        status: "published",
        replaceOverlaps: true,
        reason: assignmentForm.reason,
        snapshot: selectedTemplate || {},
        allowLockedPeriodAdjustment,
      };
      if (assignmentForm.id) {
        await CoreHrService.updateShiftAssignment(assignmentForm.id, payload);
        setMessage("تم تعديل تعيين الشفت للموظفة.");
      } else {
        await CoreHrService.createShiftAssignment(payload);
        setMessage("تم تعيين الشفت للموظفة.");
      }
      setAssignmentForm(emptyAssignmentForm());
      await load();
    } catch (err) {
      console.warn("save shift assignment failed", err);
      setError("تعذر حفظ تعيين الشفت. راجع التداخلات أو الصلاحيات.");
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    if (!window.confirm(`إلغاء تعيين الشفت ${assignment.shiftName || "الحالي"}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.cancelShiftAssignment(assignment.id, "إلغاء من مساحة الموظفة V2", { allowLockedPeriodAdjustment });
      setMessage("تم إلغاء تعيين الشفت.");
      await load();
    } catch (err) {
      console.warn("cancel assignment failed", err);
      setError("تعذر إلغاء تعيين الشفت.");
    } finally {
      setSaving(false);
    }
  };

  const closeAssignment = async (assignment: CoreShiftAssignment) => {
    if (!canManage) return;
    if (!window.confirm(`إنهاء تعيين الشفت بتاريخ ${todayKey()}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateShiftAssignment(assignment.id, {
        effectiveTo: todayKey(),
        reason: "إنهاء شفت من مساحة الموظفة V2",
        allowLockedPeriodAdjustment,
      });
      setMessage("تم إنهاء الشفت.");
      await load();
    } catch (err) {
      console.warn("close assignment failed", err);
      setError("تعذر إنهاء الشفت.");
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
      setError("اختر شفت بديل.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await previewException();
      if (!previewAllowsSave(result)) return;
      await CoreHrService.createScheduleException({
        employeeId: targetShiftEmployeeId,
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
      setMessage("تم حفظ الاستثناء.");
      await load();
    } catch (err) {
      console.warn("create exception failed", err);
      setError("تعذر حفظ الاستثناء.");
    } finally {
      setSaving(false);
    }
  };

  const cancelException = async (exception: CoreScheduleException) => {
    if (!canManage) return;
    if (!window.confirm(`إلغاء استثناء ${exception.dateFrom}؟`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreHrService.updateScheduleException(exception.id, {
        status: "cancelled",
        enabled: false,
        note: "إلغاء من مساحة الموظفة V2",
        allowLockedPeriodAdjustment,
      });
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

  const source = cleanText(resolvedShift?.source);
  const resolvedExceptionType = cleanText(resolvedShift?.exceptionType || resolvedShift?.exception_type);
  const resolvedShiftName = cleanText(resolvedShift?.shiftName || resolvedShift?.shift_name) || assignmentShiftName(openAssignment, templates);
  const openAssignmentName = assignmentShiftName(openAssignment, templates);
  const openAssignmentWindow = openAssignment ? formatWindow(assignmentShiftRecord(openAssignment, templates)) : "لا يوجد";
  const selectedTemplateWindow = selectedTemplate ? formatWindow(selectedTemplate) : "اختر شفت";
  const resolvedLabel = source === "exception" ? "استثناء يومي" : source === "assignment" ? "شفت محدد" : "جدول الدوام";
  const resolvedStatus = source === "exception" && resolvedExceptionType === "off"
    ? "مغلق اليوم"
    : source === "none" || !source
      ? "لا يوجد شفت Core"
      : "مطبق";
  const nextException = exceptions
    .filter((exception) => cleanText(exception.status) !== "cancelled")
    .filter((exception) => cleanText(exception.dateFrom || (exception as Record<string, unknown>).date_from) >= todayKey())
    .sort((left, right) => cleanText(left.dateFrom || (left as Record<string, unknown>).date_from).localeCompare(cleanText(right.dateFrom || (right as Record<string, unknown>).date_from)))[0] || null;

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-live-shifts">
      <WorkspaceTabHeaderV2
        title="الشفتات"
        description="قوالب الشفتات، تعيينات الموظفة، الاستثناءات، ومعاينة أثر التعديل مرتبطة فعليًا ببيانات Core."
        badge={<WorkspaceStatusBadgeV2 tone={canManage ? "success" : "gold"}>{canManage ? "قابل للتعديل" : "عرض فقط"}</WorkspaceStatusBadgeV2>}
      />

      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" /> : null}
      {message ? <WorkspaceNoticeV2 title="تم التحديث" description={message} tone="success" /> : null}

      <div className="dsv2-grid dsv2-grid--metrics">
        <WorkspaceMetricV2 label="قوالب الشفت" value={templates.length} note={`${activeTemplates.length} نشطة`} tone="dark" />
        <WorkspaceMetricV2 label="التعيينات" value={assignments.length} note={openAssignment ? `النشط: ${assignmentShiftName(openAssignment, templates) || "شفت محفوظ"}` : "لا يوجد شفت نشط"} tone={openAssignment ? "success" : "neutral"} />
        <WorkspaceMetricV2 label="الاستثناءات" value={exceptions.length} note="مرتبطة بالموظفة" tone="gold" />
        <WorkspaceMetricV2 label="تسويات مقفلة" value={adjustments.length} note={`${locks.length} فترات رواتب مقفلة`} tone={locks.length ? "danger" : "neutral"} />
      </div>

      <WorkspaceCardV2
        title="الشفت الحالي / المصدر الفعلي"
        description="يعرض الشفت المطبق فعليًا حسب الاستثناءات والتعيينات قبل الاعتماد على جدول الدوام."
        actions={<button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void load()} disabled={loading || saving}>تحديث</button>}
      >
        <div className="dsv2-filter-bar">
          <DashboardFieldV2 id="shift-resolved-date" label="التاريخ">
            <DashboardDatePickerV2 id="shift-resolved-date" value={resolvedDate} onChange={setResolvedDate} disabled={loading || saving} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-resolved-employee" label="الموظفة">
            <input id="shift-resolved-employee" className="dsv2-input" value={employeeName || employeeId} readOnly />
          </DashboardFieldV2>
        </div>
        <div className="dsv2-grid dsv2-grid--metrics">
          <WorkspaceMetricV2 label="المصدر" value={resolvedLabel} note={`تاريخ الفحص: ${resolvedDate}`} tone={source === "exception" ? "gold" : source === "assignment" ? "success" : "neutral"} />
          <WorkspaceMetricV2 label="الشفت الحالي" value={resolvedShiftName || (source === "none" || !source ? "لا يوجد" : "شفت محفوظ")} note={openAssignment ? `${openAssignment.effectiveFrom} - ${openAssignment.effectiveTo || "مفتوح"}` : resolvedStatus} tone={source === "exception" ? "gold" : source === "assignment" ? "success" : "neutral"} />
          <WorkspaceMetricV2 label="الوقت الفعلي" value={source === "assignment" && openAssignment ? openAssignmentWindow : formatWindow(resolvedShift)} note="يُستخدم في الحضور والخصم" tone="dark" />
          <WorkspaceMetricV2 label="أقرب استثناء قادم" value={cleanText(nextException?.dateFrom || (nextException as Record<string, unknown> | null)?.date_from) || "لا يوجد"} note={nextException ? exceptionTypeLabel(cleanText(nextException.exceptionType || (nextException as Record<string, unknown>).exception_type)) : "لا توجد استثناءات قادمة"} tone={nextException ? "gold" : "neutral"} />
          <WorkspaceMetricV2 label="سماحية التأخير" value={`${readNumber(resolvedShift?.lateGraceMinutes ?? resolvedShift?.late_grace_minutes)} د`} note="لا تحتسب على الموظفة ولا تؤثر على الراتب" tone="gold" />
          <WorkspaceMetricV2 label="سماحية الخروج المبكر" value={`${readNumber(resolvedShift?.earlyLeaveGraceMinutes ?? resolvedShift?.early_leave_grace_minutes)} د`} note="تخصم فقط بعد انتهاء السماحية" tone="gold" />
        </div>
        <WorkspaceNoticeV2
          title="ربط الحضور والراتب بالشفت"
          description="أي حضور داخل سماحية التأخير في قالب الشفت لا يسجل كتأخير فعلي، ولا يدخل في أثر الراتب. يبدأ الاحتساب بعد انتهاء السماحية فقط."
          tone="gold"
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="معاينة أثر التعديل" description="افحص التداخلات وفترات الرواتب المقفلة قبل الحفظ.">
        <div className="dsv2-grid dsv2-grid--metrics">
          <WorkspaceMetricV2 label="الشفت الحالي" value={openAssignmentName || "لا يوجد"} note={openAssignment ? `${openAssignment.effectiveFrom} - ${openAssignment.effectiveTo || "مفتوح"}` : "لا يوجد تعيين منشور"} tone={openAssignment ? "success" : "neutral"} />
          <WorkspaceMetricV2 label="وقت الشفت الحالي" value={openAssignmentWindow} note={openAssignment ? `${readNumber(assignmentShiftRecord(openAssignment, templates).lateGraceMinutes ?? assignmentShiftRecord(openAssignment, templates).late_grace_minutes)} تأخير / ${readNumber(assignmentShiftRecord(openAssignment, templates).earlyLeaveGraceMinutes ?? assignmentShiftRecord(openAssignment, templates).early_leave_grace_minutes)} خروج` : "-"} tone="dark" />
          <WorkspaceMetricV2 label="الشفت المحدد للتعيين" value={selectedTemplate?.name || "غير محدد"} note={selectedTemplateWindow} tone={selectedTemplate ? "gold" : "neutral"} />
          <WorkspaceMetricV2 label="النطاق" value={`${preview?.dateFrom || preview?.date_from || "-"} ← ${preview?.dateTo || preview?.date_to || "-"}`} />
          <WorkspaceMetricV2 label="الأيام المتأثرة" value={readNumber(preview?.affectedDays ?? preview?.affected_days)} tone="gold" />
          <WorkspaceMetricV2 label="تداخلات الشفت" value={readNumber(preview?.overlappingAssignmentsCount ?? preview?.overlapping_assignments_count)} tone="danger" />
          <WorkspaceMetricV2 label="فترات مقفلة" value={readNumber(preview?.lockedPeriodsCount ?? preview?.locked_periods_count)} tone={readNumber(preview?.lockedPeriodsCount ?? preview?.locked_periods_count) ? "danger" : "success"} />
        </div>
        <div className="dsv2-cluster">
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void previewAssignment()} disabled={!canManage || saving}>معاينة التعيين الجديد</button>
          <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => void previewException()} disabled={!canManage || saving}>معاينة الاستثناء</button>
        </div>
        <WorkspaceSwitchV2
          checked={allowLockedPeriodAdjustment}
          onChange={setAllowLockedPeriodAdjustment}
          disabled={!canManage || saving}
          label="السماح بتسوية فترة مقفلة"
          description="يفعل فقط عند تعديل يوم داخل فترة رواتب مقفلة."
        />
      </WorkspaceCardV2>

      <div className="dsv2-grid dsv2-grid--two">
        <WorkspaceCardV2 title={templateForm.id ? "تعديل قالب شفت" : "إنشاء قالب شفت"} description="القالب مشترك ويمكن تعيينه للموظفات.">
          <div className="dsv2-form-grid">
            <DashboardFieldV2 id="shift-template-name" label="اسم الشفت" required>
              <input id="shift-template-name" className="dsv2-input" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} disabled={!canManage || saving} placeholder="الشفت الصباحي" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-template-code" label="الكود">
              <input id="shift-template-code" className="dsv2-input" value={templateForm.code} onChange={(event) => setTemplateForm((current) => ({ ...current, code: event.target.value }))} disabled={!canManage || saving} placeholder="AM" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-template-start" label="البداية">
              <input id="shift-template-start" className="dsv2-input" type="time" value={templateForm.startTime} onChange={(event) => setTemplateForm((current) => ({ ...current, startTime: event.target.value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-template-end" label="النهاية">
              <input id="shift-template-end" className="dsv2-input" type="time" value={templateForm.endTime} onChange={(event) => setTemplateForm((current) => ({ ...current, endTime: event.target.value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-template-late" label="سماح التأخير">
              <input id="shift-template-late" className="dsv2-input" type="number" min="0" value={templateForm.lateGraceMinutes} onChange={(event) => setTemplateForm((current) => ({ ...current, lateGraceMinutes: event.target.value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-template-early" label="سماح الخروج المبكر">
              <input id="shift-template-early" className="dsv2-input" type="number" min="0" value={templateForm.earlyLeaveGraceMinutes} onChange={(event) => setTemplateForm((current) => ({ ...current, earlyLeaveGraceMinutes: event.target.value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
          </div>
          <WorkspaceSwitchV2 checked={templateForm.active} onChange={(value) => setTemplateForm((current) => ({ ...current, active: value }))} disabled={!canManage || saving} label="القالب نشط" />
          <div className="dsv2-cluster">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setTemplateForm(emptyTemplateForm())} disabled={saving}>تفريغ</button>
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveTemplate()} disabled={!canManage || saving}>حفظ القالب</button>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title={assignmentForm.id ? "تعديل تعيين الشفت" : "تعيين شفت للموظفة"} description="تعيين دائم أو مؤقت بتاريخ بداية ونهاية.">
          <div className="dsv2-form-grid">
            <DashboardFieldV2 id="shift-assignment-template" label="قالب الشفت" required>
              <DashboardSelectV2 id="shift-assignment-template" options={templateOptions} value={assignmentForm.shiftTemplateId} onChange={(value) => setAssignmentForm((current) => ({ ...current, shiftTemplateId: value }))} disabled={!canManage || saving || !templateOptions.length} placeholder="اختر الشفت" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-type" label="نوع التعيين">
              <DashboardSelectV2
                id="shift-assignment-type"
                options={[{ value: "permanent", label: "دائم" }, { value: "temporary", label: "مؤقت" }]}
                value={assignmentForm.assignmentType}
                onChange={(value) => setAssignmentForm((current) => ({ ...current, assignmentType: value === "temporary" ? "temporary" : "permanent" }))}
                disabled={!canManage || saving}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-from" label="يبدأ من" required>
              <DashboardDatePickerV2 id="shift-assignment-from" value={assignmentForm.effectiveFrom} onChange={(value) => setAssignmentForm((current) => ({ ...current, effectiveFrom: value }))} disabled={!canManage || saving} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="shift-assignment-to" label="ينتهي في">
              <DashboardDatePickerV2 id="shift-assignment-to" value={assignmentForm.effectiveTo} onChange={(value) => setAssignmentForm((current) => ({ ...current, effectiveTo: value }))} disabled={!canManage || saving} clearable />
            </DashboardFieldV2>
          </div>
          <DashboardFieldV2 id="shift-assignment-reason" label="سبب التغيير" required>
            <input id="shift-assignment-reason" className="dsv2-input" value={assignmentForm.reason} onChange={(event) => setAssignmentForm((current) => ({ ...current, reason: event.target.value }))} disabled={!canManage || saving} />
          </DashboardFieldV2>
          <div className="dsv2-cluster">
            {assignmentForm.id ? <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setAssignmentForm(emptyAssignmentForm())} disabled={saving}>إلغاء التعديل</button> : null}
            <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void saveAssignment()} disabled={!canManage || saving || !templateOptions.length}>{assignmentForm.id ? "حفظ التعديل" : "تعيين الشفت"}</button>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="استثناءات الشفت" description="راحة، شفت بديل، أو وقت مخصص لفترة محددة.">
        <div className="dsv2-form-grid">
          <DashboardFieldV2 id="shift-exception-type" label="نوع الاستثناء">
            <DashboardSelectV2
              id="shift-exception-type"
              options={[{ value: "shift", label: "شفت بديل" }, { value: "custom", label: "وقت مخصص" }, { value: "off", label: "راحة" }]}
              value={exceptionForm.exceptionType}
              onChange={(value) => setExceptionForm((current) => ({ ...current, exceptionType: value === "custom" ? "custom" : value === "off" ? "off" : "shift" }))}
              disabled={!canManage || saving}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-exception-template" label="الشفت البديل">
            <DashboardSelectV2 id="shift-exception-template" options={templateOptions} value={exceptionForm.shiftTemplateId} onChange={(value) => setExceptionForm((current) => ({ ...current, shiftTemplateId: value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "shift" || !templateOptions.length} placeholder="اختر الشفت" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-exception-from" label="من تاريخ" required>
            <DashboardDatePickerV2 id="shift-exception-from" value={exceptionForm.dateFrom} onChange={(value) => setExceptionForm((current) => ({ ...current, dateFrom: value, dateTo: current.dateTo || value }))} disabled={!canManage || saving} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-exception-to" label="إلى تاريخ" required>
            <DashboardDatePickerV2 id="shift-exception-to" value={exceptionForm.dateTo} onChange={(value) => setExceptionForm((current) => ({ ...current, dateTo: value }))} disabled={!canManage || saving} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-exception-start" label="بداية مخصصة">
            <input id="shift-exception-start" className="dsv2-input" type="time" value={exceptionForm.startTime} onChange={(event) => setExceptionForm((current) => ({ ...current, startTime: event.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="shift-exception-end" label="نهاية مخصصة">
            <input id="shift-exception-end" className="dsv2-input" type="time" value={exceptionForm.endTime} onChange={(event) => setExceptionForm((current) => ({ ...current, endTime: event.target.value }))} disabled={!canManage || saving || exceptionForm.exceptionType !== "custom"} />
          </DashboardFieldV2>
        </div>
        <DashboardFieldV2 id="shift-exception-note" label="ملاحظة">
          <input id="shift-exception-note" className="dsv2-input" value={exceptionForm.note} onChange={(event) => setExceptionForm((current) => ({ ...current, note: event.target.value }))} disabled={!canManage || saving} />
        </DashboardFieldV2>
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={() => void createException()} disabled={!canManage || saving}>حفظ الاستثناء</button>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="قوالب الشفتات" description="القوالب الفعلية المحملة من Core.">
        <WorkspaceTableV2
          headers={["القالب", "الوقت", "السماح", "الحالة", "الإجراء"]}
          rows={templates.map((template) => [
            <strong key="name">{template.name}</strong>,
            formatWindow(template),
            `${readNumber(template.lateGraceMinutes)} تأخير / ${readNumber(template.earlyLeaveGraceMinutes)} خروج`,
            <WorkspaceStatusBadgeV2 key="status" tone={boolish(template.active) ? "success" : "danger"}>{boolish(template.active) ? "نشط" : "متوقف"}</WorkspaceStatusBadgeV2>,
            <button key="edit" type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editTemplate(template)} disabled={!canManage || saving}>تعديل</button>,
          ])}
          emptyText="لا توجد قوالب شفتات."
        />
      </WorkspaceCardV2>

      <div className="dsv2-grid dsv2-grid--two">
        <WorkspaceCardV2 title="تعيينات الموظفة" description="كل التعيينات الحالية والتاريخية.">
          <WorkspaceTableV2
            headers={["الشفت", "الوقت", "الفترة", "الحالة", "الإجراء"]}
            rows={assignments.map((assignment) => [
              <strong key="name">{assignmentShiftName(assignment, templates) || assignment.shiftTemplateId || "شفت"}</strong>,
              formatWindow(assignmentShiftRecord(assignment, templates)),
              `${assignment.effectiveFrom} - ${assignment.effectiveTo || "مفتوح"}`,
              <WorkspaceStatusBadgeV2 key="status" tone={assignmentTone(assignment)}>{assignmentStatus(assignment)}</WorkspaceStatusBadgeV2>,
              <div key="actions" className="dsv2-cluster">
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => editAssignment(assignment)} disabled={!canManage || saving || assignmentStatus(assignment) === "ملغي"}>تعديل</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void closeAssignment(assignment)} disabled={!canManage || saving || assignmentStatus(assignment) !== "نشط"}>إنهاء</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void cancelAssignment(assignment)} disabled={!canManage || saving || assignmentStatus(assignment) === "ملغي"}>إلغاء</button>
              </div>,
            ])}
            emptyText="لا توجد تعيينات شفت لهذه الموظفة."
          />
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="استثناءات الموظفة" description="الأولوية للاستثناء قبل الشفت الأساسي.">
          <WorkspaceTableV2
            headers={["النوع", "الفترة", "الوقت", "الحالة", "الإجراء"]}
            rows={exceptions.map((exception) => [
              <strong key="type">{exceptionTypeLabel(exception.exceptionType)}</strong>,
              `${exception.dateFrom} - ${exception.dateTo}`,
              exception.exceptionType === "off" ? "راحة" : formatWindow(exception),
              <WorkspaceStatusBadgeV2 key="status" tone={exception.status === "cancelled" ? "danger" : "success"}>{statusLabel(exception.status)}</WorkspaceStatusBadgeV2>,
              <button key="cancel" type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void cancelException(exception)} disabled={!canManage || saving || exception.status === "cancelled"}>إلغاء</button>,
            ])}
            emptyText="لا توجد استثناءات شفت لهذه الموظفة."
          />
        </WorkspaceCardV2>
      </div>
    </div>
  );
}
