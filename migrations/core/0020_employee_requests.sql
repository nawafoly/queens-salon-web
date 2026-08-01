-- Unified employee requests workflow on Core D1.
-- Firebase remains authentication only. Operational request data lives in D1.


ALTER TABLE employee_permission_requests ADD COLUMN employee_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_permission_request_source
  ON employee_permission_requests(salon_id, employee_request_id) WHERE employee_request_id IS NOT NULL;

-- Extend the existing operational leave record for full-day and partial leave execution.
ALTER TABLE employee_leaves ADD COLUMN duration_kind TEXT NOT NULL DEFAULT 'full_day';
ALTER TABLE employee_leaves ADD COLUMN partial_start_time TEXT;
ALTER TABLE employee_leaves ADD COLUMN partial_end_time TEXT;
ALTER TABLE employee_leaves ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_leaves_request
  ON employee_leaves(salon_id, request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_request_counters (
  salon_id TEXT NOT NULL,
  request_year INTEGER NOT NULL,
  request_type TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, request_year, request_type)
);

CREATE TABLE IF NOT EXISTS employee_requests (
  id TEXT PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  employee_name_snapshot TEXT,
  request_type TEXT NOT NULL CHECK (request_type IN (
    'attendance_correction', 'permission', 'overtime', 'salary_advance',
    'leave', 'exit_return', 'resignation'
  )),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'received', 'under_review', 'needs_info', 'approved',
    'rejected', 'executing', 'completed', 'cancelled'
  )),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  decision_note TEXT,
  rejection_reason TEXT,
  assigned_to_uid TEXT,
  assigned_to_name TEXT,
  source_reference_type TEXT,
  source_reference_id TEXT,
  execution_status TEXT NOT NULL DEFAULT 'not_started' CHECK (execution_status IN (
    'not_started', 'pending', 'running', 'completed', 'failed', 'cancelled'
  )),
  execution_attempts INTEGER NOT NULL DEFAULT 0,
  execution_started_at TEXT,
  execution_completed_at TEXT,
  execution_error TEXT,
  external_reference TEXT,
  idempotency_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at TEXT NOT NULL,
  received_at TEXT,
  reviewed_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  executing_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  received_by_uid TEXT,
  reviewed_by_uid TEXT,
  decided_by_uid TEXT,
  cancelled_by_uid TEXT,
  actual_exit_at TEXT,
  actual_return_at TEXT,
  expected_return_at TEXT,
  final_working_day TEXT,
  UNIQUE (salon_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_employee_requests_employee
  ON employee_requests(salon_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_uid
  ON employee_requests(salon_id, employee_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_type
  ON employee_requests(salon_id, request_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_status
  ON employee_requests(salon_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_assignee
  ON employee_requests(salon_id, assigned_to_uid, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_requests_number
  ON employee_requests(salon_id, request_number);

CREATE TABLE IF NOT EXISTS employee_request_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_uid TEXT,
  actor_email TEXT,
  actor_name TEXT,
  actor_role TEXT,
  note TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  before_json TEXT,
  after_json TEXT,
  request_idempotency_key TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (salon_id, request_id, request_idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_employee_request_events_request
  ON employee_request_events(salon_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS employee_request_comments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  author_uid TEXT,
  author_name TEXT,
  author_role TEXT,
  visibility TEXT NOT NULL DEFAULT 'employee' CHECK (visibility IN ('employee', 'internal')),
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, request_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_employee_request_comments_request
  ON employee_request_comments(salon_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS employee_request_attachments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  file_metadata_id TEXT,
  storage_key TEXT NOT NULL,
  uploaded_by_uid TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (salon_id, storage_key),
  UNIQUE (salon_id, request_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_employee_request_attachments_request
  ON employee_request_attachments(salon_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS employee_overtime_records (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  requested_minutes INTEGER NOT NULL DEFAULT 0,
  approved_minutes INTEGER NOT NULL DEFAULT 0,
  payroll_month TEXT,
  payroll_entry_id TEXT,
  payout_status TEXT NOT NULL DEFAULT 'approved',
  reason TEXT,
  task_summary TEXT,
  location TEXT,
  approved_by_uid TEXT,
  approved_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_overtime_employee_date
  ON employee_overtime_records(salon_id, employee_id, date_key);

CREATE TABLE IF NOT EXISTS salary_advances (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  requested_halalas INTEGER NOT NULL,
  approved_halalas INTEGER NOT NULL,
  repayment_method TEXT NOT NULL CHECK (repayment_method IN ('single', 'installments')),
  installment_count INTEGER NOT NULL DEFAULT 1,
  first_deduction_month TEXT,
  remaining_halalas INTEGER NOT NULL,
  paid_halalas INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'approved' CHECK (payment_status IN ('approved', 'paid', 'partially_repaid', 'repaid', 'cancelled')),
  financial_reference TEXT,
  approved_by_uid TEXT,
  approved_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_salary_advances_employee
  ON salary_advances(salon_id, employee_id, payment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS salary_advance_installments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  advance_id TEXT NOT NULL,
  installment_number INTEGER NOT NULL,
  payroll_month TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'deducted', 'cancelled')),
  payroll_entry_id TEXT,
  deducted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, advance_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_salary_advance_installments_month
  ON salary_advance_installments(salon_id, payroll_month, status);

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('employee_requests.own.view', 'workforce', 'عرض طلباتي', 'عرض الموظفة لطلباتها الخاصة فقط.', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.own.create', 'workforce', 'إنشاء طلب شخصي', 'إنشاء طلبات الموظفة التشغيلية.', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.own.comment', 'workforce', 'التعليق على طلباتي', 'إضافة رد ظاهر للإدارة على الطلب الشخصي.', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.own.cancel', 'workforce', 'إلغاء طلباتي', 'إلغاء طلب شخصي قبل تنفيذه.', 0, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.view', 'workforce', 'عرض طلبات الموظفات', 'عرض مركز طلبات الموظفات.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.manage', 'workforce', 'إدارة طلبات الموظفات', 'إدارة دورة حياة طلبات الموظفات.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.receive', 'workforce', 'استلام الطلبات', 'تسجيل استلام الطلب من الإدارة.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.assign', 'workforce', 'تعيين مسؤول الطلب', 'تعيين مسؤول لمتابعة الطلب.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.request_info', 'workforce', 'طلب معلومات إضافية', 'إعادة الطلب للموظفة لاستكمال المعلومات.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.approve', 'workforce', 'الموافقة على الطلبات', 'اعتماد طلبات الموظفات.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.reject', 'workforce', 'رفض الطلبات', 'رفض طلبات الموظفات مع السبب.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.execute', 'workforce', 'تنفيذ الطلبات', 'تنفيذ الأثر التشغيلي للطلب الموافق عليه.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.complete', 'workforce', 'إكمال الطلبات', 'تأكيد اكتمال تنفيذ الطلب.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.internal_notes', 'workforce', 'ملاحظات الطلب الداخلية', 'إضافة ملاحظات لا تظهر للموظفة.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.resignation.execute', 'workforce', 'تنفيذ إنهاء الاستقالة', 'تنفيذ إخلاء الطرف وتعطيل الحساب في الموعد الفعلي.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.salary_advance.approve', 'finance', 'اعتماد صرف معجل', 'اعتماد قيمة وجدولة استقطاع الصرف المعجل.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.attendance_correction.execute', 'workforce', 'تنفيذ تصحيح الحضور', 'تعديل سجل الحضور الفعلي بعد الاعتماد.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z'),
  ('employee_requests.reopen', 'workforce', 'إعادة فتح الطلب', 'إعادة فتح طلب مرفوض أو ملغي للمراجعة.', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'owner', permission_key, '2026-07-31T00:00:00.000Z'
FROM permissions WHERE permission_key LIKE 'employee_requests.%';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', role_key, permission_key, '2026-07-31T00:00:00.000Z'
FROM roles CROSS JOIN permissions
WHERE role_key IN ('admin', 'hr') AND permission_key LIKE 'employee_requests.%';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'staff', permission_key, '2026-07-31T00:00:00.000Z'
FROM permissions
WHERE permission_key IN (
  'employee_requests.own.view', 'employee_requests.own.create',
  'employee_requests.own.comment', 'employee_requests.own.cancel'
);

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'accountant', permission_key, '2026-07-31T00:00:00.000Z'
FROM permissions
WHERE permission_key IN (
  'employee_requests.own.view', 'employee_requests.own.create',
  'employee_requests.own.comment', 'employee_requests.own.cancel',
  'employee_requests.view', 'employee_requests.manage',
  'employee_requests.receive', 'employee_requests.assign',
  'employee_requests.request_info', 'employee_requests.approve',
  'employee_requests.reject', 'employee_requests.execute',
  'employee_requests.complete', 'employee_requests.internal_notes',
  'employee_requests.salary_advance.approve'
);

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'reception', permission_key, '2026-07-31T00:00:00.000Z'
FROM permissions
WHERE permission_key IN (
  'employee_requests.own.view', 'employee_requests.own.create',
  'employee_requests.own.comment', 'employee_requests.own.cancel'
);
