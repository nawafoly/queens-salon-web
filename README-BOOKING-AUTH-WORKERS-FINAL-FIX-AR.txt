إصلاح نهائي: صلاحيات الحجز وربط هوية العميلة ونشر Workers
============================================================

المشكلة الجذرية
---------------
1) مسار الحجز العام/حساب العميل كان يستدعي GET /api/core/clients، وهو Endpoint إداري.
   لذلك كانت العميلة المسجلة تحصل على 403 عند حفظ الحجز.
2) Core Worker كان يعتمد على أدوار D1 فقط في بعض الحالات، فيتعامل مع حساب إداري صحيح
   كأنه بلا صلاحية إذا لم تتم مزامنة الدور إلى D1 بعد.
3) سجل Audit الخاص بالعميلة كان يُرسل إلى Endpoint إداري، فيظهر 403 مزعج في Console.
4) 404 في my-wallet وmy-catalog يعني أن Packages Worker المنشور قديم؛ رفع Vercel
   لا ينشر Cloudflare Workers تلقائياً.

ما تم إصلاحه
------------
- الحجز العام وحجز العميلة لا يستخدمان بحث العملاء الإداري.
- الحجز الإداري يحتفظ بالعميلة المختارة عبر clientId الصريح، ولا يربط UID الموظف بالعميلة.
- عند حجز العميلة من حسابها، Core Worker يحدد سجلها من Firebase Token على الخادم
  ويتجاهل أي clientId مزيف قادم من المتصفح.
- إنشاء/حل سجل العميلة أصبح Idempotent حسب UID أو الهاتف.
- Core Worker يسترجع الدور الحقيقي من ملف المستخدم الموثق في Firebase، مع بقاء
  تعيين D1 صاحب الأولوية عند وجوده.
- العميلة والضيف لا يستطيعان إسناد Firebase UID عشوائي لسجل عميلة أخرى.
- تم إيقاف إرسال Audit الخاص بالعميلة إلى Endpoint الإدارة؛ العمليات الأساسية
  تسجل Audit من داخل Worker نفسه.
- تم تضمين مسارات Packages Worker الصحيحة لـ my-wallet وmy-catalog.

نتائج التحقق المنفذة
--------------------
- Core Worker: 55/55 ناجحة.
- Frontend/Core integration: 40/40 ناجحة.
- Packages Worker: 33/33 ناجحة.
- npm run build: ناجح.

مهم جداً
--------
يجب نشر Core Worker وPackages Worker مباشرة عبر Wrangler. رفع GitHub/Vercel وحده
لن يغير النسخة الموجودة على workers.dev.

خطوات التطبيق
-------------
1) فك الملف داخل جذر المشروع.

2) شغّل الاختبارات والبناء:

npm run test:core:worker
npm run test:frontend:core
npm run test:packages:worker
npm run build

3) انشر Core Worker:

npx wrangler deploy --config .\wrangler.core.jsonc

لا توجد Migration جديدة لـ Core في هذا الإصلاح.

4) طبّق أي Migrations معلقة للباقات ثم انشر Packages Worker:

npx wrangler d1 migrations apply queens-salon-packages --remote --config .\wrangler.packages.jsonc
npx wrangler deploy --config .\wrangler.packages.jsonc

5) تحقق من النسخ المنشورة:

npm run verify:client-workers

المتوقع:
- Core sections/staff/discounts = HTTP 200
- Packages health = HTTP 200
- Packages my-wallet = HTTP 401 بدون تسجيل دخول، وليس 404
- Packages my-catalog = HTTP 401 بدون تسجيل دخول، وليس 404

6) ارفع التعديل:

git add --pathspec-from-file=BOOKING-AUTH-WORKERS-PATCH-FILES.txt
git commit -m "fix: secure client booking identity and worker authorization"
git push origin main

التحقق اليدوي بعد النشر
-----------------------
- افتح /booking بحساب عميلة مسجلة وأنشئ حجزاً.
- افتح الحجز الإداري، اختر عميلة، ثم أنشئ حجزاً لها.
- تحقق أن الحجزين يظهران في /client/bookings للحساب الصحيح.
- تحقق أن حساب عميلة أخرى لا يرى الحجز.
- افتح /client/packages وتأكد أن my-wallet وmy-catalog لم يعودا 404.
