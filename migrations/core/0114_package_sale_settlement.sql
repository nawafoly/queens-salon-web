-- Immutable sale snapshots identify newly settled package sales.
-- Existing packages and historical invoice references are deliberately left alone.
CREATE TABLE IF NOT EXISTS package_sales (
  salon_id TEXT NOT NULL,
  sale_reference TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  package_catalog_id TEXT NOT NULL,
  client_package_id TEXT NOT NULL UNIQUE,
  purchase_transaction_id TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL,
  payment_id TEXT NOT NULL UNIQUE,
  income_id TEXT NOT NULL UNIQUE,
  package_name TEXT NOT NULL,
  total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
  total_halalas INTEGER NOT NULL CONSTRAINT package_sale_quote_current CHECK (total_halalas > 0),
  tax_halalas INTEGER NOT NULL CHECK (tax_halalas BETWEEN 0 AND total_halalas),
  tax_rate REAL NOT NULL CHECK (tax_rate BETWEEN 0 AND 100),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'transfer', 'other')),
  purchased_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (salon_id, sale_reference),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id),
  FOREIGN KEY (income_id) REFERENCES income_entries(id)
);
