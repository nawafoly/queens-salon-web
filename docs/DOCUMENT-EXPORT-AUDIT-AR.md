# تدقيق نظام المستندات والطباعة والتصدير

تاريخ آخر تحديث: 2026-08-13

## الهدف

يوثق هذا الملف مسارات الطباعة والتصدير الفعلية بعد إغلاق إصلاحات المستندات، ويفصل هندسيًا بين ثلاثة أنواع مختلفة يجب ألا تختلط:

1. **النماذج الرسمية A4** مثل طلب الإجازة.
2. **التقارير البنيوية** التي تخرج PDF/XLSX عبر Export V2.
3. **إيصالات الطابعة الحرارية 80mm** التي تستخدم Browser Print بقياس ديناميكي مقصود وليست مستندات A4.

## المعمارية النهائية للنماذج الرسمية

```text
Canonical data / view model
        ↓
Shared Document Core
        ↓
Central Document Branding
        ↓
Format adapters
        ├── Browser Print (A4)
        ├── PDF (A4)
        ├── DOCX (OOXML)
        └── XLSX (structured report)
```

المكونات الحالية:

- `src/documents/core/DocumentPage.tsx`
- `src/documents/core/documentPrint.css`
- `src/documents/core/documentBranding.ts`
- `src/documents/core/officeZip.ts`
- `src/documents/leave/leaveRequestModel.ts`
- `src/components/hr/LeaveRequestDocument.tsx`
- `src/services/leaveRequestExport.ts`

## Export V2 للتقارير

المصدر المشترك للتقارير البنيوية:

- `src/services/exports-v2/types.ts`
- `src/services/exports-v2/excel.ts`
- `src/services/exports-v2/excel-multisheet.ts`
- `src/services/exports-v2/pdf.ts`
- `src/services/exports-v2/pdf-multitable.ts`

تمت إضافة دعم التقارير متعددة الجداول حتى لا يتم فقد تفاصيل الحجوزات والخدمات في تقرير أداء الموظفات.

## Inventory الحالي

| المستند / التقرير | نقطة الاستخدام | التنفيذ الحالي | الحالة |
|---|---|---|---|
| طلب الإجازة | `/dashboard/requests` + `/employee/requests/:requestId` | `LeaveRequestDocument` + `leaveRequestExport` | **PASS** — Document Core؛ A4 Print/PDF + real DOCX + XLSX؛ لا dynamic zoom؛ black logo + watermark في Web/Print/PDF/DOCX |
| الحضور والانضباط | Dashboard attendance reports | `exportAttendanceReport.ts` | **PASS** — PDF/XLSX عبر Export V2 من View Model واحد؛ لا `window.print()` كبديل PDF |
| أداء الموظفات | Dashboard staff performance | `exportStaffPerformanceReport.ts` | **PASS** — PDF متعدد الجداول + XLSX متعدد الشيتات عبر Export V2؛ يحافظ على أداء الموظفات + الحجوزات + الخدمات |
| الرواتب | HR/Payroll | `exportPayrollReportV2.ts` | **PASS** — PDF/XLSX/Payslip PDF عبر Export V2 |
| eligibility الرواتب | HR/Payroll | `exportPayrollReport.ts` | **PASS** — قواعد eligibility فقط؛ تم حذف Runtime التصدير القديم منه |
| المصروفات | Dashboard reports | `exportExpensesReport.ts` | **PASS** — PDF/XLSX عبر Export V2 |
| الدخل | Dashboard reports | `exportIncomeReport.ts` | **PASS** — PDF/XLSX عبر Export V2 |
| النظرة المالية | Dashboard reports | `exportFinancialOverviewReport.ts` | **PASS** — PDF/XLSX عبر Export V2 |
| Legacy report common | Reports | `src/helpers/reports/common.ts` | **RETIRED** — tombstone فقط بدون PDF/Excel runtime أو `window.print()` |
| جرد اليوم | Dashboard Day Audit | `DashboardDayAudit.tsx` | **INTENTIONAL THERMAL PRINT** — إيصال 80mm، وليس A4/PDF exporter؛ Browser Print هو format المطلوب للطابعة الحرارية |
| الإيصال الداخلي | Internal Success | `SuccessInternal.tsx` | **INTENTIONAL THERMAL PRINT** — 80mm بارتفاع ديناميكي محسوب من المحتوى؛ ليس مستند A4 |

## لماذا لا يتم إجبار الإيصالات الحرارية على DocumentPage A4؟

`DashboardDayAudit` يحدد `@page` بقياس 80mm، و`SuccessInternal` يقيس ارتفاع الإيصال ويحدد `80mm × contentHeight` حتى لا تطبع الطابعة الحرارية فراغًا طويلًا. هذا اختلاف وظيفي حقيقي وليس Legacy fallback. توحيدها قسرًا على A4 سيكسر وظيفة الطباعة.

