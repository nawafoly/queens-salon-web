import { useMemo, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../index";
import type { EmployeeWorkspaceTabProps } from "./types";
import {
  WorkspaceCardV2,
  WorkspaceChoicePillsV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStateShowcaseV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "./EmployeeWorkspacePrimitivesV2";

const WEEK_ROWS = [
  ["الأحد", "دوام", "10:00 ص", "06:00 م", "8 ساعات"],
  ["الإثنين", "دوام", "10:00 ص", "06:00 م", "8 ساعات"],
  ["الثلاثاء", "دوام", "12:00 م", "08:00 م", "8 ساعات"],
  ["الأربعاء", "دوام", "10:00 ص", "06:00 م", "8 ساعات"],
  ["الخميس", "دوام", "02:00 م", "10:00 م", "8 ساعات"],
  ["الجمعة", "إجازة", "—", "—", "—"],
  ["السبت", "دوام", "02:00 م", "10:00 م", "8 ساعات"],
] as const;

const ATTENDANCE_DAYS = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  const status = day % 7 === 1 ? "راحة" : day % 9 === 0 ? "غياب" : day % 5 === 0 ? "تأخير" : day % 6 === 0 ? "خروج مبكر" : day > 18 ? "—" : "حضور";
  return { day, status };
});

function statusTone(status: string) {
  if (status === "حضور") return "success";
  if (status === "تأخير") return "gold";
  if (status === "غياب") return "danger";
  return "default";
}

