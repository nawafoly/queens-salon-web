export type UserRole =
  | "owner"
  | "admin"
  | "hr"
  | "accountant"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

export type LegacyPermission =
  | "BOOKINGS_VIEW"
  | "BOOKINGS_UPDATE_STATUS"
  | "BOOKINGS_ADD_NOTES"
  | "EMPLOYEES_MANAGE"
  | "SERVICES_MANAGE"
  | "OFFERS_MANAGE"
  | "REPORTS_VIEW"
  | "SETTINGS_MANAGE"
  | "USERS_MANAGE";

export const PERMISSION_SCHEMA_VERSION = 4;

export type PermissionGroup =
  | "workspace"
  | "bookings"
  | "customers"
  | "finance"
  | "inventory"
  | "workforce"
  | "reports"
  | "content"
  | "system";

export type AppPermission =
  | "workspace.dashboard.view"
  | "workspace.employee_portal.view"
  | "bookings.view"
  | "bookings.create"
  | "bookings.update"
  | "bookings.cancel"
  | "bookings.delete"
  | "bookings.payment.manage"
  | "bookings.print"
  | "bookings.bulk.manage"
  | "bookings.day_audit.manage"
  | "bookings.queue_tv.view"
  | "clients.view"
  | "clients.manage"
  | "clients.packages.manage"
  | "clients.loyalty.manage"
  | "income.view"
  | "income.manage"
  | "expenses.view"
  | "expenses.manage"
  | "inventory.view"
  | "inventory.items.manage"
  | "inventory.recipes.manage"
  | "inventory.consume.confirm"
  | "inventory.movements.view"
  | "inventory.adjust"
  | "inventory.waste.record"
  | "employees.view"
  | "employees.create"
  | "employees.update"
  | "employees.delete"
  | "employees.manage"
  | "employees.files.view"
  | "employees.files.manage"
  | "employees.schedule.manage"
  | "attendance.own.view"
  | "attendance.view"
  | "attendance.records.create"
  | "attendance.records.update"
  | "attendance.records.delete"
  | "attendance.absences.manage"
  | "attendance.leaves.manage"
  | "attendance.export"
  | "attendance.settings.manage"
  | "payroll.view"
  | "payroll.manage"
  | "targets.view"
  | "targets.manage"
  | "targets.approve"
  | "targets.adjust"
  | "targets.view_all"
  | "targets.view_own"
  | "staffPerformance.view"
  | "staffPerformance.manage"
  | "recruitment.view"
  | "recruitment.manage"
  | "reports.view"
  | "reports.export"
  | "weekly_reports.manager_notes"
  | "messages.view"
  | "messages.manage"
  | "catalog.manage"
  | "offers.manage"
  | "content.manage"
  | "partners.manage"
  | "logs.view"
  | "settings.manage"
  | "settings.general.manage"
  | "settings.booking.manage"
  | "settings.content.manage"
  | "admin_accounts.view"
  | "admin_accounts.manage"
  | "accounts.read"
  | "accounts.create"
  | "accounts.update"
  | "accounts.disable"
  | "accounts.restore"
  | "accounts.delete"
  | "accounts.reset_password"
  | "roles.read"
  | "roles.assign"
  | "roles.manage"
  | "permissions.read"
  | "employee_requests.own.view"
  | "employee_requests.own.create"
  | "employee_requests.own.comment"
  | "employee_requests.own.cancel"
  | "employee_requests.view"
  | "employee_requests.manage"
  | "employee_requests.receive"
  | "employee_requests.assign"
  | "employee_requests.request_info"
  | "employee_requests.approve"
  | "employee_requests.reject"
  | "employee_requests.execute"
  | "employee_requests.complete"
  | "employee_requests.internal_notes"
  | "employee_requests.resignation.execute"
  | "employee_requests.salary_advance.approve"
  | "employee_requests.attendance_correction.execute"
  | "employee_requests.reopen"
  | "employee_links.read"
  | "employee_links.manage"
  | "audit.read"
  | "permissions.manage";

export type Permission = LegacyPermission | AppPermission;

export type PermissionOverrides = {
  enabled: AppPermission[];
  disabled: AppPermission[];
};

export type PermissionMeta = {
  key: AppPermission;
  label: string;
  hint: string;
  group: PermissionGroup;
  action: "view" | "create" | "update" | "delete" | "manage" | "export" | "use";
  visible?: boolean;
  sensitive?: boolean;
};

export type PermissionGroupMeta = {
  key: PermissionGroup;
  label: string;
  hint: string;
};

