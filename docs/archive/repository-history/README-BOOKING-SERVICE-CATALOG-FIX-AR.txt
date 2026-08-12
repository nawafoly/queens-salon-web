ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.

إصلاح نهائي: فشل حفظ /booking بسبب core_service:not_found + خطأ محفظة الباقات 404

السبب الجذري
1) صفحة src/pages/Booking.tsx كانت تستخدم listActiveSections عبر مصدر Core D1، ثم تجبر catalogMode على firestore وتقرأ service_categories وservices مباشرة من Firestore.
2) نتيجة ذلك: serviceId المختار من Firestore لا يطابق id الموجود داخل جدول services في Core D1، فيرفض POST /api/core/bookings برسالة core_service:not_found.
3) my-wallet وmy-catalog كانا يعيدان packages_client:not_found عندما تكون العميلة مسجلة في Firebase ولكن لم يُنشأ لها سجل داخل Packages D1 بعد.
4) الواجهة كانت تعتبر أي HTTP 404 دليلًا على أن Worker قديم، رغم أن المسار قد يكون موجودًا والخطأ هو غياب هوية العميلة.

ما تم إصلاحه
- عند VITE_USE_CORE_D1=true أصبحت أقسام وتصنيفات وخدمات /booking كلها تقرأ من Core D1 نفسه.
- عروض الخدمات والعروض التسلسلية لم تعد ترجع إلى Firestore لجلب خدمة أثناء Core cutover.
- طلب إنشاء الحجز يرسل serviceName snapshot مع serviceId.
- Core Worker يحاول أولًا serviceId الصحيح، ثم يسمح بتحويل معرف قديم إلى معرف Core canonical فقط عند وجود تطابق اسم دقيق وفريد داخل D1.
- لا يتم إنشاء خدمة من بيانات المتصفح؛ إذا لم تكن الخدمة موجودة أصلًا في Core D1 يبقى الحجز مرفوضًا لحماية مصدر الحقيقة.
- my-wallet وmy-catalog ينشئان هوية Packages D1 للعميلة المسجلة عند أول دخول، ويرجعان محفظة فارغة بدل 404.
- ترجمة أخطاء الباقات أصبحت تفرق بين packages_api:not_found وبين غياب العميلة أو الباقة.

الاختبارات المنفذة
- Core Worker: 56/56 ناجحة.
- Packages Worker: 34/34 ناجحة.
- Frontend/Core: 41/41 ناجحة.
- npm run build: ناجح.

لا توجد Migration جديدة.

ترتيب النشر المطلوب
1) فك الملف داخل المشروع.
2) اختبار وبناء.
3) نشر Core Worker وPackages Worker.
4) رفع الواجهة إلى GitHub/Vercel.
5) تحديث إجباري Ctrl+Shift+R ثم إنشاء حجز جديد من /booking.

ملاحظة
الحجز الذي فشل لم يُحفظ أصلًا، لذلك يجب الضغط على حفظ مرة أخرى بعد النشر. لا يحتاج الأمر إلى حذف بيانات.
