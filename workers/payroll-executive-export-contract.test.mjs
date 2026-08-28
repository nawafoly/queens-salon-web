import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('official payroll exports are unified, professional and keep leave compensation separate', () => {
  const report = read('src/helpers/reports/exportPayrollReportV2.ts');
  const excel = read('src/services/exports-v2/payroll-executive-excel.ts');
  const pdf = read('src/services/exports-v2/payroll-executive-pdf.ts');
  const payslipExcel = read('src/services/exports-v2/payroll-payslip-excel.ts');
  const payslipPdf = read('src/services/exports-v2/payroll-payslip-pdf.ts');
  const dashboard = read('src/pages/DashboardPayroll.tsx');

  assert.doesNotMatch(report, /المستحق حتى اليوم|earnedToDate/);
  assert.doesNotMatch(pdf, /المستحق حتى اليوم|earnedToDate/);
  assert.doesNotMatch(excel, /المستحق حتى اليوم|earnedToDate/);
  assert.match(report, /leaveCompensation/);
  assert.match(report, /payrollLeaveCompensationHalalas/);
  assert.match(report, /تعويض رصيد الإجازات/);
  assert.match(report, /previousPeriodAdjustment/);
  assert.match(report, /exportPayrollExecutiveExcel/);
  assert.match(report, /exportPayrollMobileExcel/);
  assert.match(report, /exportPayrollReportMobileExcelV2/);
  assert.match(report, /exportPayrollExecutivePdf/);
  assert.match(report, /exportPayrollPayslipExecutiveExcel/);
  assert.match(report, /exportPayrollPayslipMobileExcel/);
  assert.match(report, /exportPayrollPayslipMobileExcelV2/);
  assert.match(report, /exportPayrollPayslipExecutivePdf/);

  assert.match(excel, /name: "مسيرة الرواتب"/);
  assert.match(excel, /name: "رواتب الجوال"/);
  assert.match(excel, /buildMobilePayrollSheet/);
  assert.match(excel, /exportPayrollMobileExcel/);
  assert.match(excel, /numFmtId="168"/);
  assert.match(excel, /const sheets = \[buildUnifiedPayrollSheet\(report\)\]/);
  assert.match(excel, /rightToLeft="1"/);
  assert.match(excel, /_xlnm\.Print_Area/);
  assert.match(excel, /تعويض رصيد الإجازات/);
  assert.match(excel, /مسيرة الرواتب الشهرية/);
  assert.match(excel, /تقرير تنفيذي وتشغيلي موحّد/);
  assert.match(excel, /const visibleColumnCount = Math.max\(21, detailColumns.length\)/);
  assert.match(excel, /التفاصيل المالية والتشغيلية الكاملة/);
  assert.match(excel, /مراجعات ما قبل الإقفال والسجلات المستبعدة/);
  assert.match(excel, /SUM\(I\$\{officialStart\}:I\$\{officialEnd\}\)/);

  assert.match(pdf, /تعويض رصيد الإجازات/);
  assert.match(pdf, /ضوابط محاسبية للمسيرة/);
  assert.match(pdf, /تسويات فترات سابقة/);

  assert.match(payslipExcel, /"كشف الراتب"/);
  assert.match(payslipExcel, /"كشف الجوال"/);
  assert.match(payslipExcel, /buildPayrollPayslipMobileExcelBytes/);
  assert.match(payslipExcel, /exportPayrollPayslipMobileExcel/);
  assert.match(payslipExcel, /تعويض رصيد الإجازات/);
  assert.match(payslipPdf, /كشف راتب موظفة/);
  assert.match(payslipPdf, /تعويض رصيد الإجازات/);
  assert.match(dashboard, /تصدير كشف راتب PDF/);
  assert.match(dashboard, /تصدير كشف راتب Excel/);
  assert.match(dashboard, /تصدير كشف راتب Excel جوال/);
  assert.match(dashboard, /exportPayrollPayslipMobileExcelV2/);
  assert.match(dashboard, /createPortal/);
  assert.match(dashboard, /Excel جوال/);
  assert.match(dashboard, /handleExportPayrollMobileExcel/);
});

test('payroll Excel exposes attendance, GOSI and deferred deductions with complete numeric totals', () => {
  const report = read('src/helpers/reports/exportPayrollReportV2.ts');
  const excel = read('src/services/exports-v2/payroll-executive-excel.ts');

  assert.match(report, /deferredAttendanceDeduction/);
  assert.match(report, /attendanceDeferredMissingHoursDeductionHalalas/);
  assert.match(report, /خصم حضور مؤجل \(لا يخصم هذه الفترة\)/);
  assert.match(report, /ترحيل خصم الحضور إلى/);
  assert.match(report, /خصم GOSI للموظفة/);
  assert.match(report, /مساهمة المنشأة GOSI/);

  assert.match(excel, /function isTotalableDetailColumn/);
  assert.match(excel, /column\.type === "number"/);
  assert.match(excel, /column\.type === "currency"/);
  assert.match(excel, /isHourColumn\(column\.key\)/);
  assert.match(excel, /0\.00 &quot;ر\.س&quot;/);
  assert.match(excel, /خصم الحضور المؤجل بند إفصاح فقط/);
  assert.match(excel, /للموظفة غير السعودية/);
});

test('payroll approval and next-period reconciliation are explicit source-of-truth operations', () => {
  const service = read('src/services/CorePayrollService.ts');
  const repository = read('workers/core/repositories/payroll.js');
  const migration = read('migrations/core/0028_payroll_approval_snapshots_carryovers.sql');

  assert.match(service, /reconcilePreviousPayrollCarryovers/);
  assert.match(service, /reconcileLockedEntries/);
  assert.match(repository, /payroll_approval_snapshots/);
  assert.match(repository, /payroll_carryover_adjustments/);
  assert.match(repository, /reconcilePayrollCarryoversBatch/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_approval_snapshots/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_carryover_adjustments/);
});