export const APP_PERMISSION_GROUPS: PermissionGroupMeta[] = [
  { key: "workspace", label: "مساحات العمل", hint: "الدخول إلى اللوحات والبوابات الرئيسية." },
  { key: "bookings", label: "الحجوزات والتشغيل", hint: "الحجوزات، الفواتير، شاشة الانتظار وإغلاق اليوم." },
  { key: "customers", label: "العملاء والولاء", hint: "ملفات العملاء والباقات والولاء." },
  { key: "finance", label: "المالية", hint: "الإيرادات والمصروفات والتحكم المالي." },
  { key: "workforce", label: "الموظفات والموارد البشرية", hint: "الموظفات والحضور والرواتب والإجازات والتوظيف." },
  { key: "reports", label: "التقارير والتواصل", hint: "التقارير والتصدير والرسائل وسجل الحركات." },
  { key: "content", label: "المحتوى والتسويق", hint: "الكتالوج والعروض ومحتوى الموقع والشريكات." },
  { key: "system", label: "النظام والحسابات", hint: "الإعدادات والحسابات والأدوار والصلاحيات." },
];

export const APP_PERMISSION_CATALOG: PermissionMeta[] = [
  { key: "workspace.dashboard.view", label: "فتح لوحة التشغيل", hint: "الدخول إلى لوحة التحكم الرئيسية.", group: "workspace", action: "view" },
  { key: "workspace.employee_portal.view", label: "فتح بوابة الموظفة", hint: "الدخول إلى بوابة الموظفة والملف الشخصي.", group: "workspace", action: "view" },

  { key: "bookings.view", label: "عرض الحجوزات", hint: "عرض قائمة الحجوزات وتفاصيلها.", group: "bookings", action: "view" },
  { key: "bookings.create", label: "إنشاء حجز", hint: "إنشاء حجوزات داخلية جديدة.", group: "bookings", action: "create" },
  { key: "bookings.update", label: "تعديل الحجز", hint: "تعديل بيانات الحجز وحالته.", group: "bookings", action: "update" },
  { key: "bookings.cancel", label: "إلغاء الحجز", hint: "إلغاء حجز قائم مع تسجيل العملية.", group: "bookings", action: "manage" },
  { key: "bookings.delete", label: "حذف الحجز نهائيًا", hint: "حذف الحجوزات نهائيًا. صلاحية حساسة.", group: "bookings", action: "delete", sensitive: true },
  { key: "bookings.payment.manage", label: "إدارة دفعات الحجز", hint: "تسجيل الدفعات وتعديل طرق الدفع والمبالغ.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.print", label: "طباعة الفاتورة", hint: "عرض وطباعة فاتورة الحجز.", group: "bookings", action: "use" },
  { key: "bookings.bulk.manage", label: "الإجراءات الجماعية", hint: "تحديث مجموعة حجوزات دفعة واحدة.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.day_audit.manage", label: "إغلاق اليوم والشفت", hint: "مراجعة وإغلاق اليوم المالي والتشغيلي.", group: "bookings", action: "manage", sensitive: true },
  { key: "bookings.queue_tv.view", label: "عرض شاشة الحجوزات", hint: "فتح شاشة الانتظار والتشغيل التلفزيونية.", group: "bookings", action: "view" },

  { key: "clients.view", label: "عرض العملاء", hint: "عرض ملفات العملاء وسجلهم.", group: "customers", action: "view" },
  { key: "clients.manage", label: "إدارة العملاء", hint: "تعديل بيانات العملاء وربط الحسابات.", group: "customers", action: "manage" },
  { key: "clients.packages.manage", label: "إدارة باقات العملاء", hint: "إضافة الجلسات وخصمها وتعديل الأرصدة.", group: "customers", action: "manage" },
  { key: "clients.loyalty.manage", label: "إدارة الولاء", hint: "إدارة مستويات الولاء والمزايا والنقاط.", group: "customers", action: "manage" },

  { key: "income.view", label: "عرض الإيرادات", hint: "عرض الإيرادات وحركات الدخل.", group: "finance", action: "view", sensitive: true },
  { key: "income.manage", label: "إدارة الإيرادات", hint: "إنشاء وتعديل وتسوية الإيرادات.", group: "finance", action: "manage", sensitive: true },
  { key: "expenses.view", label: "عرض المصروفات", hint: "عرض المصروفات والمرفقات.", group: "finance", action: "view", sensitive: true },
  { key: "expenses.manage", label: "إدارة المصروفات", hint: "إضافة وتعديل واعتماد المصروفات.", group: "finance", action: "manage", sensitive: true },
  { key: "inventory.view", label: "عرض المخزون", hint: "عرض المواد والأرصدة.", group: "inventory", action: "view" },
  { key: "inventory.items.manage", label: "إدارة المواد", hint: "إنشاء وتعديل المواد.", group: "inventory", action: "manage" },
  { key: "inventory.recipes.manage", label: "إدارة وصفات الاستهلاك", hint: "إعداد المواد الافتراضية للخدمات.", group: "inventory", action: "manage" },
  { key: "inventory.consume.confirm", label: "تأكيد استهلاك الخدمة", hint: "تأكيد الاستهلاك الفعلي عند التنفيذ.", group: "inventory", action: "use" },
  { key: "inventory.movements.view", label: "عرض حركات المخزون", hint: "عرض دفتر حركات المخزون.", group: "inventory", action: "view", sensitive: true },
  { key: "inventory.adjust", label: "تسوية المخزون", hint: "رصيد افتتاحي أو تصحيح معتمد.", group: "inventory", action: "manage", sensitive: true },
  { key: "inventory.waste.record", label: "تسجيل الهدر", hint: "تسجيل الهدر والتلف.", group: "inventory", action: "manage", sensitive: true },

  { key: "employees.view", label: "عرض الموظفات", hint: "مشاهدة دليل الموظفات والملفات الأساسية.", group: "workforce", action: "view" },
  { key: "employees.create", label: "إضافة موظفة", hint: "إنشاء ملف موظفة وربطه بحساب.", group: "workforce", action: "create" },
  { key: "employees.update", label: "تعديل ملف موظفة", hint: "تعديل البيانات الوظيفية والشخصية.", group: "workforce", action: "update" },
  { key: "employees.delete", label: "حذف أو تعطيل موظفة", hint: "تعطيل أو حذف ملف موظفة. صلاحية حساسة.", group: "workforce", action: "delete", sensitive: true },
  { key: "employees.files.view", label: "عرض ملفات الموظفات", hint: "عرض المستندات والملفات الوظيفية.", group: "workforce", action: "view", sensitive: true },
  { key: "employees.files.manage", label: "إدارة ملفات الموظفات", hint: "رفع وتعديل وحذف الملفات الوظيفية.", group: "workforce", action: "manage", sensitive: true },
  { key: "employees.schedule.manage", label: "إدارة جداول الدوام", hint: "تعديل جداول العمل والأيام والإجازات الأسبوعية.", group: "workforce", action: "manage" },
  { key: "attendance.own.view", label: "عرض الحضور الشخصي", hint: "عرض سجل حضور الحساب نفسه.", group: "workforce", action: "view" },
  { key: "attendance.view", label: "عرض حضور الفريق", hint: "عرض حضور وانصراف جميع الموظفات.", group: "workforce", action: "view", sensitive: true },
  { key: "attendance.records.create", label: "إضافة بصمة إدارية", hint: "إنشاء سجل حضور أو انصراف من الإدارة.", group: "workforce", action: "create", sensitive: true },
  { key: "attendance.records.update", label: "تعديل سجل حضور", hint: "تصحيح وقت أو بيانات سجل حضور.", group: "workforce", action: "update", sensitive: true },
  { key: "attendance.records.delete", label: "حذف سجل حضور", hint: "حذف بصمة حضور أو انصراف. صلاحية شديدة الحساسية.", group: "workforce", action: "delete", sensitive: true },
  { key: "attendance.absences.manage", label: "إدارة الغياب", hint: "تسجيل واعتماد وإلغاء الغياب.", group: "workforce", action: "manage" },
  { key: "attendance.leaves.manage", label: "إدارة الإجازات", hint: "مراجعة واعتماد ورفض الإجازات.", group: "workforce", action: "manage" },
  { key: "attendance.export", label: "تصدير الحضور", hint: "تصدير تقارير الحضور والانصراف.", group: "workforce", action: "export", sensitive: true },
  { key: "attendance.settings.manage", label: "إعدادات الحضور والبصمة", hint: "إدارة النطاقات والموقع وسياسات البصمة.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.own.view", label: "عرض طلباتي", hint: "عرض الموظفة لطلباتها الخاصة.", group: "workforce", action: "view" },
  { key: "employee_requests.own.create", label: "إنشاء طلب شخصي", hint: "إنشاء طلبات الموظفة التشغيلية.", group: "workforce", action: "create" },
  { key: "employee_requests.own.comment", label: "الرد على طلباتي", hint: "إضافة رد ومعلومات إضافية للطلب الشخصي.", group: "workforce", action: "update" },
  { key: "employee_requests.own.cancel", label: "إلغاء طلباتي", hint: "إلغاء الطلب قبل بدء التنفيذ.", group: "workforce", action: "manage" },
  { key: "employee_requests.view", label: "عرض مركز الطلبات", hint: "عرض طلبات الموظفات وحالاتها.", group: "workforce", action: "view", sensitive: true },
  { key: "employee_requests.manage", label: "إدارة الطلبات", hint: "إدارة دورة حياة طلبات الموظفات.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.receive", label: "استلام الطلبات", hint: "تأكيد استلام الطلب من الإدارة.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.assign", label: "تعيين مسؤول الطلب", hint: "تعيين مسؤول لمتابعة الطلب.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.request_info", label: "طلب معلومات إضافية", hint: "إرجاع الطلب للموظفة لاستكمال البيانات.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.approve", label: "الموافقة على الطلبات", hint: "اعتماد الطلب قبل التنفيذ.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.reject", label: "رفض الطلبات", hint: "رفض الطلب مع تسجيل السبب.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.execute", label: "تنفيذ الطلبات", hint: "تنفيذ الأثر التشغيلي للطلب الموافق عليه.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.complete", label: "إكمال الطلبات", hint: "تأكيد اكتمال التنفيذ.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.internal_notes", label: "ملاحظات الطلب الداخلية", hint: "إضافة ملاحظات لا تظهر للموظفة.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.resignation.execute", label: "تنفيذ إنهاء الاستقالة", hint: "تعطيل الحساب بعد إخلاء الطرف وفي الموعد الفعلي.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.salary_advance.approve", label: "اعتماد السلفة", hint: "اعتماد قيمة السلفة وجدولة استقطاعها من مسير الراتب.", group: "finance", action: "manage", sensitive: true },
  { key: "employee_requests.attendance_correction.execute", label: "تنفيذ تصحيح الحضور", hint: "تعديل سجل الحضور الفعلي بعد الاعتماد.", group: "workforce", action: "manage", sensitive: true },
  { key: "employee_requests.reopen", label: "إعادة فتح الطلب", hint: "إعادة فتح طلب مرفوض أو ملغي للمراجعة.", group: "workforce", action: "manage", sensitive: true },

  { key: "payroll.view", label: "عرض الرواتب", hint: "عرض سجلات الرواتب والاستحقاقات.", group: "workforce", action: "view", sensitive: true },
  { key: "payroll.manage", label: "إدارة الرواتب", hint: "إنشاء وتعديل واعتماد الرواتب والخصومات.", group: "workforce", action: "manage", sensitive: true },
  { key: "targets.view", label: "عرض تارقت الموظفات", hint: "عرض تارقت المبيعات ونسب الإنجاز والشرائح والبونص المتوقع.", group: "workforce", action: "view", sensitive: true },
  { key: "targets.manage", label: "إدارة تارقت الموظفات", hint: "إنشاء خطط التارقت والشرائح والتعيينات وإعادة بناء سجل الاحتساب.", group: "workforce", action: "manage", sensitive: true },
  { key: "targets.approve", label: "اعتماد بونص التارقت", hint: "اعتماد بونص تحقيق التارقت وترحيله إلى مسير الرواتب.", group: "workforce", action: "manage", sensitive: true },
  { key: "targets.adjust", label: "تعديل سجل التارقت", hint: "إضافة تسويات يدوية على تارقت الموظفات مع سبب قابل للتدقيق.", group: "workforce", action: "manage", sensitive: true },
  { key: "targets.view_all", label: "عرض كل التارقت", hint: "عرض تقدم جميع الموظفات في دورات الرواتب.", group: "workforce", action: "view", sensitive: true },
  { key: "targets.view_own", label: "عرض تارقتي", hint: "السماح للموظفة بمراجعة تقدمها الشخصي داخل بوابة الموظف.", group: "workforce", action: "view" },
  { key: "staffPerformance.view", label: "عرض أداء الموظفات", hint: "عرض مؤشرات أداء الموظفات من الحجوزات والحضور.", group: "workforce", action: "view", sensitive: true },
  { key: "staffPerformance.manage", label: "إدارة أداء الموظفات", hint: "إدارة إعدادات وملاحظات أداء الموظفات مستقبلًا.", group: "workforce", action: "manage", sensitive: true },
  { key: "recruitment.view", label: "عرض طلبات التوظيف", hint: "استعراض طلبات التوظيف الواردة.", group: "workforce", action: "view" },
  { key: "recruitment.manage", label: "إدارة طلبات التوظيف", hint: "تحديث الحالات والمراجعات والقرارات.", group: "workforce", action: "manage" },

  { key: "reports.view", label: "عرض التقارير", hint: "عرض تقارير الأداء والتشغيل.", group: "reports", action: "view", sensitive: true },
  { key: "reports.export", label: "تصدير التقارير", hint: "تصدير التقارير إلى ملفات خارجية.", group: "reports", action: "export", sensitive: true },
  { key: "weekly_reports.manager_notes", label: "ملاحظات المدير الأسبوعية", hint: "كتابة ملاحظات إدارية على التقارير الأسبوعية.", group: "reports", action: "update" },
  { key: "messages.view", label: "عرض الرسائل", hint: "عرض الرسائل الداخلية المرتبطة بالعمل.", group: "reports", action: "view", sensitive: true },
  { key: "messages.manage", label: "إدارة الرسائل", hint: "إرسال وإدارة ومراجعة الرسائل الداخلية.", group: "reports", action: "manage", sensitive: true },
  { key: "logs.view", label: "عرض سجل الحركات", hint: "عرض السجل التدقيقي للعمليات الحساسة.", group: "reports", action: "view", sensitive: true },
  { key: "audit.read", label: "قراءة سجل التدقيق", hint: "قراءة سجل العمليات الحساسة من D1.", group: "reports", action: "view", sensitive: true },

  { key: "catalog.manage", label: "إدارة الكتالوج", hint: "إدارة الخدمات والأقسام والفئات والباقات.", group: "content", action: "manage" },
  { key: "offers.manage", label: "إدارة العروض والكوبونات", hint: "إنشاء وتعديل العروض والكوبونات.", group: "content", action: "manage" },
  { key: "content.manage", label: "إدارة محتوى الموقع", hint: "تعديل بيانات ومحتوى صفحات الموقع.", group: "content", action: "manage" },
  { key: "partners.manage", label: "إدارة الشريكات والمساحات", hint: "إدارة الشريكات والعقود والموارد المؤجرة.", group: "content", action: "manage", sensitive: true },

  { key: "settings.general.manage", label: "الإعدادات العامة", hint: "تعديل إعدادات الصالون والتشغيل العامة.", group: "system", action: "manage", sensitive: true },
  { key: "settings.booking.manage", label: "إعدادات الحجوزات", hint: "تعديل سياسات وساعات وقواعد الحجز.", group: "system", action: "manage", sensitive: true },
  { key: "settings.content.manage", label: "إعدادات المحتوى", hint: "تعديل إعدادات ظهور المحتوى العام.", group: "system", action: "manage" },
  { key: "admin_accounts.view", label: "عرض الحسابات الإدارية", hint: "عرض الحسابات والأدوار والصلاحيات.", group: "system", action: "view", sensitive: true },
  { key: "admin_accounts.manage", label: "إدارة الحسابات الإدارية", hint: "إنشاء وتعطيل وتعديل الحسابات الإدارية.", group: "system", action: "manage", sensitive: true },
  { key: "accounts.read", label: "قراءة الحسابات", hint: "عرض حسابات التطبيق من D1.", group: "system", action: "view", sensitive: true },
  { key: "accounts.create", label: "إنشاء حساب", hint: "إنشاء سجل حساب تشغيلي في D1.", group: "system", action: "create", sensitive: true },
  { key: "accounts.update", label: "تعديل حساب", hint: "تعديل بيانات الحساب والدور والحالة.", group: "system", action: "update", sensitive: true },
  { key: "accounts.disable", label: "تعطيل حساب", hint: "منع الحساب من الدخول للمنصة.", group: "system", action: "manage", sensitive: true },
  { key: "accounts.restore", label: "استعادة حساب", hint: "إعادة تفعيل حساب معطل.", group: "system", action: "manage", sensitive: true },
  { key: "accounts.delete", label: "حذف حساب", hint: "حذف منطقي لسجل الحساب في D1.", group: "system", action: "delete", sensitive: true },
  { key: "accounts.reset_password", label: "إرسال رابط إعادة كلمة المرور", hint: "إرسال رابط Firebase بعد تحقق صلاحية Cloudflare.", group: "system", action: "use", sensitive: true },
  { key: "roles.read", label: "قراءة الأدوار", hint: "عرض كتالوج الأدوار.", group: "system", action: "view", sensitive: true },
  { key: "roles.assign", label: "إسناد الأدوار", hint: "تغيير دور حساب ضمن صلاحيات المنفذ.", group: "system", action: "manage", sensitive: true },
  { key: "roles.manage", label: "إدارة الأدوار", hint: "إدارة إعدادات الأدوار وصلاحياتها.", group: "system", action: "manage", sensitive: true },
  { key: "permissions.read", label: "قراءة الصلاحيات", hint: "عرض كتالوج الصلاحيات.", group: "system", action: "view", sensitive: true },
  { key: "permissions.manage", label: "إدارة الصلاحيات", hint: "منح وسحب الصلاحيات التفصيلية. أعلى صلاحية إدارية.", group: "system", action: "manage", sensitive: true },
  { key: "employee_links.read", label: "قراءة روابط الموظفات", hint: "عرض ربط الحساب بملف الموظفة.", group: "system", action: "view", sensitive: true },
  { key: "employee_links.manage", label: "إدارة روابط الموظفات", hint: "ربط وفصل الحساب عن ملف الموظفة.", group: "system", action: "manage", sensitive: true },

  // مفاتيح توافق مؤقتة مع أجزاء الواجهة القديمة. لا تظهر في المحرر الجديد.
  { key: "employees.manage", label: "إدارة الموظفين (توافق)", hint: "مفتاح قديم للتوافق حتى اكتمال ترحيل الواجهات.", group: "workforce", action: "manage", visible: false },
  { key: "settings.manage", label: "إدارة الإعدادات (توافق)", hint: "مفتاح قديم للتوافق حتى اكتمال ترحيل الواجهات.", group: "system", action: "manage", visible: false },
];

