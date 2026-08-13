# تدقيق نظام المستندات والطباعة والتصدير

تاريخ التدقيق: 2026-08-13

## الهدف

يوثق هذا الملف مسارات الطباعة والتصدير الحالية، ويفصل بين نظام النماذج الرسمية A4 وبين Export V2 للتقارير البنيوية. إنهاء طلب الإجازة لا يعني أن كل مسار طباعة قديم في المشروع تم ترحيله.

## معمارية النماذج الرسمية

```text
Canonical data / view model
        ↓
Shared Document Core
        ↓
Format adapters
        ├── Browser Print
        ├── PDF
        ├── DOCX
        └── XLSX
```

المكونات الحالية لطلب الإجازة:

- `src/documents/core/DocumentPage.tsx`
- `src/documents/core/documentPrint.css`
- `src/documents/core/documentBranding.ts`
- `src/documents/core/officeZip.ts`
- `src/documents/leave/leaveRequestModel.ts`
- `src/components/hr/LeaveRequestDocument.tsx`
- `src/services/leaveRequestExport.ts`

## Inventory

| المستند / التقرير | نقطة الاستخدام | التنفيذ الحالي | الحالة |
|---|---|---|---|
| طلب الإجازة | `/dashboard/requests` + `/employee/requests/:requestId` | `LeaveRequestDocument` + `leaveRequestExport` | على Document Core؛ Print/PDF/DOCX/XLSX؛ لا يوجد dynamic print zoom؛ branding/watermark مركزيان |
| المصروفات | Dashboard reports | `exportExpensesReport.ts` + Export V2 | PDF/XLSX عبر Export V2؛ تقرير بنيوي وليس خطاب A4 |
| الدخل | Dashboard reports | `exportIncomeReport.ts` + Export V2 | PDF/XLSX عبر Export V2 |
| النظرة المالية | Dashboard reports | `exportFinancialOverviewReport.ts` + Export V2 | PDF/XLSX عبر Export V2 |
| الرواتب V2 | HR/Payroll | `exportPayrollReportV2.ts` + Export V2 | PDF/XLSX عبر Export V2 |
| الرواتب القديم | HR/Payroll | `exportPayrollReport.ts` | ما زال يحتوي مسار طباعة مستقل ويحتاج migration منفصل قبل الحذف |
| أداء الموظفات | Reports | `exportStaffPerformanceReport.ts` | ما زال يحتوي مسار طباعة مستقل |
| تدقيق اليوم | Dashboard | `DashboardDayAudit.tsx` | يحتوي `window.print()` مباشر؛ ليس على Document Core حتى الآن |
| نجاح/إيصال داخلي | Internal success | `SuccessInternal.tsx` | طباعة خاصة؛ لا يتم دمجها تلقائيًا مع نموذج HR بدون تدقيق وظيفة الإيصال |
| Helpers التقارير | Reports | `src/helpers/reports/common.ts` | helper طباعة مشترك لمستهلكين قدامى؛ يبقى إلى حين نقل call sites |

## حالة متطلبات طلب الإجازة

1. **Canonical A4 layout:** منفذ؛ 210×297mm.
2. **Preview/Print separation:** منفذ؛ Browser Print داخل iframe معزول.
3. **بدون dynamic zoom/scale:** منفذ في مسار طلب الإجازة.
4. **Single data model:** `LeaveRequestDocumentData` مبني من `EmployeeRequest`.
5. **Black logo على الورق الفاتح:** Document Core يفرض treatment أسود، وPDF/DOCX يحولان الصورة إلى أسود قبل التصدير.
6. **Watermark:** مشتركة في Document Core؛ PDF يرسمها خلف المحتوى؛ DOCX يحملها في Header خلف جسم المستند.
7. **PDF:** A4 portrait من نفس view model، مع الشعار والتوقيعات والـwatermark.
8. **DOCX حقيقي:** Office Open XML ZIP، وليس HTML باسم `.doc`؛ RTL/Arabic + الصور والتوقيعات والـwatermark.
9. **XLSX:** Export V2 من نفس البيانات؛ RTL، A4، fit-to-width، شيت ملخص + شيت تفاصيل.
10. **Regression contracts:** تمنع رجوع `.doc`/`application/msword` أو dynamic print zoom وتتحقق من branding وRTL.

## ملاحظة XLSX

`branding.logoUrl` جزء من تقرير Export V2، لكن إدراج صورة شعار فعلية داخل ملف XLSX نفسه ليس مثبتًا في الـgeneric exporter الحالي. لذلك لا يوصف هذا الجزء بأنه مكتمل بصريًا مثل PDF/DOCX. إذا أصبح شرطًا إلزاميًا لكل ملفات Excel، يضاف image-part support إلى Export V2 نفسه بدل بناء مسار خاص بطلب الإجازة.

## ما لم يتم إغلاقه على مستوى المشروع كله

المسارات التالية لم تُرحّل بعد إلى Document Core/Export V2 بشكل كامل:

- `DashboardDayAudit.tsx`
- `exportPayrollReport.ts`
- `exportStaffPerformanceReport.ts`
- `SuccessInternal.tsx`
- المستهلكون المتبقون لـ`src/helpers/reports/common.ts`

قبل حذف أي مسار قديم يجب تحديد call sites، نقل الوظيفة، مقارنة المخرجات، تشغيل الاختبارات والبناء، والتأكد أن المسارات الحالية لم تفقد الطباعة أو التصدير.