export function ScheduleTabV2({ readOnly, markDirty, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [customSchedule, setCustomSchedule] = useState(true);
  const [zone, setZone] = useState("main");
  const [effectiveDate, setEffectiveDate] = useState("2026-08-01");

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="جدول الدوام"
        description="إدارة النطاق والجدول الأسبوعي والنسخ المحفوظة والاستثناءات المؤرخة من واجهة موحدة."
        badge={<WorkspaceStatusBadgeV2 tone="success">الجدول فعال</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="آخر يوم توظيف" value="15 مايو 2025" />
        <WorkspaceMetricV2 label="أيام الدوام" value="6 أيام" tone="success" />
        <WorkspaceMetricV2 label="أيام الإجازة" value="يوم واحد" tone="gold" />
        <WorkspaceMetricV2 label="ساعات الأسبوع" value="48 ساعة" />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="نطاق الحضور والبصمة" description="النطاق المعتمد ومعلومات نصف القطر وحالة التحقق.">
          <div className="dsv2-ew-form-grid">
            <DashboardFieldV2 id="dsv2-ew-work-zone" label="نطاق الحضور">
              <DashboardSelectV2
                id="dsv2-ew-work-zone"
                value={zone}
                disabled={readOnly}
                options={[
                  { value: "main", label: "الفرع الرئيسي — المدينة المنورة" },
                  { value: "home", label: "المنزل — نطاق إداري" },
                  { value: "jubail", label: "فرع الجبيل" },
                ]}
                onChange={(value) => { setZone(value); markDirty(); }}
              />
            </DashboardFieldV2>
            <div className="dsv2-ew-zone-card">
              <div><span>الحالة</span><WorkspaceStatusBadgeV2 tone="success">نشط</WorkspaceStatusBadgeV2></div>
              <div><span>نصف القطر</span><strong>300 متر</strong></div>
              <div><span>دقة الموقع المطلوبة</span><strong>150 مترًا أو أقل</strong></div>
              <div><span>التقاط صورة</span><strong>مطلوب في الفرع الرئيسي</strong></div>
            </div>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="إعداد النسخة الجديدة" description="يُحفظ التغيير كنسخة مؤرخة ولا يستبدل التاريخ السابق.">
          <div className="dsv2-ew-switch-list">
            <WorkspaceSwitchV2 checked={customSchedule} disabled={readOnly} label="تفعيل جدول خاص للموظفة" description="عند الإيقاف تستخدم الموظفة جدول الفرع العام." onChange={(checked) => { setCustomSchedule(checked); markDirty(); }} />
          </div>
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-schedule-effective" label="تاريخ سريان الجدول" required>
              <DashboardDatePickerV2 id="dsv2-ew-schedule-effective" value={effectiveDate} disabled={readOnly} min="2025-01-01" max="2028-12-31" onChange={(value) => { setEffectiveDate(value); markDirty(); }} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-schedule-reason" label="سبب التغيير" required>
              <input id="dsv2-ew-schedule-reason" className="dsv2-input" defaultValue="تعديل جدول موسم الصيف" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="الجدول الأسبوعي"
        description="كل يوم قابل للتخصيص أو النسخ إلى بقية الأيام."
        actions={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "نسخ يوم الأحد؟", description: "سيُطبق وقت الأحد على كل أيام الدوام مع بقاء أيام الإجازة كما هي.", confirmLabel: "نسخ اليوم", tone: "gold", onConfirm: markDirty })}>نسخ يوم إلى البقية</button>}
      >
        <WorkspaceTableV2
          headers={["اليوم", "الحالة", "وقت البداية", "وقت النهاية", "مدة اليوم", "الإجراء"]}
          rows={WEEK_ROWS.map((row) => [
            <strong>{row[0]}</strong>,
            <WorkspaceStatusBadgeV2 tone={row[1] === "دوام" ? "success" : "gold"}>{row[1]}</WorkspaceStatusBadgeV2>,
            row[2],
            row[3],
            row[4],
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>تعديل</button>,
          ])}
        />
      </WorkspaceCardV2>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="نسخ الجدول المحفوظة" description="السجل التاريخي الذي يحدد أي نسخة كانت فعالة في كل فترة.">
          <WorkspaceTableV2
            headers={["السريان", "الحالة", "السبب", "بواسطة"]}
            rows={[
              ["01 أغسطس 2026", <WorkspaceStatusBadgeV2 tone="success">النسخة الحالية</WorkspaceStatusBadgeV2>, "موسم الصيف", "نواف"],
              ["01 يناير 2026", <WorkspaceStatusBadgeV2>منتهية</WorkspaceStatusBadgeV2>, "جدول سنوي", "الموارد البشرية"],
              ["15 مايو 2025", <WorkspaceStatusBadgeV2>أول نسخة</WorkspaceStatusBadgeV2>, "تاريخ التوظيف", "النظام"],
            ]}
          />
        </WorkspaceCardV2>
        <WorkspaceCardV2 title="الاستثناءات والتواريخ الخاصة" description="أيام تختلف عن الجدول الأسبوعي دون تغيير النسخة الأساسية.">
          <WorkspaceTableV2
            headers={["التاريخ", "النوع", "الوقت", "الملاحظة"]}
            rows={[
              ["23 سبتمبر 2026", <WorkspaceStatusBadgeV2 tone="gold">وقت خاص</WorkspaceStatusBadgeV2>, "04:00 م — 10:00 م", "اليوم الوطني"],
              ["01 أكتوبر 2026", <WorkspaceStatusBadgeV2 tone="danger">إجازة</WorkspaceStatusBadgeV2>, "—", "موعد طبي"],
            ]}
          />
          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly}>إضافة استثناء</button>
        </WorkspaceCardV2>
      </div>
    </div>
  );
}

