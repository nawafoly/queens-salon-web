import { useState } from "react";
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

export function PayrollTabV2({ readOnly, markDirty, openDrawer, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [deductionMethod, setDeductionMethod] = useState("hourly");
  const [overtimeEnabled, setOvertimeEnabled] = useState(true);
  const [periodLocked, setPeriodLocked] = useState(false);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="سجل الرواتب"
        description="إعداد الراتب ودورة الاستحقاق والساعات والحساب والقفل وسجل المسيرات السابقة."
        badge={<WorkspaceStatusBadgeV2 tone="gold">الإعداد مكتمل 86٪</WorkspaceStatusBadgeV2>}
      />

      <WorkspaceNoticeV2
        title="نقص في بيانات الاعتماد"
        description="يجب التحقق من رقم الهوية قبل قفل أول فترة راتب. بقية الحقول جاهزة للحساب التجريبي."
        tone="gold"
        action={<button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={readOnly}>استكمال النواقص</button>}
      />

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="إعداد الراتب" description="القيم الأساسية المستخدمة في احتساب اليوم والساعة.">
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-base-salary" label="الراتب الأساسي" required>
              <input id="dsv2-ew-base-salary" className="dsv2-input" inputMode="decimal" dir="ltr" defaultValue="4500" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-work-days" label="أيام العمل الشهرية">
              <input id="dsv2-ew-work-days" className="dsv2-input" inputMode="numeric" dir="ltr" defaultValue="26" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-hours-day" label="ساعات اليوم">
              <input id="dsv2-ew-hours-day" className="dsv2-input" inputMode="decimal" dir="ltr" defaultValue="8" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-overtime-factor" label="معامل الأوفر تايم">
              <input id="dsv2-ew-overtime-factor" className="dsv2-input" inputMode="decimal" dir="ltr" defaultValue="1.5" disabled={readOnly || !overtimeEnabled} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
          <WorkspaceSwitchV2 checked={overtimeEnabled} disabled={readOnly} label="احتساب الأوفر تايم" description="يبدأ بعد ساعات الجدول الفعلية المعتمدة." onChange={(checked) => { setOvertimeEnabled(checked); markDirty(); }} />
          <div className="dsv2-ew-field-group">
            <span>طريقة الخصم</span>
            <WorkspaceChoicePillsV2 value={deductionMethod} disabled={readOnly} options={[{ value: "hourly", label: "بالساعة" }, { value: "daily", label: "باليوم" }]} onChange={(value) => { setDeductionMethod(value); markDirty(); }} />
          </div>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="دورة الراتب" description="الفترة الحالية من يوم 21 إلى يوم 20 من الشهر التالي.">
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-payroll-from" label="الفترة من">
              <DashboardDatePickerV2 id="dsv2-ew-payroll-from" defaultValue="2026-07-21" disabled={readOnly || periodLocked} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-payroll-to" label="الفترة إلى">
              <DashboardDatePickerV2 id="dsv2-ew-payroll-to" defaultValue="2026-08-20" disabled={readOnly || periodLocked} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-pay-date" label="تاريخ الصرف المتوقع">
              <DashboardDatePickerV2 id="dsv2-ew-pay-date" defaultValue="2026-08-28" disabled={readOnly || periodLocked} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-payroll-cycle" label="الدورة">
              <DashboardSelectV2 id="dsv2-ew-payroll-cycle" defaultValue="aug" disabled={readOnly || periodLocked} options={[{ value: "aug", label: "مسير أغسطس 2026" }, { value: "jul", label: "مسير يوليو 2026" }]} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
          <WorkspaceSwitchV2 checked={periodLocked} disabled={readOnly} label="قفل الفترة" description="بعد القفل تصبح التعديلات حركات تصحيح مستقلة." onChange={(checked) => {
            if (checked) {
              requestConfirm({ title: "قفل فترة الراتب؟", description: "لن يمكن تعديل الحضور أو الإعدادات داخل الفترة مباشرة بعد القفل.", confirmLabel: "قفل الفترة", tone: "danger", onConfirm: () => { setPeriodLocked(true); markDirty(); } });
            } else {
              setPeriodLocked(false); markDirty();
            }
          }} />
        </WorkspaceCardV2>
      </div>

      <div className="dsv2-ew-metrics dsv2-ew-metrics--payroll">
        <WorkspaceMetricV2 label="ساعات الشهر" value="208 ساعة" />
        <WorkspaceMetricV2 label="راتب اليوم" value="173.08 ر.س" tone="gold" />
        <WorkspaceMetricV2 label="راتب الساعة" value="21.63 ر.س" tone="gold" />
        <WorkspaceMetricV2 label="ساعات الجدول" value="128 ساعة" />
        <WorkspaceMetricV2 label="الساعات الإضافية" value="6.5 ساعات" tone="success" />
        <WorkspaceMetricV2 label="إجمالي الأوفر تايم" value="210.89 ر.س" tone="success" />
      </div>

      <WorkspaceCardV2 title="ملخص الحساب الحالي" description="المبالغ التجريبية مبنية على الإعدادات والحضور المعروضين في النموذج.">
        <WorkspaceTableV2
          headers={["البند", "الأساس", "القيمة", "الحالة"]}
          rows={[
            [<strong>الراتب الأساسي</strong>, "4500 ر.س", "4500.00 ر.س", <WorkspaceStatusBadgeV2 tone="success">مكتمل</WorkspaceStatusBadgeV2>],
            ["الأوفر تايم", "6.5 × 21.63 × 1.5", "+210.89 ر.س", <WorkspaceStatusBadgeV2 tone="success">محسوب</WorkspaceStatusBadgeV2>],
            ["خصم تأخير", deductionMethod === "hourly" ? "1.25 ساعة" : "يوم واحد", "-27.04 ر.س", <WorkspaceStatusBadgeV2 tone="gold">قابل للمراجعة</WorkspaceStatusBadgeV2>],
            ["بدل الهدف", "تحقق مستوى 10,000 ر.س", "+300.00 ر.س", <WorkspaceStatusBadgeV2 tone="success">مستحق</WorkspaceStatusBadgeV2>],
            [<strong>الإجمالي المتوقع</strong>, "قبل التأمينات", <strong>4,983.85 ر.س</strong>, <WorkspaceStatusBadgeV2 tone={periodLocked ? "danger" : "gold"}>{periodLocked ? "مقفل" : "مسودة"}</WorkspaceStatusBadgeV2>],
          ]}
        />
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="سجل المسيرات السابقة" description="السجل التاريخي للقفل والحساب والصرف.">
        <WorkspaceTableV2
          headers={["المسير", "الفترة", "الإجمالي", "الحالة", "القفل", "الإجراء"]}
          rows={[
            ["يوليو 2026", "21 يونيو — 20 يوليو", "4,725.00 ر.س", <WorkspaceStatusBadgeV2 tone="success">مدفوع</WorkspaceStatusBadgeV2>, "22 يوليو", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("audit")}>التفاصيل</button>],
            ["يونيو 2026", "21 مايو — 20 يونيو", "4,610.50 ر.س", <WorkspaceStatusBadgeV2 tone="success">مدفوع</WorkspaceStatusBadgeV2>, "21 يونيو", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("audit")}>التفاصيل</button>],
            ["مايو 2026", "21 أبريل — 20 مايو", "4,500.00 ر.س", <WorkspaceStatusBadgeV2>معتمد</WorkspaceStatusBadgeV2>, "21 مايو", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("audit")}>التفاصيل</button>],
          ]}
        />
      </WorkspaceCardV2>
    </div>
  );
}

