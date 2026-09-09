import fs from 'node:fs';

function patch(path, edits) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of edits) {
    const count = text.split(from).length - 1;
    if (count !== 1) {
      throw new Error(`${path}: expected one ${label}, found ${count}`);
    }
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text, 'utf8');
}

patch('workers/core/repositories/annual-leave.js', [
  [
`  const openingRequired =
    !opening &&
    Boolean(
      legacyEvidence ||
      (!hasCanonicalActivity &&
        Math.abs(legacyBalanceDays) > EPSILON)
    );`,
`  // Opening balance is an optional migration aid, not a prerequisite for
  // canonical accrual. When no opening anchor exists, Core derives the
  // balance from service-date accrual plus canonical ledger movements.
  const openingRequired = false;`,
'optional opening balance guard'
  ],
  [
`  const days = halfDayValue(
    data.days ?? data.openingBalanceDays,
    'opening_balance_days',
    { allowZero: true }
  );`,
`  const rawOpeningDays = Number(
    data.days ?? data.openingBalanceDays
  );
  if (
    !Number.isFinite(rawOpeningDays) ||
    rawOpeningDays < 0 ||
    rawOpeningDays > MAX_ANNUAL_BALANCE_DAYS
  ) {
    throw new AppError(
      400,
      'core_annual_leave:invalid_opening_balance_days'
    );
  }
  // Opening anchors can be derived from prorated accrual, so they must retain
  // sub-half-day precision. Manual corrections remain half-day constrained.
  const days = roundDays(rawOpeningDays);`,
'precise opening balance validation'
  ],
]);

