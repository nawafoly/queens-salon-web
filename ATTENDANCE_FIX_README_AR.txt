إصلاح تسجيل الحضور:
1) تم السماح بأصول تطبيق Android/Capacitor وموقع Vercel في CORS.
2) تم إضافة صلاحيات الموقع الدقيق إلى AndroidManifest.
3) تم تحسين التقاط GPS وعدم استخدام قراءة مخزنة.
4) أصبحت دقة 150 متر أو أقل معروضة كدقة مقبولة.
5) تم استبدال Failed to fetch برسالة عربية واضحة.

بعد نسخ الملفات إلى المشروع نفّذ من مجلد المشروع:
cd workers
npx wrangler deploy
cd ..
npm run build:staff
npx cap sync android

ثم أعد بناء/تثبيت تطبيق Android واسمح بخيار "الموقع الدقيق".
