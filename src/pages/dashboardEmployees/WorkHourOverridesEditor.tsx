import { DashboardTimeInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useState, type RefObject } from "react";

import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceHelpButtonV2,
  WorkspaceHelpDrawerV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
  type WorkspaceHelpTopicV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import {
  HIJRI_WEEKDAY_SHORT,
  WEEKDAY_OPTIONS,
  countIsoDateRangeDays,
  formatArabicInteger,
  formatIsoDateRange,
  formatWindow,
  fmtIsoDate,
  normalizeLeaveUntil,
  normalizeTimeHHMM,
} from "./shared";

const WORK_HOUR_OVERRIDE_HELP_TOPICS = {
  overview: {
    title: "استثناءات الدوام",
    description: "تعديل مؤقت لساعات الموظفة أو إغلاق أيام محددة مع إبقاء جدولها الأسبوعي الأساسي كما هو.",
    purpose: "هذا القسم مخصص للتغييرات المؤقتة التي لها بداية ونهاية واضحة. الاستثناء لا يمحو جدول الموظفة ولا يغير قالب الشفت العام؛ بل يعلو عليه داخل الفترة المحددة فقط. يمكنه تحديد ساعات بديلة، إغلاق أيام معتمدًا، أو تطبيق التغيير على أيام معينة داخل نطاق طويل.",
    useWhen: "دوام رمضان، تدريب، مناسبة خاصة، صيانة أو إغلاق فرع، تعديل ساعات مؤقت، أو تغيير يخص موظفة واحدة خلال فترة محددة.",
    notFor: "إنشاء جدول أسبوعي دائم، تغيير يوم الراحة المتكرر، أو تسجيل إجازة سنوية/مرضية من رصيد الموظفة.",
    example: {
      title: "دوام رمضان لمدة شهر",
      situation: "جدول الموظفة الأساسي 3:00 م إلى 11:00 م، لكن من 1 إلى 30 رمضان تعمل 2:00 م إلى 10:00 م.",
      action: "حدد فترة رمضان، فعّل «الموظفة تعمل في هذه الفترة»، أدخل 2:00 م و10:00 م، طبّق على أيام العمل المطلوبة، أضف ملاحظة «دوام رمضان»، ثم راجع المعاينة وأضف الاستثناء.",
      result: "يستخدم الحضور والراتب ساعات 2:00 م إلى 10:00 م داخل الفترة فقط، وبعد انتهائها يعود النظام تلقائيًا إلى جدول 3:00 م إلى 11:00 م.",
    },
    steps: [
      { title: "حدد الفترة", description: "اختر تاريخ البداية والنهاية بالتقويم الميلادي أو الهجري." },
      { title: "حدد نوع الاستثناء", description: "اختر دوامًا بساعات بديلة أو إغلاقًا كاملًا، ثم حدد طريقة التطبيق." },
      { title: "راجع المعاينة", description: "تأكد من عدد الأيام المتأثرة وإجمالي الساعات والفرق قبل الإضافة." },
      { title: "أضف الاستثناء", description: "أضفه إلى القائمة ثم احفظ ملف الموظفة حتى يصبح معتمدًا." },
    ],
    important: "الاستثناء يتقدم على الجدول الأسبوعي خلال مدته فقط. استخدم ملاحظة واضحة لأن أثره قد يصل إلى الحضور والراتب والحجوزات.",
  },
  period: {
    title: "الفترة والتقويم",
    description: "تحديد الأيام التي يغطيها الاستثناء وطريقة إدخال التاريخ.",
    purpose: "تاريخ البداية والنهاية يحددان حدود الاستثناء بدقة. يمكن إنشاء استثناء ليوم واحد، عدة أيام متصلة، أو نطاق طويل مع تطبيقه على أيام أسبوع مختارة فقط. اختيار الميلادي أو الهجري يغير طريقة الإدخال، لكن النظام يحفظ التاريخ النهائي بصورة موحدة للمقارنة مع الحضور والجدول.",
    useWhen: "تعرف متى يبدأ التغيير ومتى ينتهي، أو تريد تطبيقه على يوم محدد أو فترة موسمية.",
    notFor: "تغيير دائم بلا تاريخ نهاية؛ التغيير الدائم يجب أن يكون في الأسبوع التشغيلي أو قالب الشفت.",
    example: {
      title: "استثناء ليوم واحد",
      situation: "لدى الموظفة تدريب يوم 12 أغسطس فقط.",
      action: "اجعل «من تاريخ» و«إلى تاريخ» كلاهما 12/08/2026. استخدم «تطبيق ساعات يوم البداية» لنسخ وقت اليوم الحالي ثم عدله إلى وقت التدريب.",
      result: "يتغير يوم 12 أغسطس فقط، بينما 11 و13 أغسطس يبقيان على جدول الموظفة الأساسي.",
    },
    steps: [
      { title: "اختر نوع التاريخ", description: "استخدم الميلادي أو الهجري حسب طريقة العمل المناسبة لك." },
      { title: "حدد البداية والنهاية", description: "ليوم واحد اجعل التاريخين متطابقين، وللفترة اختر آخر يوم فعلي للتغيير." },
      { title: "راجع عدد الأيام", description: "تأكد من مؤشر نطاق الفترة والأيام المتأثرة قبل المتابعة." },
      { title: "انسخ ساعات البداية عند الحاجة", description: "استخدم ساعات يوم البداية كنقطة انطلاق، ثم عدلها إذا كان الاستثناء مختلفًا." },
    ],
    important: "التاريخ وحده لا يحدد الأيام التي ستتأثر عند استخدام تطبيق أيام أسبوع محددة؛ راجع «الأيام المتأثرة» في المعاينة.",
  },
  type: {
    title: "نوع الاستثناء",
    description: "تحديد هل الفترة دوام بديل أم إغلاق معتمد، وكيف يطبّق داخل النطاق.",
    purpose: "عندما تكون «الموظفة تعمل في هذه الفترة» مفعلة، تصبح ساعات البداية والنهاية المدخلة هي ساعات الدوام المطلوبة للأيام المتأثرة. وعند تعطيلها تصبح الأيام إغلاقًا/راحة استثنائية معتمدة فلا يُطلب حضور أو بصمة ولا تُحسب غيابًا. طريقة التطبيق تحدد هل يشمل كل أيام الفترة أم أيام أسبوع مختارة.",
    useWhen: "تحتاج ساعات مختلفة مؤقتًا أو تريد إغلاق أيام محددة دون تسجيل الموظفة غائبة.",
    notFor: "إجازة تُخصم من رصيد الموظفة أو راحة أسبوعية ثابتة؛ هذه لها أقسام مستقلة.",
    example: {
      title: "إغلاق يوم صيانة",
      situation: "الصالون مغلق يوم 20 أغسطس للصيانة والموظفة لا يُطلب منها الحضور.",
      action: "حدد اليوم، عطّل «الموظفة تعمل في هذه الفترة» ليصبح إغلاقًا كاملًا، واكتب ملاحظة «إغلاق صيانة» ثم أضف الاستثناء.",
      result: "يظهر اليوم كإغلاق/راحة استثنائية معتمدة، لا تُطلب بصمة ولا يُسجل غياب، وفي اليوم التالي يعود الشفت المعتاد.",
    },
    steps: [
      { title: "حدد حالة العمل", description: "فعّل الخيار للدوام البديل أو عطّله للإغلاق الكامل." },
      { title: "أدخل الساعات", description: "عند الدوام البديل أدخل وقت البداية والنهاية الحقيقيين." },
      { title: "اختر طريقة التطبيق", description: "اختر كل أيام النطاق أو أيام أسبوع محددة مثل الأحد والثلاثاء فقط." },
      { title: "راجع الناتج", description: "اقرأ معاينة الاستثناء وتأكد أن وصف العمل أو الإغلاق مطابق لقرارك." },
    ],
    important: "الإغلاق الكامل ليس غيابًا. الدوام البديل يستخدم ساعاته لحساب التأخير والانصراف لذلك يجب إدخال الوقت بدقة.",
  },
  saveOptions: {
    title: "خيارات الحفظ",
    description: "تحديد طريقة التعامل مع سجلات موجودة داخل نفس التواريخ.",
    purpose: "قد تحتوي الفترة المختارة على استثناءات محفوظة مسبقًا. خيار «استبدال الاستثناءات المتداخلة» يزيل التعارض ويجعل السجل الجديد هو المعتمد. خيار «تحديث الاستثناءات الموجودة فقط» يعدّل الأيام الموجودة ولا ينشئ أيامًا جديدة. ترك الخيارين حسب الحالة يسمح بإنشاء استثناء جديد مع الحفاظ على السجلات غير المتداخلة.",
    useWhen: "تعيد تصحيح استثناء سابق، تمدد فترة، تغيّر ساعات محفوظة، أو تريد منع وجود أكثر من قرار على التاريخ نفسه.",
    notFor: "اختيار عشوائي قبل فهم السجلات الحالية؛ الخيارات قد تستبدل أو تتجاهل أيامًا داخل النطاق.",
    example: {
      title: "تصحيح استثناء متداخل",
      situation: "يوجد استثناء محفوظ من 5 إلى 7 أغسطس، وتريد استبداله بساعات جديدة من 6 إلى 8 أغسطس.",
      action: "فعّل «استبدال الاستثناءات المتداخلة» حتى لا يبقى يوم 6 أو 7 بسجلين. لا تفعل «تحديث الموجود فقط» إذا كنت تريد إنشاء يوم 8 أيضًا.",
      result: "تُزال التداخلات ويصبح النطاق الجديد هو المعتمد من 6 إلى 8 أغسطس، بينما تبقى السجلات خارج التداخل دون تغيير.",
    },
    steps: [
      { title: "راجع القائمة الحالية", description: "ابحث أولًا عن سجلات تغطي نفس الفترة." },
      { title: "استبدال المتداخل", description: "فعّله عندما تريد أن يلغي السجل الجديد أي قرار سابق على نفس الأيام." },
      { title: "تحديث الموجود فقط", description: "فعّله عندما تريد تعديل سجلات موجودة دون إنشاء تواريخ جديدة." },
      { title: "أضف ملاحظة", description: "اكتب سببًا واضحًا يشرح القرار للمراجعة المستقبلية." },
      { title: "راجع المعاينة ثم أضف", description: "لا تعتمد الحفظ قبل مطابقة عدد الأيام والوقت والفرق مع المطلوب." },
    ],
    important: "إذا فعّلت «تحديث الموجود فقط» ولم توجد سجلات داخل بعض الأيام، فلن ينشئ النظام استثناءات جديدة لتلك الأيام.",
  },
  current: {
    title: "الاستثناءات الحالية",
    description: "مراجعة السجلات المضافة للموظفة قبل وبعد الحفظ.",
    purpose: "تعرض القائمة الفترة، الوقت، عدد الأيام، وحالة كل استثناء. منها تتأكد أن النطاق لم يتوسع بالخطأ، تفتح السجل للتعديل، أو تحذفه. حذف الاستثناء لا يحذف جدول الموظفة؛ بل يزيل القاعدة المؤقتة ويكشف المصدر الأساسي الذي تحته.",
    useWhen: "تريد مراجعة ما سيؤثر على الموظفة، تصحيح تاريخ أو وقت، إزالة استثناء انتهت الحاجة إليه، أو تفسير يوم مختلف عن الجدول.",
    notFor: "إدارة قوالب الشفتات أو أيام الراحة الأسبوعية الثابتة؛ هذه القائمة تعرض الاستثناءات فقط.",
    example: {
      title: "حذف استثناء أضيف بالخطأ",
      situation: "أضيف إغلاق ليومي 5 و6 أغسطس، لكن المطلوب كان يوم 5 فقط.",
      action: "افتح السجل وعدّل النهاية إلى يوم 5، أو احذفه وأنشئ استثناءً صحيحًا. بعد ذلك احفظ ملف الموظفة.",
      result: "يبقى يوم 5 إغلاقًا معتمدًا، ويعود يوم 6 إلى الشفت الموجود في الأسبوع التشغيلي بدل بقائه مغلقًا.",
    },
    steps: [
      { title: "راجع الفترة", description: "قارن البداية والنهاية مع القرار الإداري الحقيقي." },
      { title: "راجع الوقت والحالة", description: "تأكد هل السجل دوام بديل أم إغلاق كامل." },
      { title: "عدّل عند الحاجة", description: "افتح السجل داخل النموذج وغير المدة أو الوقت أو الملاحظة." },
      { title: "احذف السجل الخاطئ", description: "إزالة الاستثناء تعيد الأيام إلى الجدول الأسبوعي الأساسي بعد الحفظ." },
    ],
    important: "لا يكفي تعديل القائمة دون حفظ ملف الموظفة؛ تأكد من إتمام الحفظ النهائي حتى تصل التغييرات إلى الحضور والراتب.",
  },
} satisfies Record<string, WorkspaceHelpTopicV2>;

