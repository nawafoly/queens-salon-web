إصلاح dashboard/reports - CORE D1

السبب:
.env.web كان مستبعدًا من Git، لذلك Vercel بنى التطبيق مع VITE_USE_CORE_D1=true بدون VITE_CORE_WORKER_URL.

التعديلات:
1) السماح بتتبع .env.web داخل Git.
2) الإبقاء على رابط Core Worker في .env.web.
3) منع تكرار رسالة الخطأ نفسها كل 12 ثانية داخل DashboardReports.

بعد نسخ الملفات إلى جذر المشروع:
git add .gitignore .env.web src/pages/DashboardReports.tsx README-CORE-D1-REPORTS-FIX-AR.txt
git commit -m "fix: provide core worker config for reports"
git push origin main

بديل/تعزيز في Vercel Production Environment Variables:
VITE_USE_CORE_D1=true
VITE_CORE_WORKER_URL=https://queens-salon-core-api.maedin.workers.dev
