إصلاح تشغيل Dry Run لترحيل الباقات إلى Core D1 على Windows

السبب:
كان السكربت يشغّل npx.cmd مباشرة عبر spawnSync مع shell=false. ملفات .cmd لا تُشغّل بهذه الطريقة بثبات على Windows، لذلك كانت العملية تتوقف قبل تنفيذ أول SELECT وتعرض رسالة بلا تفاصيل.

ما تم:
- تشغيل Wrangler المحلي مباشرة عبر node عند توفره.
- fallback آمن عبر npm exec.
- fallback أخير على Windows باستخدام shell.
- تحسين رسالة الخطأ لتعرض spawn error وstderr وstdout وexit status.
- إضافة اختبارين خاصين بمسار Windows.

بعد فك الملف داخل المشروع:
1) npm run test:core:packages
2) npm run migrate:packages-to-core:dry
3) Get-Content .\packages-to-core-main.sql.report.json

لا تنفذ --apply قبل مراجعة التقرير.