export type WorkHourOverridesEditorProps = {
  loading: boolean;
  busy: boolean;
  editor: {
    modalHourOverrideMode: string;
    modalHourOverrideEditingDate: string;
    modalHourOverrideEditingGroupId: string;
    modalHourOverrideQuickMode: string;
    modalHourOverrideUpdateExistingOnly: boolean;
    modalHourOverrideCalendar: string;
    modalHourOverrideHijriPickerOpen: boolean;
    modalHourOverrideHijriMonthTitle: string;
    modalHourOverrideHijriWeekOffset: number;
    modalHourOverrideHijriMonthDays: Array<{ iso: string; hijriDay: number }>;
    modalHourOverrideHijriPickerTarget: "from" | "to";
    modalHourOverrideFromDate: string;
    modalHourOverrideToDate: string;
    modalHourOverrideFromDateHijri: string;
    modalHourOverrideToDateHijri: string;
    modalHourOverrideEnabled: boolean;
    modalHourOverrideStart: string;
    modalHourOverrideEnd: string;
    modalHourOverrideNote: string;
    modalHourOverridePreview: { affectedDays: number; totalHours: number; diffHours: number };
    modalHourOverrideApplyWeekdays: string[];
    modalHourOverrideApplyCount: number;
    modalHourOverrideOverwriteExisting: boolean;
    modalCustomHourOverrides: Array<any>;
    modalHourOverrideGroups: Array<any>;
    setModalHourOverrideToGregorian: (value: string) => void;
    setModalHourOverrideEditingGroupId: (value: string) => void;
    setModalHourOverrideMode: (value: any) => void;
    fillModalHourOverrideFromBaseDay: () => void;
    setModalHourOverrideQuickMode: (value: any) => void;
    setModalHourOverrideEnabled: (value: boolean) => void;
    setModalHourOverrideStart: (value: string) => void;
    setModalHourOverrideEnd: (value: string) => void;
    setModalHourOverrideApplyMethod: (value: any) => void;
    setModalHourOverrideOverwriteExisting: (value: boolean) => void;
    setModalHourOverrideUpdateExistingOnly: (value: boolean) => void;
    setModalHourOverrideCalendar: (value: any) => void;
    setModalHourOverrideHijriPickerOpen: (value: boolean) => void;
    applyModalHourOverrideHijriInput: (target: "from" | "to", raw: string, commit?: boolean) => void;
    openModalHourOverrideHijriPicker: (target: "from" | "to") => void;
    setModalHourOverrideFromGregorian: (value: string) => void;
    setModalHourOverrideHijriViewMonthISO: (updater: (prev: string) => string) => void;
    applyModalHourOverrideHijriPick: (iso: string) => void;
    setModalHourOverrideNote: (value: string) => void;
    addModalWorkingHourOverride: () => void;
    cancelModalWorkingHourOverrideEdit: () => void;
    toggleModalHourOverrideWeekday: (day: any) => void;
    startModalWorkingHourOverrideGroupEdit: (group: any) => void;
    removeModalWorkingHourOverrideGroup: (group: any) => void;
    setModalCustomHourOverrides: (value: any) => void;
    setModalHourOverrideRangeFromExisting: () => boolean;
    shiftHijriMonthStartIso: (currentMonthStartISO: string, delta: number) => string;
  };
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
};

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ar-SA-u-nu-latn") : "0";
}