export function ShiftsTabV2({ readOnly, markDirty, openDialog, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [assignmentType, setAssignmentType] = useState("permanent");
  const [template, setTemplate] = useState("morning");
  const [statusView, setStatusView] = useState("active");

  const templates = [
    { code: "ص", name: "الشفت الصباحي", time: "10:00 ص — 06:00 م", breakText: "30 دقيقة مدفوعة", grace: "10 دقائق", overtime: "بعد 8 ساعات", status: "نشط" },
    { code: "م", name: "الشفت المسائي", time: "02:00 م — 10:00 م", breakText: "45 دقيقة غير مدفوعة", grace: "10 دقائق", overtime: "بعد 8 ساعات", status: "نشط" },
    { code: "ل", name: "شفت ليلي", time: "08:00 م — 04:00 ص", breakText: "30 دقيقة مدفوعة", grace: "15 دقيقة", overtime: "بعد 8 ساعات", status: "مسودة" },
  ];

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الشفتات"
        description="قوالب وتعيينات واستثناءات وتأثير الرواتب، مع حالات المسودة والنشر والنشاط والانتهاء والإلغاء."
        badge={<WorkspaceStatusBadgeV2 tone="success">الشفت الصباحي نشط</WorkspaceStatusBadgeV2>}
      />

      <WorkspaceCardV2 title="قوالب الشفتات" description="تعريف شامل للوقت والاستراحة والسماحات والأوفر تايم.">
        <div className="dsv2-ew-shift-templates">
          {templates.map((item) => (
            <article key={item.code} className="dsv2-ew-shift-template" data-status={item.status === "نشط" ? "active" : "draft"}>
              <div className="dsv2-ew-shift-template__code">{item.code}</div>
              <div className="dsv2-ew-shift-template__main">
                <div><strong>{item.name}</strong><WorkspaceStatusBadgeV2 tone={item.status === "نشط" ? "success" : "gold"}>{item.status}</WorkspaceStatusBadgeV2></div>
                <span>{item.time}</span>
                <small>{item.breakText} · سماح {item.grace} · الأوفر تايم {item.overtime}</small>
              </div>
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => openDialog("shift")}>تعديل القالب</button>
            </article>
          ))}
        </div>
      </WorkspaceCardV2>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="تعيين الشفت" description="تعيين دائم أو مؤقت ضمن فترة محددة.">
          <WorkspaceChoicePillsV2
            value={assignmentType}
            disabled={readOnly}
            options={[{ value: "permanent", label: "دائم" }, { value: "temporary", label: "مؤقت" }]}
            onChange={(value) => { setAssignmentType(value); markDirty(); }}
          />
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-shift-template" label="قالب الشفت" required>
              <DashboardSelectV2
                id="dsv2-ew-shift-template"
                value={template}
                disabled={readOnly}
                options={[
                  { value: "morning", label: "الشفت الصباحي" },
                  { value: "evening", label: "الشفت المسائي" },
                  { value: "night", label: "الشفت الليلي — مسودة", disabled: true },
                ]}
                onChange={(value) => { setTemplate(value); markDirty(); }}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-shift-start" label="تاريخ البداية" required>
              <DashboardDatePickerV2 id="dsv2-ew-shift-start" defaultValue="2026-08-01" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-shift-end" label="تاريخ النهاية" hint={assignmentType === "permanent" ? "غير مطلوب للتعيين الدائم." : "مطلوب للتعيين المؤقت."}>
              <DashboardDatePickerV2 id="dsv2-ew-shift-end" defaultValue={assignmentType === "temporary" ? "2026-08-31" : ""} disabled={readOnly || assignmentType === "permanent"} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-shift-reason" label="سبب التغيير" required>
              <input id="dsv2-ew-shift-reason" className="dsv2-input" defaultValue="توزيع تغطية الفرع" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="معاينة التأثير" description="الأثر المتوقع قبل نشر التعيين.">
          <div className="dsv2-ew-impact-list">
            <div><span>وقت الحضور المتوقع</span><strong>09:50 ص — 10:10 ص</strong></div>
            <div><span>الخروج المبكر يبدأ</span><strong>قبل 05:50 م</strong></div>
            <div><span>الأوفر تايم يبدأ</span><strong>بعد 06:00 م</strong></div>
            <div><span>عبور منتصف الليل</span><strong>{template === "night" ? "نعم" : "لا"}</strong></div>
            <div><span>الاستراحة</span><strong>30 دقيقة مدفوعة</strong></div>
          </div>
          <WorkspaceNoticeV2 title="تعديل متوقع في الرواتب" description="أي استثناء وقت مخصص بعد قفل الفترة سينشئ حركة تصحيح مستقلة." tone="gold" />
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="الاستثناءات" description="راحة أو شفت بديل أو وقت مخصص لتاريخ بعينه." actions={<button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly} onClick={() => openDialog("shift")}>إضافة استثناء</button>}>
        <WorkspaceTableV2
          headers={["التاريخ", "النوع", "التفاصيل", "الحالة", "تأثير الراتب", "الإجراء"]}
          rows={[
            ["09 أغسطس 2026", "يوم راحة", "بدل الجمعة", <WorkspaceStatusBadgeV2 tone="success">منشور</WorkspaceStatusBadgeV2>, "لا يوجد", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>تعديل</button>],
            ["15 أغسطس 2026", "شفت بديل", "المسائي", <WorkspaceStatusBadgeV2 tone="gold">مسودة</WorkspaceStatusBadgeV2>, "+ ساعتان محتملتان", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>مراجعة</button>],
            ["20 أغسطس 2026", "وقت مخصص", "04:00 م — 10:00 م", <WorkspaceStatusBadgeV2>منتهي</WorkspaceStatusBadgeV2>, "تسوية 35 ر.س", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>السجل</button>],
            ["27 أغسطس 2026", "شفت بديل", "الصباحي", <WorkspaceStatusBadgeV2 tone="danger">ملغي</WorkspaceStatusBadgeV2>, "ملغي", <span>—</span>],
          ]}
        />
      </WorkspaceCardV2>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="الفترات المقفلة" description="لا تسمح بالتعديل المباشر بعد اعتماد الرواتب.">
          <WorkspaceTableV2 headers={["الفترة", "القفل", "المسير"]} rows={[["21 يونيو — 20 يوليو", <WorkspaceStatusBadgeV2 tone="danger">مقفلة</WorkspaceStatusBadgeV2>, "مسير يوليو"], ["21 يوليو — 20 أغسطس", <WorkspaceStatusBadgeV2 tone="gold">مفتوحة</WorkspaceStatusBadgeV2>, "مسير أغسطس"]]} />
        </WorkspaceCardV2>
        <WorkspaceCardV2 title="حالات التعيين" description="معاينة الحالات المعتمدة بصريًا.">
          <WorkspaceChoicePillsV2 value={statusView} options={[{ value: "draft", label: "مسودة" }, { value: "published", label: "منشور" }, { value: "active", label: "نشط" }, { value: "ended", label: "منتهي" }, { value: "cancelled", label: "ملغي" }]} onChange={setStatusView} />
          <WorkspaceNoticeV2 title={`الحالة المحددة: ${statusView === "draft" ? "مسودة" : statusView === "published" ? "منشور" : statusView === "active" ? "نشط" : statusView === "ended" ? "منتهي" : "ملغي"}`} description="الحالة التجريبية تعرض أسلوب التمييز ولا تغيّر البيانات التشغيلية." tone={statusView === "cancelled" ? "danger" : statusView === "active" ? "success" : "neutral"} />
          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "إلغاء التعيين النشط؟", description: "سيتوقف التعيين من تاريخ اليوم ويحتفظ النظام بالسجل السابق.", confirmLabel: "إلغاء التعيين", tone: "danger" })}>إلغاء التعيين</button>
        </WorkspaceCardV2>
      </div>
    </div>
  );
}