patch('src/pages/dashboardEmployees/LeaveRestManagementPanel.tsx', [
  [
`import type { CoreLeave } from "../../types/hrCoreApi";
import {
  WEEKDAY_OPTIONS,`,
`import type { CoreLeave } from "../../types/hrCoreApi";
import { calculateAnnualLeaveAccrualRange } from "../../helpers/hr/saLeaveEntitlements.js";
import {
  WEEKDAY_OPTIONS,`,
'accrual helper import'
  ],
  [
`  const [
    serviceStartDate,
    setServiceStartDate,
  ] = useState("");

  const [
    openingBalanceDays,`,
`  const [
    serviceStartDate,
    setServiceStartDate,
  ] = useState("");

  const [annualContractDays, setAnnualContractDays] =
    useState<number | null>(null);

  const [
    openingBalanceDays,`,
'contract days state'
  ],
  [
`      const insuranceDate = clean(
        employment.social_insurance_effective_from ??
        employment.socialInsuranceEffectiveFrom
      );

      setPersistedServiceStartDate(`,
`      const insuranceDate = clean(
        employment.social_insurance_effective_from ??
        employment.socialInsuranceEffectiveFrom
      );

      const contractDays = Number(
        employment.annual_leave_contract_days ??
        employment.annualLeaveContractDays
      );
      setAnnualContractDays(
        Number.isFinite(contractDays) && contractDays > 0
          ? contractDays
          : null
      );

      setPersistedServiceStartDate(`,
'contract days load'
  ],
  [
`  const hasOpeningBalance =
    Boolean(
      annualLeave.openingBalance
    );

  const serviceStartSourceLabel =`,
`  const hasOpeningBalance =
    Boolean(
      annualLeave.openingBalance
    );

  const openingHistoricalUsedDays =
    openingBalanceDays === ""
      ? 0
      : Number(openingBalanceDays);

  const openingAccruedToEffectiveDate = useMemo(() => {
    if (
      !persistedServiceStartDate ||
      !openingBalanceEffectiveDate ||
      openingBalanceEffectiveDate < persistedServiceStartDate
    ) {
      return null;
    }

    try {
      const result = calculateAnnualLeaveAccrualRange({
        startDate: persistedServiceStartDate,
        asOfDate: openingBalanceEffectiveDate,
        contractAnnualDays: annualContractDays,
      }) as { accruedDays?: number };
      const value = Number(result.accruedDays);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }, [
    persistedServiceStartDate,
    openingBalanceEffectiveDate,
    annualContractDays,
  ]);

  const openingCalculatedRemainingDays =
    Number.isFinite(openingHistoricalUsedDays) &&
    openingAccruedToEffectiveDate !== null
      ? Math.max(
          0,
          Math.round(
            (openingAccruedToEffectiveDate -
              openingHistoricalUsedDays) *
              10000
          ) / 10000
        )
      : null;

  const serviceStartSourceLabel =`,
'opening calculation preview'
  ],
  [
`      const days =
        Number(openingBalanceDays);

      if (
        !Number.isFinite(days) ||
        days < 0
      ) {
        setMessage(
          "أدخل رصيدًا افتتاحيًا صالحًا."
        );
        return;
      }`,
`      const historicalUsedDays =
        openingBalanceDays === ""
          ? 0
          : Number(openingBalanceDays);

      if (
        !Number.isFinite(historicalUsedDays) ||
        historicalUsedDays < 0 ||
        Math.round(historicalUsedDays * 2) !==
          historicalUsedDays * 2
      ) {
        setMessage(
          "أدخل الأيام المستخدمة سابقًا بمضاعفات نصف يوم، مثل 0.5 أو 1 أو 1.5."
        );
        return;
      }

      if (
        openingAccruedToEffectiveDate === null ||
        openingCalculatedRemainingDays === null
      ) {
        setMessage(
          "تعذر احتساب الرصيد حتى تاريخ بدء النظام. تحقق من تاريخ بداية الخدمة وتاريخ السريان."
        );
        return;
      }

      if (
        historicalUsedDays >
        openingAccruedToEffectiveDate + 0.0001
      ) {
        setMessage(
          "الأيام المستخدمة سابقًا أكبر من الاستحقاق المكتسب حتى تاريخ بدء النظام."
        );
        return;
      }

      const days = openingCalculatedRemainingDays;`,
'opening submission calculation'
  ],
  [
`        setMessage(
          "تم تسجيل الرصيد الافتتاحي في السجل الموحد للإجازة السنوية."
        );`,
`        setMessage(
          "تم تسجيل الاستخدام السابق واحتساب الرصيد المتبقي تلقائيًا."
        );`,
'opening success message'
  ],
  [
`      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2
          label="الإجازة السنوية"
          value={
            loading
              ? "جاري التحميل..."
              : annualBalanceValue(
                  annualAvailable,
                  annualReviewRequired
                )
          }
          note={
            annualReviewRequired
              ? annualReviewReasonLabel(annualLeave.reviewReason)
              : "الرصيد المتاح"
          }
          tone={annualReviewRequired ? "gold" : "success"}
        />
        <WorkspaceMetricV2
          label="الراحة الأسبوعية"
          value={weeklyRestLabel}
          note="من جدول الدوام"
        />
        <WorkspaceMetricV2
          label="الراحة التعويضية"
          value={
            loading
              ? "جاري التحميل..."
              : numberLabel(
                  overview?.weeklyRest.dueDays,
                  " يوم"
                )
          }
          note="مستحقة بسبب العمل في يوم الراحة"
          tone={
            Number(
              overview?.weeklyRest.dueDays || 0
            ) > 0
              ? "gold"
              : "neutral"
          }
        />
      </div>

`,
``,
'top orphan metrics'
  ],
  [
`      <WorkspaceCardV2
        title="تفصيل رصيد الإجازة السنوية"
        description="يفصل بين الاستحقاق السنوي النظامي وبين الرصيد المتبقي المعتمد فعليًا للموظفة."
      >`,
`      <WorkspaceCardV2
        title="الإجازة السنوية"
        description="مرجع الخدمة والاستحقاق المكتسب والرصيد المتاح في مكان واحد. الاستحقاق السنوي هو معدل سنوي وليس الرصيد الحالي."
      >`,
'annual section title'
  ],
  [
`          <WorkspaceMetricV2
            label="الرصيد الافتتاحي"
            value={
              loading
                ? "جاري التحميل..."
                : annualReviewRequired &&
                    annualLeave.reviewReason === "opening_balance_required"
                  ? "مطلوب"
                  : numberLabel(annualLeave.openingBalanceDays ?? 0, " يوم")
            }
            tone={
              annualReviewRequired &&
              annualLeave.reviewReason === "opening_balance_required"
                ? "gold"
                : "neutral"
            }
          />
`,
``,
'opening metric inside annual summary'
  ],
  [
`      <WorkspaceCardV2
        title="الرصيد الافتتاحي / تسوية بدء النظام"
        description="سجل هنا فقط الرصيد المتبقي الذي تم اعتماده فعليًا عند بدء النظام. إذا كان السجل السابق غير مكتمل فلا تخمّن الرصيد."
      >`,
`      <WorkspaceCardV2
        title="تسوية بدء النظام (اختيارية)"
        description="إذا كانت الموظفة استخدمت إجازات قبل تشغيل النظام، أدخل فقط الأيام المستخدمة سابقًا. النظام يحسب الرصيد المتبقي تلقائيًا. إذا لم يوجد استخدام سابق فلا يلزم تسجيل أي تسوية."
      >`,
'opening section title'
  ],
  [
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-days"
            label="الرصيد المتبقي المعتمد"
          >`,
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-days"
            label="الأيام المستخدمة قبل بدء النظام"
          >`,
'opening input label'
  ],
  [
`              placeholder="مثال: 21 أو 15.5"`,
`              placeholder="مثال: 2 أو 3.5 — اتركه فارغًا إذا لم يوجد استخدام سابق"`,
'opening input placeholder'
  ],
  [
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-effective-date"
            label="تاريخ سريان الرصيد"
          >`,
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-effective-date"
            label="تاريخ بدء اعتماد النظام"
          >`,
'opening date label'
  ],
  [
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-reason"
            label="سبب التسوية"
          >`,
`          <DashboardFieldV2
            id="employee-live-v2-opening-balance-reason"
            label="ملاحظة التسوية (اختيارية)"
          >`,
'opening reason label'
  ],
  [
`              placeholder="مثال: الرصيد الفعلي عند بدء النظام"`,
`              placeholder="مثال: استخدام سابق مثبت من سجل الموارد البشرية"`,
'opening reason placeholder'
  ],
  [
`        <WorkspaceNoticeV2
          title={
            hasOpeningBalance
              ? "الرصيد الافتتاحي مثبت"
              : "تسوية انتقالية"
          }
          description={
            hasOpeningBalance
              ? "يوجد رصيد افتتاحي مسجل في السجل الموحد. الحركات والاستحقاقات التالية تستمر من خلال Core."
              : "أدخل فقط الرصيد المتبقي الذي اعتمدته الموارد البشرية في تاريخ السريان. إذا لم تعرف ما تم استخدامه سابقًا فلا تدخل رقمًا تقديريًا واترك الرصيد بحالة مراجعة حتى تتم التسوية."
          }
          tone={
            hasOpeningBalance
              ? "success"
              : "neutral"
          }
        />`,
`        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2
            label="المكتسب حتى تاريخ بدء النظام"
            value={
              openingAccruedToEffectiveDate === null
                ? "غير متوفر"
                : annualDurationLabel(
                    openingAccruedToEffectiveDate
                  )
            }
          />
          <WorkspaceMetricV2
            label="المستخدم سابقًا"
            value={
              Number.isFinite(openingHistoricalUsedDays)
                ? numberLabel(
                    openingHistoricalUsedDays,
                    " يوم"
                  )
                : "غير صالح"
            }
          />
          <WorkspaceMetricV2
            label="الرصيد المتبقي المعتمد"
            value={
              openingCalculatedRemainingDays === null
                ? "غير متوفر"
                : annualDurationLabel(
                    openingCalculatedRemainingDays
                  )
            }
            tone="success"
          />
        </div>

        <WorkspaceNoticeV2
          title={
            hasOpeningBalance
              ? "تسوية بدء النظام مثبتة"
              : openingBalanceDays === ""
                ? "لا توجد تسوية مطلوبة"
                : "معاينة قبل الاعتماد"
          }
          description={
            hasOpeningBalance
              ? "تم تثبيت نقطة البداية في السجل الموحد، وتستمر الاستحقاقات والحركات التالية تلقائيًا من خلال Core."
              : openingBalanceDays === ""
                ? "اترك الحقل فارغًا إذا لم تستخدم الموظفة أي أيام قبل تشغيل النظام. الرصيد الحالي يُحتسب تلقائيًا ولا يحتاج رصيدًا افتتاحيًا إجباريًا."
                : "سيحفظ النظام الرصيد المتبقي الناتج من الاستحقاق المكتسب ناقص الأيام المستخدمة سابقًا."
          }
          tone={hasOpeningBalance ? "success" : "neutral"}
        />`,
'opening explanation and computed result'
  ],
  [
`            openingBalanceDays === "" ||
            !openingBalanceEffectiveDate ||
            !openingBalanceReason.trim()`,
`            openingBalanceDays === "" ||
            !openingBalanceEffectiveDate`,
'opening button optional reason'
  ],
  [
`          اعتماد الرصيد المتبقي`,
`          اعتماد الاستخدام السابق`,
'opening button label'
  ],
  [
`              reason:
                openingBalanceReason.trim(),`,
`              reason:
                openingBalanceReason.trim() ||
                "تسوية استخدام سابق قبل بدء النظام",`,
'opening default reason'
  ],
  [
`      <WorkspaceCardV2
        title="الرصيد التاريخي للراحة التعويضية"`,
`      <WorkspaceCardV2
        title="الراحة الأسبوعية والتعويضية"
        description="هذا القسم مستقل عن الإجازة السنوية: يوم الراحة من جدول الدوام، والرصيد التعويضي ينتج فقط عن العمل المعتمد في يوم الراحة."
      >
        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2
            label="يوم الراحة الأسبوعية"
            value={weeklyRestLabel}
            note="من جدول الدوام"
          />
          <WorkspaceMetricV2
            label="الرصيد التعويضي الحالي"
            value={
              loading
                ? "جاري التحميل..."
                : numberLabel(
                    overview?.weeklyRest.dueDays,
                    " يوم"
                  )
            }
            note="مستحق بسبب العمل في يوم الراحة"
            tone={
              Number(overview?.weeklyRest.dueDays || 0) > 0
                ? "gold"
                : "neutral"
            }
          />
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="الرصيد التاريخي للراحة التعويضية"`,
'weekly rest section overview'
  ],
]);

console.log('Leave/rest layout and optional opening patch applied.');
