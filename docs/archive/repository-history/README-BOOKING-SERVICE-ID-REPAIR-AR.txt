ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.

إصلاح نهائي لخطأ core_service:not_found في /booking
====================================================

السبب الجذري:
1) سلة أو bookingDraft قديمة يمكن أن تحتفظ بمعرف خدمة Firestore.
2) الحفظ يتم إلى Core D1 الذي يطلب معرف الخدمة القانوني في جدول services.
3) التعديل السابق كان يحمّل كتالوج Core، لكنه لم يحوّل serviceId القديم داخل السلة قبل الإرسال.
4) التطابق في Worker كان مطابقًا حرفيًا للاسم، لذلك لا يطابق اختلافات مثل:
   "الاستشوار - شعر قصير" و "استشوار قصير".

الإصلاح:
- إصلاح السلة القديمة تلقائيًا بعد تحميل كتالوج Core.
- تحويل serviceId إلى معرف Core القانوني مرة ثانية قبل الحفظ مباشرة.
- إيقاف الطلب برسالة مفهومة بدل إرسال معرف غير صالح إذا لم يوجد تطابق وحيد.
- جعل Core Worker يطابق أسماء الخدمات العربية بعد توحيد الهمزات والتاء المربوطة
  والشرطات و(الـ) التعريف، ويقبل فقط تطابقًا وحيدًا وآمنًا.
- لا ينشئ Worker خدمة جديدة من بيانات المتصفح، ولا يغير مصدر الحقيقة.

نتائج التحقق:
- Core Worker: 57/57 ناجحة.
- Frontend/Core: 42/42 ناجحة.
- Packages Worker: 34/34 ناجحة.
- npm run build: ناجح.
- ملف JavaScript الناتج من البناء المصحح: dist/assets/index-BD1Mydyl.js

مهم في النشر:
الرابط queens-salon-web-gnxk.vercel.app الظاهر في الفحص هو رابط Deployment/Preview قديم
ويعرض index-DDlYVaRs.js. لا تختبره بعد إنشاء Deployment جديد. استخدم رابط الإنتاج
المثبت أو رابط Deployment الجديد الذي يطبعه Vercel CLI.
