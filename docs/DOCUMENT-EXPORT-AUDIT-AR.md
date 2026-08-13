# تدقيق نظام المستندات والطباعة والتصدير

تاريخ التدقيق: 2026-08-13

## الهدف

هذا الملف يوثق نقاط الطباعة والتصدير التي تم العثور عليها في المشروع ويمنع اعتبار إصلاح طلب الإجازة وحده نهاية للمهمة.

## المصدر الموحد الجديد للمستندات الرسمية

```text
Canonical data/view model
        ↓
Shared document core
        ↓
Format adapters
        ├── Browser Print
        ├── PDF
        ├── DOCX
        └── XLSX
```

المكونات الحالية:

- `src/documents/core/DocumentPage.tsx`
- `src/documents/core/documentPrint.css`
- `src/documents/core/documentBranding.ts`
- `src/documents/core/officeZip.ts`
- `src/documents/leave/leaveRequestModel.ts`
- `src/components/hr/LeaveRequestDocument.tsx`
- `src/services/leaveRequestExport.ts`

## Inventory

| المستند / التقرير | المسار / نقطة الاستخدام | التنفيذ | الحالة الحالية |
|---|---|---|---|
| طلب الإجازة | `/dashboard/requests` + `/employee/requests/:requestId` | `LeaveRequestDocument` + `leaveRequestExport` | على Document Core؛ Print/PDF/DOCX/XLSX متاحة؛ لا يوجد dynamic print zoom؛ الشعار/الـwatermark مركزيان في مسار الإغلاق الحالي |
| التقارير المالية - المصروفات | Dashboard reports | `exportExpensesReport.ts` + Export V2 | يستخدم Export V2 لـPDF/XLSX؛ ليس نموذج A4 خطابًا |
| التقارير المالية - الدخل | Dashboard reports | `exportIncomeReport.ts` + Export V2 | يستخدم Export V2 لـPDF/XLSX؛ ليس نموذج A4 خطابًا |
| النظرة المالية | Dashboard reports | `exportFinancialOverviewReport.ts` + Export V2 | يستخدم Export V2 لـPDF/XLSX |
| تقرير الرواتب V2 | HR/Payroll | `exportPayrollReportV2.ts` + Export V2 | يستخدم Export V2 لـPDF/XLSX |
| تقرير الرواتب القديم | HR/Payroll | `exportPayrollReport.ts` | ما زال يحتوي مسار طباعة مستقل؛ يحتاج migration منفصل قبل حذف القديم |
| تقرير أداء الموظفات | Reports | `exportStaffPerformanceReport.ts` | يحتوي مسار طباعة مستقل؛ يحتاج migration منفصل قبل حذف القديم |
| تدقيق اليوم | Dashboard | `DashboardDayAudit.tsx` | يحتوي `window.print()` مباشر؛ ليس بعد على Document Core |
| نجاح/إيصال داخلي | Internal success | `SuccessInternal.tsx` | يحتوي طباعة خاصة؛ يجب عدم خلطه تلقائيًا بنموذج HR قبل تدقيق متطلبات الإيصال |
| Report common helpers | Reports | `src/helpers/reports/common.ts` | يحتوي helper للطباعة؛ يجب إبقاؤه مؤقتًا حتى نقل المستهلكين المتبقين |

## ما تم من المتطلبات الأصلية في طلب الإجازة

1. Canonical A4 layout: منفذ.
2. فصل Preview عن Print: منفذ؛ الطباعة تتم داخل iframe معزول.
3. إزالة dynamic `zoom`/`scale`: منفذ في مسار طلب الإجازة.
4. مصدر بيانات واحد: `LeaveRequestDocumentData` مبني من `EmployeeRequest`.
5. PDF A4: منفذ بواسطة format adapter مستقل من نفس view model.
6. DOCX حقيقي: منفذ كـOffice Open XML ZIP، وليس HTML باسم `.doc`.
7. XLSX: يستخدم Export V2، RTL وA4 وfit-to-width وشيت ملخص + شيت تفاصيل.
8. التوقيعات: الموظفة والمراجع تنتقل إلى PDF/DOCX عند توفر الصورة.
9. Watermark: جزء من Document Core وPDF، ويضاف إلى DOCX في مسار الإغلاق الحالي.
10. شعار المستندات الفاتحة: يعالج كلون أسود بدل الاعتماد على لون asset الأصلي.

## أشياء لا يجوز وصفها بأنها منتهية للمشروع كله

- `DashboardDayAudit.tsx` ما زال بطباعة مستقلة.
- `exportPayrollReport.ts` القديم ما زال بطباعة مستقلة.
- `exportStaffPerformanceReport.ts` ما زال بطباعة مستقلة.
- `SuccessInternal.tsx` ما زال بطباعة مستقلة.
- Export V2 هو مسار التقارير البنيوية، وDocument Core هو مسار النماذج/الخطابات الرسمية؛ لا يجب دمجهما قسرًا في template واحد.

## سياسة الإزالة

ممنوع حذف أي مسار Legacy أعلاه قبل:

1. تحديد كل call sites.
2. نقل الوظيفة إلى البديل المناسب.
3. مقارنة output بصريًا.
4. تشغيل الاختبارات والبناء.
5. التأكد أن لا route فقد وظيفة الطباعة أو التصدير.

## Definition of Done لطلب الإجازة

- A4 210×297mm.
- RTL عربي.
- Black Malikat logo على الخلفية البيضاء.
- Watermark خلف المحتوى.
- Browser print بلا dynamic zoom.
- PDF صفحة واحدة للحالة الطبيعية.
- DOCX حقيقي مع RTL والصور والتوقيعات والـwatermark.
- XLSX منظم، RTL، A4، fit-to-width، ملخص + تفاصيل.
- نفس `LeaveRequestDocumentData` يغذي format adapters.
- contract tests تمنع الرجوع إلى `.doc`/`application/msword` أو dynamic print zoom.