const APP_PERMISSION_SET = new Set<AppPermission>(APP_PERMISSION_CATALOG.map((item) => item.key));

export const VISIBLE_APP_PERMISSION_CATALOG = APP_PERMISSION_CATALOG.filter(
  (item) => item.visible !== false
);

const ALL_VISIBLE_PERMISSIONS = VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key);

const ROLE_PERMISSIONS: Record<UserRole, LegacyPermission[]> = {
  owner: [
    "BOOKINGS_VIEW",
    "BOOKINGS_UPDATE_STATUS",
    "BOOKINGS_ADD_NOTES",
    "EMPLOYEES_MANAGE",
    "SERVICES_MANAGE",
    "OFFERS_MANAGE",
    "REPORTS_VIEW",
    "SETTINGS_MANAGE",
    "USERS_MANAGE",
  ],
  admin: [
    "BOOKINGS_VIEW",
    "BOOKINGS_UPDATE_STATUS",
    "BOOKINGS_ADD_NOTES",
    "EMPLOYEES_MANAGE",
    "SERVICES_MANAGE",
    "OFFERS_MANAGE",
    "REPORTS_VIEW",
  ],
  hr: ["BOOKINGS_VIEW", "EMPLOYEES_MANAGE", "REPORTS_VIEW", "USERS_MANAGE"],
  accountant: ["REPORTS_VIEW"],
  reception: ["BOOKINGS_VIEW", "BOOKINGS_UPDATE_STATUS", "BOOKINGS_ADD_NOTES"],
  staff: ["BOOKINGS_VIEW"],
  pending: [],
  client: [],
  guest: [],
};

