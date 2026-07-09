PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partner_admins (
  uid TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_admins_email
  ON partner_admins(email)
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL DEFAULT 'main',
  display_name TEXT NOT NULL,
  legal_name TEXT,
  owner_name TEXT NOT NULL,
  owner_uid TEXT,
  email TEXT,
  phone TEXT,
  national_id TEXT,
  commercial_registration TEXT,
  tax_number TEXT,
  business_categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'suspended', 'ended')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT
);

CREATE INDEX IF NOT EXISTS idx_partners_salon_status
  ON partners(salon_id, status);
CREATE INDEX IF NOT EXISTS idx_partners_salon_name
  ON partners(salon_id, display_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS rental_resources (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL DEFAULT 'main',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom'
    CHECK (type IN (
      'hair_station', 'makeup_station', 'manicure_station', 'pedicure_station',
      'lash_bed', 'private_room', 'retail_space', 'custom'
    )),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'rented', 'maintenance', 'inactive')),
  branch_id TEXT,
  floor TEXT,
  zone TEXT,
  description TEXT,
  current_partner_id TEXT,
  current_contract_id TEXT,
  equipment_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  UNIQUE (salon_id, code),
  FOREIGN KEY (current_partner_id) REFERENCES partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resources_salon_status
  ON rental_resources(salon_id, status);
CREATE INDEX IF NOT EXISTS idx_resources_current_partner
  ON rental_resources(salon_id, current_partner_id);
CREATE INDEX IF NOT EXISTS idx_resources_current_contract
  ON rental_resources(salon_id, current_contract_id);

CREATE TABLE IF NOT EXISTS partner_contracts (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL DEFAULT 'main',
  partner_id TEXT NOT NULL,
  contract_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'cancelled')),
  billing_model TEXT NOT NULL DEFAULT 'fixed_rent'
    CHECK (billing_model IN ('fixed_rent', 'revenue_share', 'hybrid', 'hourly', 'daily')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  currency TEXT NOT NULL DEFAULT 'SAR',
  fixed_rent_amount REAL,
  hourly_rate REAL,
  daily_rate REAL,
  partner_share_percent REAL,
  salon_share_percent REAL,
  revenue_share_basis TEXT
    CHECK (
      revenue_share_basis IS NULL OR
      revenue_share_basis IN (
        'gross_before_tax', 'net_after_discount', 'collected_amount', 'net_excluding_tax'
      )
    ),
  minimum_salon_share_amount REAL,
  deposit_amount REAL,
  payment_due_day INTEGER CHECK (payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 28),
  time_off_monthly_hours REAL,
  time_off_max_hours_rolling_14_days REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  UNIQUE (salon_id, contract_number),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_contracts_salon_status
  ON partner_contracts(salon_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_partner
  ON partner_contracts(salon_id, partner_id);
CREATE INDEX IF NOT EXISTS idx_contracts_dates
  ON partner_contracts(salon_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS partner_contract_resources (
  contract_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  salon_id TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, resource_id),
  FOREIGN KEY (contract_id) REFERENCES partner_contracts(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES rental_resources(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_contract_resources_resource
  ON partner_contract_resources(salon_id, resource_id);

CREATE TABLE IF NOT EXISTS partner_members (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL DEFAULT 'main',
  partner_id TEXT NOT NULL,
  member_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (member_type IN ('owner', 'employee', 'contractor')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  display_name TEXT NOT NULL,
  user_uid TEXT,
  employee_id TEXT,
  email TEXT,
  phone TEXT,
  can_work_as_provider INTEGER NOT NULL DEFAULT 1 CHECK (can_work_as_provider IN (0, 1)),
  can_manage_team INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_team IN (0, 1)),
  can_manage_inventory INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_inventory IN (0, 1)),
  can_view_financials INTEGER NOT NULL DEFAULT 0 CHECK (can_view_financials IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_partner_members_partner
  ON partner_members(salon_id, partner_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_members_user_uid
  ON partner_members(user_uid)
  WHERE user_uid IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_audit_logs (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL DEFAULT 'main',
  actor_uid TEXT,
  actor_email TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_audit_entity
  ON partner_audit_logs(salon_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_audit_actor
  ON partner_audit_logs(actor_uid, created_at DESC);