function formatSignedHours(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number === 0) return "0 ساعة";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("ar-SA-u-nu-latn")} ساعة`;
}

function formatWindowForPreview(start: string, end: string): string {
  return formatWindow(start, end).replace(/\s-\s/g, " → ");
}

function formatDayCountLabel(count: number): string {
  return count > 1 ? `${formatArabicInteger(count)} أيام` : "يوم واحد";
}

function buildPreviewText(editor: WorkHourOverridesEditorProps["editor"], isEditing: boolean): string {
  const from = normalizeLeaveUntil(editor.modalHourOverrideFromDate);
  if (!from) return "حددي الفترة وساعات العمل لعرض النتيجة النهائية لهذا الاستثناء.";

  const to = normalizeLeaveUntil(editor.modalHourOverrideToDate) || from;
  const rangeLabel = formatIsoDateRange(from, to);
  const timeLabel = formatWindowForPreview(
    normalizeTimeHHMM(editor.modalHourOverrideStart) || "10:00",
    normalizeTimeHHMM(editor.modalHourOverrideEnd) || "22:00"
  );
  const dayCount = Math.max(
    0,
    Number(editor.modalHourOverrideApplyCount || editor.modalHourOverridePreview?.affectedDays || 0)
  );

  if (isEditing) {
    return editor.modalHourOverrideEnabled
      ? `سيتم تحديث هذا الاستثناء لتعمل الموظفة من ${timeLabel} خلال الفترة ${rangeLabel}.`
      : `سيتم تحديث هذا الاستثناء إلى إغلاق كامل خلال الفترة ${rangeLabel}.`;
  }

  if (dayCount <= 0) {
    return editor.modalHourOverrideUpdateExistingOnly
      ? "لا توجد استثناءات محفوظة مطابقة لهذه الفترة لتحديثها."
      : "لا يوجد أيام مطابقة للفترة المختارة.";
  }

  const dayCountLabel = formatDayCountLabel(dayCount);
  if (!editor.modalHourOverrideEnabled) {
    return editor.modalHourOverrideMode === "specific" && editor.modalHourOverrideApplyWeekdays.length
      ? `ستكون الموظفة مغلقة في الأيام المطابقة داخل الفترة ${rangeLabel} (${dayCountLabel}).`
      : `ستكون الموظفة مغلقة يوميًا خلال الفترة ${rangeLabel} (${dayCountLabel}).`;
  }

  return editor.modalHourOverrideMode === "specific" && editor.modalHourOverrideApplyWeekdays.length
    ? `ستعمل الموظفة من ${timeLabel} في الأيام المطابقة داخل الفترة ${rangeLabel} (${dayCountLabel}).`
    : `ستعمل الموظفة يوميًا من ${timeLabel} خلال الفترة ${rangeLabel} (${dayCountLabel}).`;
}

function getOverrideGroupRange(group: any) {
  const from = normalizeLeaveUntil(group?.fromDate || group?.date || group?.startDate || group?.from || "");
  const to = normalizeLeaveUntil(group?.toDate || group?.endDate || group?.to || from || "");
  if (!from) return "غير محدد";
  return formatIsoDateRange(from, to || from);
}

function getOverrideGroupWindow(group: any) {
  const enabled = group?.enabled !== false;
  if (!enabled) return "إغلاق كامل";
  return formatWindowForPreview(
    normalizeTimeHHMM(group?.start || group?.startTime) || "10:00",
    normalizeTimeHHMM(group?.end || group?.endTime) || "22:00"
  );
}

function getOverrideGroupCount(group: any) {
  const explicitCount = Number(group?.count || group?.daysCount || group?.affectedDays || 0);
  if (Number.isFinite(explicitCount) && explicitCount > 0) return explicitCount;
  const from = normalizeLeaveUntil(group?.fromDate || group?.date || group?.startDate || group?.from || "");
  const to = normalizeLeaveUntil(group?.toDate || group?.endDate || group?.to || from || "");
  return from ? countIsoDateRangeDays(from, to || from) : 0;
}

export default function WorkHourOverridesEditor({
  loading,
  busy,
  editor,
  modalHourOverrideHijriPickerRef,
}: WorkHourOverridesEditorProps) {
  const [helpTopic, setHelpTopic] = useState<WorkspaceHelpTopicV2 | null>(null);
  const isEditing = !!editor.modalHourOverrideEditingDate || !!editor.modalHourOverrideEditingGroupId;
  const previewText = buildPreviewText(editor, isEditing);
  const selectedWeekdays = new Set(editor.modalHourOverrideApplyWeekdays || []);
  const fromDate = normalizeLeaveUntil(editor.modalHourOverrideFromDate);
  const toDate = normalizeLeaveUntil(editor.modalHourOverrideToDate) || fromDate;
  const rangeDays = fromDate ? countIsoDateRangeDays(fromDate, toDate || fromDate) : 0;
  const affectedDays = Number(editor.modalHourOverridePreview?.affectedDays || editor.modalHourOverrideApplyCount || 0);
  const canSubmit = !loading && Boolean(fromDate) && (isEditing || affectedDays > 0);

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-overrides-panel">
      <WorkspaceTabHeaderV2
        title="استثناءات الدوام"
        description="تعديل ساعات أو إغلاق أيام محددة بدون كسر الجدول الأسبوعي الأساسي."
        badge={
          <div className="dsv2-cluster">
            <span>{isEditing ? "وضع التعديل" : "استثناء جديد"}</span>
            <WorkspaceHelpButtonV2
              label="شرح استثناءات الدوام"
              onClick={() => setHelpTopic(WORK_HOUR_OVERRIDE_HELP_TOPICS.overview)}
            />
          </div>
        }
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="نطاق الفترة" value={rangeDays ? formatNumber(rangeDays) : "-"} />
        <WorkspaceMetricV2 label="الأيام المتأثرة" value={formatNumber(affectedDays)} tone={affectedDays ? "success" : "gold"} />
        <WorkspaceMetricV2 label="إجمالي الساعات" value={`${formatNumber(editor.modalHourOverridePreview?.totalHours)} ساعة`} />
        <WorkspaceMetricV2 label="فرق الساعات" value={formatSignedHours(editor.modalHourOverridePreview?.diffHours)} tone="gold" />
      </div>

      <WorkspaceNoticeV2
        title="معاينة الاستثناء"
        description={previewText}
        tone={canSubmit ? "success" : "gold"}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2
          title="الفترة والتقويم"
          description="اختاري نطاق الاستثناء بالتاريخ الميلادي أو الهجري."
          actions={
            <div className="dsv2-cluster">
              <WorkspaceHelpButtonV2
                label="شرح الفترة والتقويم"
                onClick={() => setHelpTopic(WORK_HOUR_OVERRIDE_HELP_TOPICS.period)}
              />
              <button
                type="button"
                className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                disabled={busy}
                onClick={() => {
                  editor.setModalHourOverrideQuickMode("manual");
                  editor.fillModalHourOverrideFromBaseDay();
                }}
              >
                تطبيق ساعات يوم البداية
              </button>
            </div>
          }
        >
          <DashboardFieldV2 id="employee-live-v2-override-calendar" label="نوع التاريخ">
            <DashboardSelectV2
              id="employee-live-v2-override-calendar"
              value={editor.modalHourOverrideCalendar}
              disabled={busy}
              options={[
                { value: "gregory", label: "ميلادي" },
                { value: "hijri", label: "هجري" },
              ]}
              onChange={(value) => {
                editor.setModalHourOverrideCalendar(value);
                if (value === "hijri") {
                  editor.openModalHourOverrideHijriPicker("from");
                } else {
                  editor.setModalHourOverrideHijriPickerOpen(false);
                }
              }}
            />
          </DashboardFieldV2>

          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            {editor.modalHourOverrideCalendar === "hijri" ? (
              <>
                <DashboardFieldV2 id="employee-live-v2-override-from-hijri" label="من تاريخ هجري">
                  <input
                    id="employee-live-v2-override-from-hijri"
                    className="dsv2-input"
                    type="text"
                    inputMode="numeric"
                    value={editor.modalHourOverrideFromDateHijri}
                    placeholder="09/09/1447"
                    disabled={busy}
                    onChange={(event) => editor.applyModalHourOverrideHijriInput("from", event.target.value, false)}
                    onBlur={(event) => editor.applyModalHourOverrideHijriInput("from", event.target.value, true)}
                  />
                  <button
                    type="button"
                    className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                    disabled={busy}
                    onClick={() => editor.openModalHourOverrideHijriPicker("from")}
                  >
                    اختيار من التقويم
                  </button>
                  <small className="dsv2-field__hint">الميلادي: {fmtIsoDate(editor.modalHourOverrideFromDate)}</small>
                </DashboardFieldV2>

                <DashboardFieldV2 id="employee-live-v2-override-to-hijri" label="إلى تاريخ هجري">
                  <input
                    id="employee-live-v2-override-to-hijri"
                    className="dsv2-input"
                    type="text"
                    inputMode="numeric"
                    value={editor.modalHourOverrideToDateHijri}
                    placeholder="19/09/1447"
                    disabled={loading || !!editor.modalHourOverrideEditingDate}
                    onChange={(event) => editor.applyModalHourOverrideHijriInput("to", event.target.value, false)}
                    onBlur={(event) => editor.applyModalHourOverrideHijriInput("to", event.target.value, true)}
                  />
                  <button
                    type="button"
                    className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                    disabled={loading || !!editor.modalHourOverrideEditingDate}
                    onClick={() => editor.openModalHourOverrideHijriPicker("to")}
                  >
                    اختيار من التقويم
                  </button>
                  <small className="dsv2-field__hint">الميلادي: {fmtIsoDate(toDate || "")}</small>
                </DashboardFieldV2>
              </>
            ) : (
              <>
                <DashboardFieldV2 id="employee-live-v2-override-from" label="من تاريخ">
                  <DashboardDatePickerV2
                    id="employee-live-v2-override-from"
                    value={editor.modalHourOverrideFromDate}
                    disabled={busy}
                    onChange={editor.setModalHourOverrideFromGregorian}
                  />
                </DashboardFieldV2>

                <DashboardFieldV2 id="employee-live-v2-override-to" label="إلى تاريخ">
                  <DashboardDatePickerV2
                    id="employee-live-v2-override-to"
                    value={editor.modalHourOverrideToDate}
                    disabled={loading || !!editor.modalHourOverrideEditingDate}
                    clearable
                    onChange={editor.setModalHourOverrideToGregorian}
                  />
                </DashboardFieldV2>
              </>
            )}
          </div>

          {editor.modalHourOverrideCalendar === "hijri" && editor.modalHourOverrideHijriPickerOpen ? (
            <div className="dsv2-ew-hijri-picker" ref={modalHourOverrideHijriPickerRef}>
              <header>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                  onClick={() => editor.setModalHourOverrideHijriViewMonthISO((current) => editor.shiftHijriMonthStartIso(current, -1))}
                >
                  السابق
                </button>
                <strong>{editor.modalHourOverrideHijriMonthTitle}</strong>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                  onClick={() => editor.setModalHourOverrideHijriViewMonthISO((current) => editor.shiftHijriMonthStartIso(current, 1))}
                >
                  التالي
                </button>
              </header>

              <div className="dsv2-ew-hijri-weekdays" aria-hidden="true">
                {HIJRI_WEEKDAY_SHORT.map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="dsv2-ew-hijri-days" style={{ paddingInlineStart: `${Math.max(0, editor.modalHourOverrideHijriWeekOffset) * 14.2857}%` }}>
                {editor.modalHourOverrideHijriMonthDays.map((day) => (
                  <button
                    key={day.iso}
                    type="button"
                    className="dsv2-ew-hijri-day"
                    data-active={
                      day.iso === editor.modalHourOverrideFromDate || day.iso === editor.modalHourOverrideToDate
                        ? "true"
                        : "false"
                    }
                    onClick={() => editor.applyModalHourOverrideHijriPick(day.iso)}
                  >
                    <b>{formatArabicInteger(day.hijriDay)}</b>
                    <small>{fmtIsoDate(day.iso)}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </WorkspaceCardV2>

        <WorkspaceCardV2
          title="نوع الاستثناء"
          description="حددي هل هو دوام بديل أو إغلاق كامل."
          actions={
            <WorkspaceHelpButtonV2
              label="شرح نوع الاستثناء"
              onClick={() => setHelpTopic(WORK_HOUR_OVERRIDE_HELP_TOPICS.type)}
            />
          }
        >
          <WorkspaceSwitchV2
            checked={editor.modalHourOverrideEnabled}
            disabled={busy}
            label="الموظفة تعمل في هذه الفترة"
            description={editor.modalHourOverrideEnabled ? "سيتم استخدام ساعات البداية والنهاية أدناه." : "سيتم اعتبار الفترة إغلاقًا كاملًا."}
            onChange={editor.setModalHourOverrideEnabled}
          />

          {editor.modalHourOverrideEnabled ? (
            <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
              <DashboardFieldV2 id="employee-live-v2-override-start" label="بداية الدوام">
                <DashboardTimeInputV2 id="employee-live-v2-override-start" className="dsv2-input" value={normalizeTimeHHMM(editor.modalHourOverrideStart) || "10:00"} disabled={busy} onChange={(event) => editor.setModalHourOverrideStart(event.target.value)} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="employee-live-v2-override-end" label="نهاية الدوام">
                <DashboardTimeInputV2 id="employee-live-v2-override-end" className="dsv2-input" value={normalizeTimeHHMM(editor.modalHourOverrideEnd) || "22:00"} disabled={busy} onChange={(event) => editor.setModalHourOverrideEnd(event.target.value)} />
              </DashboardFieldV2>
            </div>
          ) : null}

          <DashboardFieldV2 id="employee-live-v2-override-mode" label="طريقة التطبيق">
            <DashboardSelectV2
              id="employee-live-v2-override-mode"
              value={editor.modalHourOverrideMode}
              disabled={busy || isEditing}
              options={[
                { value: "range", label: "كل أيام الفترة" },
                { value: "specific", label: "أيام أسبوع محددة" },
              ]}
              onChange={editor.setModalHourOverrideMode}
            />
          </DashboardFieldV2>

          {editor.modalHourOverrideMode === "specific" ? (
            <div className="dsv2-ew-pills" role="group" aria-label="أيام الأسبوع للاستثناء">
              {WEEKDAY_OPTIONS.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  className="dsv2-ew-pill"
                  data-active={selectedWeekdays.has(day.key) ? "true" : "false"}
                  disabled={busy}
                  onClick={() => editor.toggleModalHourOverrideWeekday(day.key)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          ) : null}
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="خيارات الحفظ"
        description="تحكم في التحديث أو الاستبدال عند وجود استثناءات محفوظة."
        actions={
          <WorkspaceHelpButtonV2
            label="شرح خيارات حفظ الاستثناء"
            onClick={() => setHelpTopic(WORK_HOUR_OVERRIDE_HELP_TOPICS.saveOptions)}
          />
        }
      >
        <div className="dsv2-ew-grid dsv2-ew-grid--2">
          <WorkspaceSwitchV2
            checked={editor.modalHourOverrideOverwriteExisting}
            disabled={busy || editor.modalHourOverrideUpdateExistingOnly}
            label="استبدال الاستثناءات المتداخلة"
            description="يمنع ازدواج الاستثناءات لنفس التاريخ."
            onChange={editor.setModalHourOverrideOverwriteExisting}
          />
          <WorkspaceSwitchV2
            checked={editor.modalHourOverrideUpdateExistingOnly}
            disabled={busy || isEditing}
            label="تحديث الاستثناءات الموجودة فقط"
            description="لا ينشئ تواريخ جديدة خارج الموجود مسبقًا."
            onChange={editor.setModalHourOverrideUpdateExistingOnly}
          />
        </div>

        <DashboardFieldV2 id="employee-live-v2-override-note" label="ملاحظة داخلية">
          <textarea
            id="employee-live-v2-override-note"
            className="dsv2-textarea"
            rows={3}
            value={editor.modalHourOverrideNote}
            disabled={busy}
            placeholder="مثال: دوام رمضان، تدريب، مناسبة خاصة..."
            onChange={(event) => editor.setModalHourOverrideNote(event.target.value)}
          />
        </DashboardFieldV2>

        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={busy || !canSubmit}
            onClick={editor.addModalWorkingHourOverride}
          >
            {isEditing ? "حفظ تعديل الاستثناء" : "إضافة الاستثناء"}
          </button>
          {isEditing ? (
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              disabled={busy}
              onClick={editor.cancelModalWorkingHourOverrideEdit}
            >
              إلغاء التعديل
            </button>
          ) : null}
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            disabled={busy || !editor.modalCustomHourOverrides.length}
            onClick={() => editor.setModalCustomHourOverrides([])}
          >
            مسح الاستثناءات غير المحفوظة
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            disabled={busy}
            onClick={() => editor.setModalHourOverrideRangeFromExisting()}
          >
            استخدام نطاق موجود
          </button>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="الاستثناءات الحالية"
        description="الاستثناءات التي ستُحفظ مع ملف الموظفة."
        actions={
          <WorkspaceHelpButtonV2
            label="شرح الاستثناءات الحالية"
            onClick={() => setHelpTopic(WORK_HOUR_OVERRIDE_HELP_TOPICS.current)}
          />
        }
      >
        <WorkspaceTableV2
          headers={["الفترة", "الوقت", "الأيام", "الحالة", "إجراء"]}
          rows={(editor.modalHourOverrideGroups || []).map((group) => [
            getOverrideGroupRange(group),
            getOverrideGroupWindow(group),
            formatNumber(getOverrideGroupCount(group)),
            group?.enabled === false ? "إغلاق" : "دوام مخصص",
            <div className="dsv2-cluster" key={String(group?.id || group?.date || getOverrideGroupRange(group))}>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                disabled={busy}
                onClick={() => editor.startModalWorkingHourOverrideGroupEdit(group)}
              >
                تعديل
              </button>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                disabled={busy}
                onClick={() => editor.removeModalWorkingHourOverrideGroup(group)}
              >
                حذف
              </button>
            </div>,
          ])}
          emptyText="لا توجد استثناءات مضافة حتى الآن."
        />
      </WorkspaceCardV2>

      <WorkspaceHelpDrawerV2
        open={Boolean(helpTopic)}
        topic={helpTopic}
        onClose={() => setHelpTopic(null)}
      />
    </div>
  );
}