const COMMON_INTERNAL: AppPermission[] = [
  "workspace.employee_portal.view",
  "attendance.own.view",
  "messages.view",
  "targets.view_own",
  "employee_requests.own.view",
  "employee_requests.own.create",
  "employee_requests.own.comment",
  "employee_requests.own.cancel",
];

export const ROLE_APP_PERMISSIONS: Record<UserRole, AppPermission[]> = {
  owner: APP_PERMISSION_CATALOG.map((item) => item.key),
  admin: [
    "workspace.dashboard.view",
    "workspace.employee_portal.view",
    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.payment.manage",
    "bookings.print",
    "bookings.bulk.manage",
    "bookings.day_audit.manage",
    "bookings.queue_tv.view",
    "clients.view",
    "clients.manage",
    "clients.packages.manage",
    "clients.loyalty.manage",
    "income.view",
    "income.manage",
    "expenses.view",
    "expenses.manage",
    "employees.view",
    "employees.create",
    "employees.update",
    "employees.files.view",
    "employees.files.manage",
    "employees.schedule.manage",
    "employees.manage",
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
    "attendance.settings.manage",
    "payroll.view",
    "payroll.manage",
    "targets.view",
    "targets.manage",
    "targets.approve",
    "targets.adjust",
    "targets.view_all",
    "targets.view_own",
    "employee_requests.own.view",
    "employee_requests.own.create",
    "employee_requests.own.comment",
    "employee_requests.own.cancel",
    "employee_requests.view",
    "employee_requests.manage",
    "employee_requests.receive",
    "employee_requests.assign",
    "employee_requests.request_info",
    "employee_requests.approve",
    "employee_requests.reject",
    "employee_requests.execute",
    "employee_requests.complete",
    "employee_requests.internal_notes",
    "employee_requests.resignation.execute",
    "employee_requests.salary_advance.approve",
    "employee_requests.attendance_correction.execute",
    "employee_requests.reopen",
    "staffPerformance.view",
    "staffPerformance.manage",
    "recruitment.view",
    "recruitment.manage",
    "reports.view",
    "reports.export",
    "weekly_reports.manager_notes",
    "messages.view",
    "messages.manage",
    "catalog.manage",
    "offers.manage",
    "content.manage",
    "partners.manage",
    "logs.view",
    "settings.manage",
    "settings.general.manage",
    "settings.booking.manage",
    "settings.content.manage",
    "admin_accounts.view",
    "admin_accounts.manage",
    "accounts.read",
    "accounts.create",
    "accounts.update",
    "accounts.disable",
    "accounts.restore",
    "accounts.reset_password",
    "roles.read",
    "roles.assign",
    "permissions.read",
    "permissions.manage",
    "employee_links.read",
    "employee_links.manage",
    "audit.read",
  ],
  hr: [
    "workspace.employee_portal.view",
    "employees.view",
    "employees.create",
    "employees.update",
    "employees.files.view",
    "employees.files.manage",
    "employees.schedule.manage",
    "employees.manage",
    "attendance.own.view",
    "attendance.view",
    "attendance.records.create",
    "attendance.records.update",
    "attendance.absences.manage",
    "attendance.leaves.manage",
    "attendance.export",
    "payroll.view",
    "payroll.manage",
    "targets.view",
    "targets.manage",
    "targets.approve",
    "targets.adjust",
    "targets.view_all",
    "targets.view_own",
    "employee_requests.own.view",
    "employee_requests.own.create",
    "employee_requests.own.comment",
    "employee_requests.own.cancel",
    "employee_requests.view",
    "employee_requests.manage",
    "employee_requests.receive",
    "employee_requests.assign",
    "employee_requests.request_info",
    "employee_requests.approve",
    "employee_requests.reject",
    "employee_requests.execute",
    "employee_requests.complete",
    "employee_requests.internal_notes",
    "employee_requests.resignation.execute",
    "employee_requests.salary_advance.approve",
    "employee_requests.attendance_correction.execute",
    "employee_requests.reopen",
    "staffPerformance.view",
    "staffPerformance.manage",
    "recruitment.view",
    "recruitment.manage",
    "reports.view",
    "weekly_reports.manager_notes",
    "messages.view",
    "messages.manage",
    "admin_accounts.view",
    "admin_accounts.manage",
    "accounts.read",
    "accounts.update",
    "roles.read",
    "permissions.read",
    "employee_links.read",
    "employee_links.manage",
  ],
  accountant: [
    "workspace.dashboard.view",
    "workspace.employee_portal.view",
    "income.view",
    "income.manage",
    "expenses.view",
    "expenses.manage",
    "targets.view",
    "targets.view_all",
    "targets.view_own",
    "reports.view",
    "reports.export",
    "logs.view",
    "audit.read",
    "employee_requests.own.view",
    "employee_requests.own.create",
    "employee_requests.own.comment",
    "employee_requests.own.cancel",
    "employee_requests.view",
    "employee_requests.manage",
    "employee_requests.receive",
    "employee_requests.assign",
    "employee_requests.request_info",
    "employee_requests.approve",
    "employee_requests.reject",
    "employee_requests.execute",
    "employee_requests.complete",
    "employee_requests.internal_notes",
    "employee_requests.salary_advance.approve",
  ],
  reception: [
    "workspace.dashboard.view",
    "workspace.employee_portal.view",
    "bookings.view",
    "bookings.create",
    "bookings.update",
    "bookings.cancel",
    "bookings.payment.manage",
    "bookings.print",
    "bookings.day_audit.manage",
    "bookings.queue_tv.view",
    "clients.view",
    "clients.manage",
    "employees.view",
    "attendance.own.view",
    "attendance.view",
    "messages.view",
    "employee_requests.own.view",
    "employee_requests.own.create",
    "employee_requests.own.comment",
    "employee_requests.own.cancel",
  ],
  staff: [...COMMON_INTERNAL],
  pending: [],
  client: [],
  guest: [],
};

