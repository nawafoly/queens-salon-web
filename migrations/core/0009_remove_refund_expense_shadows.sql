-- Refunds are contra-revenue movements, not operating expenses.
-- Remove legacy shadow rows created by the old refund workflow.
DELETE FROM expense_entries
WHERE LOWER(COALESCE(source_kind, '')) = 'refund'
   OR LOWER(COALESCE(source_type, '')) = 'refund';