القاعدة النهائية:

```text
Formal HR document  → Document Core / A4
Structured report   → Export V2 / PDF + XLSX
Thermal receipt     → Thermal Print Runtime / 80mm
```

## حالة متطلبات طلب الإجازة

1. **Canonical A4 layout:** PASS — 210×297mm.
2. **Preview/Print separation:** PASS — Browser Print داخل iframe معزول.
3. **بدون dynamic zoom/scale:** PASS في مستند A4.
4. **Single data model:** PASS — `LeaveRequestDocumentData` مبني من `EmployeeRequest`.
5. **Black logo على الورق الفاتح:** PASS في Web/Print/PDF/DOCX؛ يتم تحويل الرسم فعليًا إلى أسود في PDF/DOCX وليس grayscale فقط.
6. **Watermark:** PASS — Shared Document Core؛ PDF خلف المحتوى؛ DOCX Header خلف المستند.
7. **PDF:** PASS — A4 portrait من نفس View Model مع الشعار والتوقيعات والـwatermark.
8. **DOCX حقيقي:** PASS — Office Open XML ZIP، وليس HTML باسم `.doc`؛ RTL/Arabic + Tahoma + signatures + logo + watermark.
9. **XLSX:** PASS وظيفيًا — structured RTL report، A4، fit-to-width، summary/details من نفس البيانات.
10. **Regression contracts:** PASS — تمنع `.doc`/`application/msword` وdynamic print zoom والعودة لReport browser-print PDF.

## ملاحظة صريحة عن شعار XLSX

Export V2 الحالي يحمل Branding نصيًا داخل ملف Excel ويضبط RTL/A4/fit-to-page، لكنه **لا يثبت إدراج صورة شعار raster فعلية داخل كل XLSX generic**. لذلك شرط "الشعار الأسود كصورة" مثبت في Web/Print/PDF/DOCX، أما XLSX فهو branded structured workbook وليس نسخة بصرية مطابقة لنموذج A4.

إذا أصبح إدراج صورة الشعار داخل XLSX شرطًا إلزاميًا مستقلًا، يجب تنفيذه مركزيًا في OOXML Excel drawing parts لكل Export V2، وليس Patch خاصًا بطلب الإجازة.

## Legacy cleanup المنفذ

- إزالة `LeaveRequestPrintCompact.css`.
- إزالة HTML-as-Word و`.doc`/`application/msword`.
- إزالة dynamic print `zoom` من طلب الإجازة.
- نقل Attendance PDF من HTML/Browser Print إلى Export V2 PDF.
- نقل Staff Performance من HTML/Browser Print إلى Export V2 multitable PDF + multisheet XLSX.
- إزالة وظائف Payroll PDF/Excel القديمة من `exportPayrollReport.ts` مع إبقاء eligibility rules المستخدمة.
- تعطيل `src/helpers/reports/common.ts` وتحويله إلى tombstone بدون Runtime.

## Acceptance Matrix

| # | المتطلب | الحالة |
|---|---|---|
| 1 | Audit كامل | PASS |
| 2 | Root Cause | PASS |
| 3 | Canonical A4 Layout | PASS |
| 4 | Preview/Print separation | PASS |
| 5 | PDF | PASS |
| 6 | Real DOCX | PASS |
| 7 | XLSX structured export | PASS |
| 8 | Single Data Model | PASS |
| 9 | RTL/Arabic | PASS |
| 10 | Signatures | PASS |
| 11 | Images / black logo on light formal documents | PASS |
| 12 | Watermark | PASS |
| 13 | One-page normal Leave Request | PASS by layout contract; browser visual smoke remains runtime verification |
| 14 | Browser Print A4 | PASS |
| 15 | All Documents/Exports Audit | PASS |
| 16 | No duplicated Leave templates | PASS |
| 17 | Legacy report runtime cleanup | PASS |
| 18 | Automated contract tests | PASS |
| 19 | CI build | PASS on Document Export Acceptance runs after migration |
| 20 | Visual Regression | Requires final human browser/Word visual inspection on a real request before declaring pixel-level parity |

## ما يحتاج فحصًا يدويًا وليس كودًا إضافيًا

بعد نجاح الـCI، آخر خطوة تشغيلية هي فتح طلب حقيقي مثل `LEV-2026-000003` ثم مقارنة:

- Web Preview
- Browser Print Preview
- PDF
- DOCX في Microsoft Word
- XLSX في Microsoft Excel

السبب أن CI يستطيع إثبات البنية والملفات والـbuild، لكنه لا يستطيع إثبات pixel-level rendering في نسخة Microsoft Word/Excel المثبتة على جهاز المستخدم.
