import fs from "node:fs";
import path from "node:path";

const file = path.resolve("src/pages/dashboardEmployees/TemporaryWeeklyOffPeriodCard.tsx");
const raw = fs.readFileSync(file, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
let src = raw.replace(/\r\n/g, "\n");

function replaceOnce(from, to, label) {
  const first = src.indexOf(from);
  if (first < 0) throw new Error(`[weekly-off-return-date] expected source not found: ${label}`);
  if (src.indexOf(from, first + from.length) >= 0) {
    throw new Error(`[weekly-off-return-date] expected unique source but found multiple matches: ${label}`);
  }
  src = src.slice(0, first) + to + src.slice(first + from.length);
}

replaceOnce(
`function isDateKey(value: string) {
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || "").trim());
}`,
`function isDateKey(value: string) {
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value || "").trim());
}

function previousDateKey(value: string) {
  if (!isDateKey(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1, 12));
  return \`${'${date.getUTCFullYear()}'}-${'${String(date.getUTCMonth() + 1).padStart(2, "0")}'}-${'${String(date.getUTCDate()).padStart(2, "0")}'}\`;
}`,
"add previousDateKey helper"
);

replaceOnce(
`  const temporaryWorkDates = baseOffDay ? weekdayDatesInRange(fromDate, toDate, baseOffDay.key) : [];`,
`  // In suspension mode, toDate is the date the base weekly off RETURNS.
  // Therefore TEMP_WORK must stop on the previous calendar day. This keeps
  // the return date itself closed when it lands on the employee's base off day.
  const temporaryWorkRangeEnd = mode === "suspend" ? previousDateKey(toDate) : toDate;
  const temporaryWorkDates = baseOffDay
    ? weekdayDatesInRange(fromDate, temporaryWorkRangeEnd, baseOffDay.key)
    : [];`,
"make suspension end date exclusive"
);

replaceOnce(
`          ? \`تم إيقاف ${'${baseOffDay.label}'} كإجازة أسبوعية خلال الفترة. بعد ${'${toDate}'} يعود ${'${baseOffDay.label}'} إجازة أسبوعية تلقائيًا. تمت مزامنة ${'${result.createdCoreExceptions}'} يومًا مع Core.\``,
`          ? \`تم إيقاف ${'${baseOffDay.label}'} كإجازة أسبوعية حتى اليوم السابق لتاريخ العودة. ابتداءً من ${'${toDate}'} يعود ${'${baseOffDay.label}'} إجازة أسبوعية تلقائيًا. تمت مزامنة ${'${result.createdCoreExceptions}'} يومًا مع Core.\``,
"clarify suspension return-date message"
);

fs.writeFileSync(file, src.replace(/\n/g, eol), "utf8");
console.log("[weekly-off-return-date] TemporaryWeeklyOffPeriodCard.tsx updated successfully.");