export function getUserRole(rawRole?: string): UserRole {
  const raw = String(rawRole || "").toLowerCase().trim();

  if (raw === "pending") return "pending";
  if (raw === "owner" || raw === "owner-role" || raw === "malik" || raw === "المالك" || raw === "مالك") return "owner";
  if (raw === "admin" || raw === "administrator" || raw === "manager" || raw === "super_admin" || raw === "super-admin") return "admin";
  if (
    raw === "hr" ||
    raw === "human resources" ||
    raw === "humanresources" ||
    raw === "human_resources" ||
    raw === "human-resources" ||
    raw === "اتش ار" ||
    raw === "الموارد البشرية" ||
    raw === "موارد بشرية" ||
    raw === "مسؤول موارد بشرية" ||
    raw === "مسؤولة موارد بشرية"
  ) return "hr";
  if (raw === "accountant" || raw === "accounting" || raw === "finance" || raw === "محاسب" || raw === "المحاسب") return "accountant";
  if (raw === "reception" || raw === "receptionist" || raw === "frontdesk" || raw === "desk") return "reception";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";

  return "guest";
}

export function isAppPermission(value: unknown): value is AppPermission {
  return APP_PERMISSION_SET.has(String(value || "").trim() as AppPermission);
}

export function normalizeAppPermissions(input: unknown): AppPermission[] {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set<AppPermission>();
  const out: AppPermission[] = [];

  values.forEach((value) => {
    const key = String(value || "").trim();
    if (!isAppPermission(key) || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });

  return out;
}

export function normalizePermissionOverrides(input: unknown): PermissionOverrides {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: normalizeAppPermissions(raw.enabled || raw.added || raw.add),
    disabled: normalizeAppPermissions(raw.disabled || raw.removed || raw.remove),
  };
}

