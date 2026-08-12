ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.

إصلاح بوابة العميلة + /booking + Packages Worker
=================================================

السبب الجذري
------------
1) صفحة /booking تستخدم Core D1 لقراءة الأقسام والموظفات والعروض.
2) Core Worker كان يعتبر المسارات عامة فقط عندما لا يوجد Authorization.
3) عند دخول العميلة بحسابها، المتصفح يرسل Firebase token، فيتحول الدور إلى client ثم يطبق Worker صلاحيات الموظفات ويعيد 403.
4) نفس الخطأ كان سيمنع إنشاء الحجز واستخدام الكوبون للعميلة المسجلة، وليس القراءة فقط.
5) خطأ 404 في my-wallet وmy-catalog يعني أن نسخة Packages Worker المنشورة أقدم من ملفات الواجهة.

ما تم إصلاحه
------------
- السماح للعميلة المسجلة باستخدام مسارات الحجز العامة:
  GET sections/categories/services/staff/availability/discounts/settings
  POST clients/bookings/discount use
- الإبقاء على عمليات الإدارة محمية.
- تقييد القراءة العامة حتى لا تعرض:
  الموظفات المخفيات من الحجز.
  الأقسام والخدمات غير النشطة.
  العروض المحذوفة أو غير المنشورة أو المنتهية أو المجدولة مستقبلًا.
  الإعدادات غير العامة.
- الإبقاء على /client/booking كتحويل متوافق إلى /booking.
- تضمين أحدث Routes للباقات:
  /api/packages/my-wallet
  /api/packages/my-catalog
  /api/packages/catalog
- إضافة فحص نشر باسم:
  npm run verify:client-workers

نتائج التحقق
------------
Core Worker: 53/53 ناجحة.
Packages D1 Worker: 20/20 ناجحة.
Frontend/Core: 36/36 ناجحة.
npm run build: ناجح.

ترتيب النشر الإجباري
--------------------
1) فك الملف داخل جذر المشروع.
2) تطبيق migrations الخاصة بالباقات.
3) نشر Packages Worker.
4) نشر Core Worker.
5) تشغيل فحص المسارات.
6) بناء الواجهة ورفع Git.

لا يكفي رفع الواجهة إلى Vercel؛ يجب نشر العاملين لأن الأخطاء الحالية صادرة من نسخ Workers المنشورة.