export function RequestsTabV2({ readOnly, markDirty, openDrawer, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [scope, setScope] = useState("pending");
  const [viewState, setViewState] = useState("ready");

  const rows = scope === "pending" ? [
    ["REQ-1042", "استئذان", "02 أغسطس 2026", "14 أغسطس · 03:00 م — 06:00 م", "موعد طبي", "مرفق واحد"],
    ["REQ-1038", "تعديل دوام", "31 يوليو 2026", "17 أغسطس", "تغطية الشفت المسائي", "بدون مرفقات"],
  ] : scope === "accepted" ? [
    ["REQ-1027", "إجازة", "20 يوليو 2026", "25 — 27 يوليو", "ظرف عائلي", "مرفقان"],
  ] : [
    ["REQ-1019", "استئذان", "12 يوليو 2026", "15 يوليو", "التزام شخصي", "بدون مرفقات"],
  ];

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2 title="الطلبات" description="مراجعة الطلبات والمرفقات والملاحظات الإدارية وسجل الإجراءات مع حالات الفراغ والتحميل." badge={<WorkspaceStatusBadgeV2 tone="gold">طلبان معلقان</WorkspaceStatusBadgeV2>} />

      <WorkspaceCardV2 title="تصفية الطلبات" description="اختيار الحالة ونموذج العرض لاختبار كل السيناريوهات.">
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-request-scope" label="حالة الطلب">
            <DashboardSelectV2 id="dsv2-ew-request-scope" value={scope} options={[{ value: "pending", label: "المعلقة" }, { value: "accepted", label: "المقبولة" }, { value: "rejected", label: "المرفوضة" }]} onChange={setScope} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-request-state" label="حالة النموذج">
            <DashboardSelectV2 id="dsv2-ew-request-state" value={viewState} options={[{ value: "ready", label: "بيانات جاهزة" }, { value: "loading", label: "تحميل" }, { value: "empty", label: "بدون طلبات" }]} onChange={setViewState} />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      {viewState === "ready" ? (
        <WorkspaceCardV2 title={scope === "pending" ? "الطلبات المعلقة" : scope === "accepted" ? "الطلبات المقبولة" : "الطلبات المرفوضة"} description={`${rows.length} طلبات في الحالة المحددة.`}>
          <WorkspaceTableV2
            headers={["الرقم", "النوع", "تاريخ التقديم", "الفترة المطلوبة", "السبب", "المرفقات", "الإجراءات"]}
            rows={rows.map((row) => [
              <strong>{row[0]}</strong>, row[1], row[2], row[3], row[4], row[5],
              <div className="dsv2-cluster">
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openDrawer("audit")}>التفاصيل</button>
                {scope === "pending" ? <>
                  <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "قبول الطلب؟", description: "سيتم تحديث سجل الموظفة وإشعارها بالقبول.", confirmLabel: "قبول", tone: "success", onConfirm: markDirty })}>قبول</button>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "رفض الطلب؟", description: "يجب إضافة ملاحظة إدارية واضحة قبل الرفض.", confirmLabel: "رفض", tone: "danger", onConfirm: markDirty })}>رفض</button>
                </> : null}
              </div>,
            ])}
          />
        </WorkspaceCardV2>
      ) : viewState === "loading" ? <WorkspaceStateShowcaseV2 /> : <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large"><strong>لا توجد طلبات في هذه الحالة</strong><span>ستظهر الطلبات الجديدة هنا فور تقديمها.</span></div>}

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="ملاحظات الإدارة" description="ملاحظة مرتبطة بآخر إجراء على الطلب.">
          <DashboardFieldV2 id="dsv2-ew-request-note" label="الملاحظة">
            <textarea id="dsv2-ew-request-note" className="dsv2-textarea" placeholder="اكتب سبب القبول أو الرفض أو أي توجيه للموظفة..." disabled={readOnly} onChange={markDirty} />
          </DashboardFieldV2>
        </WorkspaceCardV2>
        <WorkspaceCardV2 title="سجل الإجراءات" description="تسلسل زمني لا يمكن تعديله.">
          <ol className="dsv2-ew-timeline">
            <li><span>02 أغسطس · 11:20 ص</span><strong>تم تقديم الطلب</strong><small>بواسطة الموظفة</small></li>
            <li><span>02 أغسطس · 11:26 ص</span><strong>تم فتح المرفق</strong><small>بواسطة الموارد البشرية</small></li>
            <li><span>بانتظار الإجراء</span><strong>قرار الإدارة</strong><small>لم يُسجل بعد</small></li>
          </ol>
        </WorkspaceCardV2>
      </div>
    </div>
  );
}