export function AttendanceTabV2({ readOnly, markDirty, openDialog, openDrawer, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [month, setMonth] = useState("2026-08");
  const [viewState, setViewState] = useState("ready");
  const monthLabel = month === "2026-08" ? "أغسطس 2026" : month === "2026-07" ? "يوليو 2026" : "يونيو 2026";

  const summary = useMemo(() => ({ present: 14, late: 3, early: 2, absent: 1, leave: 1, permission: 1, rest: 4 }), [month]);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الحضور"
        description="تقويم شهري وملخص انضباط وتفاصيل يومية وإجراءات تعديل أو حذف البصمة وإدارة الإجازة الطارئة."
        badge={<WorkspaceStatusBadgeV2 tone="gold">3 حالات تحتاج مراجعة</WorkspaceStatusBadgeV2>}
      />

      <WorkspaceCardV2 title="الشهر وحالة العرض" description="تجربة حالات التحميل والفراغ والخطأ من نفس التبويب.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-attendance-month" label="الشهر">
            <DashboardSelectV2 id="dsv2-ew-attendance-month" value={month} options={[{ value: "2026-08", label: "أغسطس 2026" }, { value: "2026-07", label: "يوليو 2026" }, { value: "2026-06", label: "يونيو 2026" }]} onChange={setMonth} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-attendance-state" label="حالة النموذج">
            <DashboardSelectV2 id="dsv2-ew-attendance-state" value={viewState} options={[{ value: "ready", label: "بيانات جاهزة" }, { value: "loading", label: "تحميل" }, { value: "empty", label: "بدون سجلات" }, { value: "error", label: "خطأ" }]} onChange={setViewState} />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      {viewState === "ready" ? (
        <>
          <div className="dsv2-ew-metrics dsv2-ew-metrics--attendance">
            <WorkspaceMetricV2 label="الحضور" value={summary.present} tone="success" />
            <WorkspaceMetricV2 label="التأخير" value={summary.late} tone="gold" />
            <WorkspaceMetricV2 label="الخروج المبكر" value={summary.early} tone="gold" />
            <WorkspaceMetricV2 label="الغياب" value={summary.absent} tone="danger" />
            <WorkspaceMetricV2 label="الإجازة" value={summary.leave} />
            <WorkspaceMetricV2 label="الاستئذان" value={summary.permission} />
            <WorkspaceMetricV2 label="الراحة" value={summary.rest} />
          </div>

          <div className="dsv2-ew-grid dsv2-ew-grid--attendance">
            <WorkspaceCardV2 title={`تقويم ${monthLabel}`} description="اضغطي على أي يوم مسجل لفتح تفاصيله.">
              <div className="dsv2-ew-calendar-head" aria-hidden="true">{["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="dsv2-ew-calendar">
                {ATTENDANCE_DAYS.map((item) => (
                  <button key={item.day} type="button" className="dsv2-ew-calendar__day" data-status={item.status} onClick={() => item.status !== "—" && openDrawer("day")}>
                    <strong>{item.day}</strong>
                    <span>{item.status}</span>
                  </button>
                ))}
              </div>
            </WorkspaceCardV2>

            <WorkspaceCardV2 title="تفاصيل اليوم المحدد" description="الخميس 14 أغسطس 2026">
              <div className="dsv2-ew-day-detail">
                <div className="dsv2-ew-day-detail__status"><WorkspaceStatusBadgeV2 tone="gold">تأخير 12 دقيقة</WorkspaceStatusBadgeV2><span>يحتاج مراجعة</span></div>
                <dl>
                  <div><dt>وقت الدخول</dt><dd>10:12 ص</dd></div>
                  <div><dt>وقت الخروج</dt><dd>06:05 م</dd></div>
                  <div><dt>الشفت الفعلي</dt><dd>10:00 ص — 06:00 م</dd></div>
                  <div><dt>الموقع</dt><dd>الفرع الرئيسي</dd></div>
                  <div><dt>الصورة</dt><dd>مرفقة ومطابقة</dd></div>
                </dl>
                <div className="dsv2-ew-action-grid">
                  <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly} onClick={() => openDialog("attendance")}>تعديل البصمة</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>إجازة طارئة</button>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "حذف بصمة الدخول؟", description: "سيعاد احتساب اليوم بعد حذف البصمة، وقد يتغير الاستحقاق المالي.", confirmLabel: "حذف البصمة", tone: "danger", onConfirm: markDirty })}>حذف البصمة</button>
                </div>
              </div>
            </WorkspaceCardV2>
          </div>

          <WorkspaceCardV2 title="سجل الأيام" description="جميع الحالات مع إجراءات المراجعة والإجازة.">
            <WorkspaceTableV2
              headers={["التاريخ", "الحالة", "الدخول", "الخروج", "الشفت", "المراجعة"]}
              rows={[
                ["14 أغسطس", <WorkspaceStatusBadgeV2 tone="gold">تأخير</WorkspaceStatusBadgeV2>, "10:12 ص", "06:05 م", "الصباحي", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("day")}>التفاصيل</button>],
                ["13 أغسطس", <WorkspaceStatusBadgeV2 tone="success">حضور</WorkspaceStatusBadgeV2>, "09:58 ص", "06:02 م", "الصباحي", "مكتمل"],
                ["12 أغسطس", <WorkspaceStatusBadgeV2 tone="danger">غياب</WorkspaceStatusBadgeV2>, "—", "—", "الصباحي", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>إجازة طارئة</button>],
                ["11 أغسطس", <WorkspaceStatusBadgeV2>استئذان</WorkspaceStatusBadgeV2>, "10:00 ص", "03:00 م", "الصباحي", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>إلغاء الإجازة</button>],
              ]}
            />
          </WorkspaceCardV2>
        </>
      ) : viewState === "loading" ? (
        <WorkspaceStateShowcaseV2 />
      ) : viewState === "empty" ? (
        <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large"><strong>لا توجد سجلات حضور في {monthLabel}</strong><span>قد يكون الشهر قبل تاريخ التوظيف أو لم تبدأ الموظفة الدوام بعد.</span></div>
      ) : (
        <WorkspaceNoticeV2 title="تعذر تحميل سجل الحضور" description="لم يستجب خادم الحضور. لم يتم تغيير أي بيانات محفوظة." tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => setViewState("ready")}>إعادة المحاولة</button>} />
      )}
    </div>
  );
}
