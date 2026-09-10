import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("workers/core/repositories/clients.js", "utf8");

function loyaltyListBlock() {
  const start = source.indexOf("if (includeLoyalty)");
  const end = source.indexOf("const plainSearchClause", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("loyalty hydration scopes history to the selected client page", () => {
  const block = loyaltyListBlock();
  const selected = block.indexOf("WITH selected_clients AS");
  const completed = block.indexOf("completed_bookings AS");

  assert.ok(selected >= 0, "selected_clients CTE is required");
  assert.ok(completed > selected, "client selection must precede history aggregation");
  assert.match(block, /FROM bookings b[\s\S]*INNER JOIN selected_clients sc[\s\S]*ON sc\.id = b\.client_id/);
  assert.match(block, /FROM loyalty_point_transactions l[\s\S]*INNER JOIN selected_clients sc[\s\S]*ON sc\.id = l\.client_id/);
  assert.match(block, /FROM selected_clients sc[\s\S]*LEFT JOIN booking_loyalty/);
  assert.match(block, /ORDER BY c\.updated_at DESC[\s\S]*LIMIT 500/);
});

test("loyalty list query binds search scope before history tenant parameters", () => {
  const block = loyaltyListBlock();
  assert.match(
    block,
    /\[salonId, \.\.\.searchParams, salonId, salonId, salonId\]/
  );
});