export function LeavesTabV2({ readOnly, markDirty, requestConfirm }: EmployeeWorkspaceTabProps) {
  const [movementType, setMovementType] = useState("add");
  const [onLeave, setOnLeave] = useState(true);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2 title="الإجازات" description="الرصيد والحالة الحالية والاستحقاق والإجازات الأسبوعية الاستثنائية وسجل الحركات والعكس." badge={<WorkspaceStatusBadgeV2 tone={onLeave ? "gold" : "success"}>{onLeave ? "في إجازة" : "على رأس العمل"}</WorkspaceStatusBadgeV2>} />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="الرصيد الحالي" value="18 يومًا" tone="success" />
        <WorkspaceMetricV2 label="المستخدم" value="7 أيام" />
        <WorkspaceMetricV2 label="المتبقي السنوي" value="18 يومًا" tone="gold" />
        <WorkspaceMetricV2 label="الاستحقاق القادم" value="01 يناير 2027" />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="حالة الإجازة الحالية" description="معلومات العودة والملاحظة التشغيلية.">
          <WorkspaceSwitchV2 checked={onLeave} disabled={readOnly} label="الموظفة في إجازة" description="يظهر التنبيه في ملفها وجدول الحضور." onChange={(checked) => { setOnLeave(checked); markDirty(); }} />
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-leave-return" label="تاريخ العودة">
              <DashboardDatePickerV2 id="dsv2-ew-leave-return" defaultValue="2026-08-18" disabled={readOnly || !onLeave} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-leave-note" label="ملاحظة الإجازة">
              <input id="dsv2-ew-leave-note" className="dsv2-input" defaultValue="إجازة سنوية معتمدة" disabled={readOnly || !onLeave} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
          <WorkspaceNoticeV2 title="العودة المتوقعة" description="الثلاثاء 18 أغسطس 2026 — الشفت الصباحي." tone="gold" />
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="حركة رصيد جديدة" description="إضافة أو خصم أيام مع سبب إلزامي ورصيد قبل وبعد.">
          <WorkspaceChoicePillsV2 value={movementType} disabled={readOnly} options={[{ value: "add", label: "إضافة أيام" }, { value: "deduct", label: "خصم أيام" }]} onChange={(value) => { setMovementType(value); markDirty(); }} />
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="dsv2-ew-leave-days" label="عدد الأيام" required>
              <input id="dsv2-ew-leave-days" className="dsv2-input" inputMode="numeric" dir="ltr" defaultValue="2" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-leave-entitlement" label="تاريخ الاستحقاق">
              <DashboardDatePickerV2 id="dsv2-ew-leave-entitlement" defaultValue="2026-08-01" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="dsv2-ew-leave-movement-reason" label="سبب الحركة" required className="dsv2-ew-form-wide">
              <input id="dsv2-ew-leave-movement-reason" className="dsv2-input" placeholder="مثال: تسوية رصيد بداية العقد" disabled={readOnly} onChange={markDirty} />
            </DashboardFieldV2>
          </div>
          <div className="dsv2-ew-balance-preview"><span>الرصيد قبل</span><strong>18</strong><span>الرصيد بعد</span><strong>{movementType === "add" ? "20" : "16"}</strong></div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="الإجازات الأسبوعية الاستثنائية" description="أيام راحة إضافية مؤقتة لا تغيّر الإجازة الأسبوعية الأساسية.">
        <WorkspaceTableV2 headers={["التاريخ", "اليوم", "السبب", "الحالة", "الإجراء"]} rows={[["23 أغسطس 2026", "الأحد", "تعويض عن فعالية", <WorkspaceStatusBadgeV2 tone="success">معتمدة</WorkspaceStatusBadgeV2>, <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>تعديل</button>], ["30 أغسطس 2026", "الأحد", "طلب موظفة", <WorkspaceStatusBadgeV2 tone="gold">مجدولة</WorkspaceStatusBadgeV2>, <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly}>إلغاء</button>]]} />
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="سجل حركات الرصيد" description="كل حركة تعرض الرصيد قبل وبعد ويمكن عكسها بدل حذف التاريخ.">
        <WorkspaceTableV2
          headers={["التاريخ", "الحركة", "الأيام", "الرصيد قبل", "الرصيد بعد", "السبب", "الإجراء"]}
          rows={[
            ["01 أغسطس 2026", <WorkspaceStatusBadgeV2 tone="success">إضافة</WorkspaceStatusBadgeV2>, "+2", "16", "18", "استحقاق شهري", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "عكس حركة الرصيد؟", description: "سيُنشئ النظام حركة عكسية ويحافظ على السجل الأصلي.", confirmLabel: "عكس الحركة", tone: "gold", onConfirm: markDirty })}>عكس</button>],
            ["25 يوليو 2026", <WorkspaceStatusBadgeV2 tone="danger">خصم</WorkspaceStatusBadgeV2>, "-3", "19", "16", "إجازة معتمدة", <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly}>التفاصيل</button>],
            ["01 يوليو 2026", <WorkspaceStatusBadgeV2 tone="success">إضافة</WorkspaceStatusBadgeV2>, "+2", "17", "19", "استحقاق شهري", <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly} onClick={() => requestConfirm({ title: "حذف الحركة اليدوية؟", description: "الحذف متاح فقط للحركات غير المرتبطة بطلب أو مسير مقفل.", confirmLabel: "حذف الحركة", tone: "danger" })}>حذف</button>],
          ]}
        />
      </WorkspaceCardV2>
    </div>
  );
}
