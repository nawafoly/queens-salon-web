# Inventory — low stock and minimum-threshold signals

The Inventory Items tab reads `GET /api/core/inventory/reorder-signals`
from the canonical Core D1 repository. It is a tenant-scoped, read-only
aggregation across **active locations** and **active items**. This avoids
silently treating an incomplete client-side stock-level page as the total.

- Only items with a configured `min_stock_qty > 0` are considered.
- Items with no balance rows have `stock_qty=0` and are included.
- An item is shown when its total active-location stock is **at or below**
  its threshold, including exact equality.
- `shortage_qty = min_stock_qty - stock_qty`, in the **item's own unit**.
  At equality, shortage is zero but the threshold alert remains visible.
- No quantities across different units are summed; no artificial maximum
  number of materials is imposed by this query.
- The computed shortage is the **minimum replenishment needed to reach the
  configured floor**, not an automatic purchase order or an optimal order
  quantity. Purchasing decisions require supplier, lead-time and budget data.

The endpoint requires `inventory.view` or `inventory.items.manage`. This
feature does not dispatch external messages or automatically place orders.
An eventual scheduled notification workflow requires explicit channel,
recipient, cooldown and escalation policies plus a separately approved
release. No production D1 migration is required for this read-only report.