export function getRoleAppPermissions(role?: UserRole | string): AppPermission[] {
  return [...(ROLE_APP_PERMISSIONS[getUserRole(role)] || [])];
}

export function getEffectiveAppPermissions(args: {
  role?: UserRole | string;
  permissions?: unknown;
  permissionOverrides?: unknown;
  permissionVersion?: unknown;
}): AppPermission[] {
  const role = getUserRole(args.role);

  // المالك يملك كل الصلاحيات دائمًا، ولا يمكن خفضه باستثناء محلي قديم.
  if (role === "owner") return [...APP_PERMISSION_CATALOG.map((item) => item.key)];

  const base = new Set<AppPermission>(getRoleAppPermissions(role));
  const stored = normalizeAppPermissions(args.permissions);
  const overrides = normalizePermissionOverrides(args.permissionOverrides);
  const version = Number(args.permissionVersion || 0) || 0;

  // مستندات v3 تحفظ الصلاحيات الفعلية صراحةً. الإصدارات القديمة تُعامل كدور + استثناءات
  // حتى لا تفقد الحسابات صلاحيات جديدة عند توسيع السجل المركزي.
  if (
    version >= PERMISSION_SCHEMA_VERSION &&
    Array.isArray(args.permissions) &&
    !overrides.enabled.length &&
    !overrides.disabled.length
  ) {
    return APP_PERMISSION_CATALOG.map((item) => item.key).filter((permission) => stored.includes(permission));
  }

  overrides.enabled.forEach((permission) => base.add(permission));
  overrides.disabled.forEach((permission) => base.delete(permission));

  return APP_PERMISSION_CATALOG.map((item) => item.key).filter((permission) => base.has(permission));
}

