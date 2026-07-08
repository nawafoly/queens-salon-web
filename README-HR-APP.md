# Queens Staff Portal — Android

أصبح المشروع يدعم ثلاث نسخ من نفس الكود:

- `web`: الموقع الكامل ويحتوي `/login` و`/hr`.
- `customer`: تطبيق العملاء، ولا يسمح بفتح المسارات الداخلية.
- `staff`: تطبيق الإدارة والموظفين، يبدأ من `/hr` ولا يعرض واجهة العملاء.

## إعداد أول مرة

بعد نسخ ملفات التعديل داخل المشروع، احذف ملف الإعداد القديم ثم ثبّت الحزم:

```powershell
Remove-Item .\capacitor.config.json -ErrorAction SilentlyContinue
npm install
```

## تشغيل تطبيق HR على Android

```powershell
npm run cap:sync:staff
npm run cap:open:staff
```

سيُفتح مشروع Android المستقل الموجود في:

```text
android-hr
```

بيانات التطبيق:

```text
App name: Queens Staff Portal
Package ID: com.queenssalon.staff
Start route: /hr
```

## تشغيل تطبيق العملاء على Android

```powershell
npm run cap:sync:customer
npm run cap:open:customer
```

## تشغيل الواجهات في المتصفح

```powershell
npm run dev:web
npm run dev:customer
npm run dev:staff
```
