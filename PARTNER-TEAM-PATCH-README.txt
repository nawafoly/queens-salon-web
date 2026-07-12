تحديث بيانات فريق الشريكات — Queens Salon

الملفات داخل هذا ZIP هي Patch محدد فقط، وليست نسخة كاملة من المشروع.

المزايا:
- حفظ لقطة تشغيلية آمنة لكل موظفة مرتبطة بالشريكة داخل D1.
- مزامنة الاسم والصورة والمسمى والقسم والخدمات والدوام والإجازة وإتاحة الحجز والمساحات.
- عرض بطاقات تفصيلية داخل /partner/team.
- منع نقل بيانات HR الحساسة مثل الراتب والهوية والملفات الرسمية.
- إصلاح التبويب النشط في سايد بار بوابة الشريكات.
- npm run dev يشغل Vite وPartner Worker معًا.

بعد فك الملفات داخل المشروع:

1) طبّق Migration على D1 المنشورة:
npx wrangler d1 migrations apply queens-salon-partners --remote --config wrangler.partners.jsonc

2) انشر Worker:
npx wrangler deploy --config wrangler.partners.jsonc

3) اختبر البناء:
npm run build

4) شغّل التطوير:
npm run dev

5) افتح لوحة الإدارة:
/dashboard/partners
ثم اضغط: مزامنة ملفات الفريق

6) افتح حساب الشريكة:
/partner/team

ملاحظة:
أعضاء الفريق الحاليون لن تظهر تفاصيلهم الجديدة حتى تنفيذ زر «مزامنة ملفات الفريق» مرة واحدة بعد تطبيق Migration.