export function buildPermissionOverrides(role: UserRole | string, selected: unknown): PermissionOverrides {
  const normalizedRole = getUserRole(role);
  if (normalizedRole === "owner") return { enabled: [], disabled: [] };

  const roleDefaults = new Set(getRoleAppPermissions(normalizedRole));
  const selectedSet = new Set(normalizeAppPermissions(selected));

  return {
    enabled: APP_PERMISSION_CATALOG.map((item) => item.key).filter(
      (permission) => selectedSet.has(permission) && !roleDefaults.has(permission)
    ),
    disabled: APP_PERMISSION_CATALOG.map((item) => item.key).filter(
      (permission) => roleDefaults.has(permission) && !selectedSet.has(permission)
    ),
  };
}

export function hasAppPermission(
  permission: AppPermission,
  role?: UserRole | string,
  permissions?: unknown,
  permissionOverrides?: unknown,
  permissionVersion?: unknown
): boolean {
  return getEffectiveAppPermissions({ role, permissions, permissionOverrides, permissionVersion }).includes(permission);
}

export function hasAnyAppPermission(
  required: AppPermission[],
  args: { role?: UserRole | string; permissions?: unknown; permissionOverrides?: unknown; permissionVersion?: unknown }
): boolean {
  if (!required.length) return true;
  const effective = new Set(getEffectiveAppPermissions(args));
  return required.some((permission) => effective.has(permission));
}

export function hasAllAppPermissions(
  required: AppPermission[],
  args: { role?: UserRole | string; permissions?: unknown; permissionOverrides?: unknown; permissionVersion?: unknown }
): boolean {
  if (!required.length) return true;
  const effective = new Set(getEffectiveAppPermissions(args));
  return required.every((permission) => effective.has(permission));
}

export function getPermissionGroup(permission: AppPermission): PermissionGroup | null {
  return APP_PERMISSION_CATALOG.find((item) => item.key === permission)?.group || null;
}

export function getVisiblePermissionsForGroup(group: PermissionGroup): PermissionMeta[] {
  return VISIBLE_APP_PERMISSION_CATALOG.filter((item) => item.group === group);
}

export function can(permission: Permission, role?: UserRole): boolean {
  const r = role ?? "guest";
  if (isAppPermission(permission)) return ROLE_APP_PERMISSIONS[r]?.includes(permission) ?? false;
  return ROLE_PERMISSIONS[r]?.includes(permission as LegacyPermission) ?? false;
}

export const ALL_VISIBLE_APP_PERMISSIONS = [...ALL_VISIBLE_PERMISSIONS];
