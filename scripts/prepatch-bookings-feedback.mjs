import { readFileSync, writeFileSync } from "node:fs";

const path = "src/pages/DashboardBookings.tsx";
let source = readFileSync(path, "utf8");
const after = `      setBookingActionFeedback((current) => current?.bookingId === String(b.id || "").trim() ? null : current);\n      setEditTarget(b);`;
if (!source.includes(after)) {
  const before = "    setEditTarget(b);";
  const index = source.indexOf(before);
  if (index < 0) throw new Error("Bookings edit target anchor missing");
  source = source.slice(0, index) + after + source.slice(index + before.length);
  writeFileSync(path, source, "utf8");
}
console.log("Normalized bookings edit feedback anchor.");
