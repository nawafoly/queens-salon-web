import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const bookingPath = resolve(root, "src/features/internal-booking-v2/BookingInternalV2.tsx");
const packagesPath = resolve(root, "src/features/internal-booking-v2/PackageSessionsManager.tsx");
const dashboardPath = resolve(root, "src/pages/Dashboard.tsx");

const booking = readFileSync(bookingPath, "utf8");
const packages = readFileSync(packagesPath, "utf8");
const dashboard = readFileSync(dashboardPath, "utf8");
const errors = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) errors.push(message);
}

function requireText(source, text, message) {
  if (!source.includes(text)) errors.push(message);
}

// Route safety: administrative booking has exactly one runtime entrypoint: V2.
// Legacy compatibility routes/wrappers are forbidden so a second implementation
// cannot silently return later.
requireMatch(
  dashboard,
  /path=["']booking-internal["'][\s\S]{0,500}<BookingInternalV2\s+language=\{dashboardLanguage\}\s*\/>/,
  "Dashboard route /dashboard/booking-internal is no longer wired to the language-aware BookingInternalV2."
);
if (dashboard.includes("booking-internal-legacy")) {
  errors.push("Legacy /dashboard/booking-internal-legacy route must not exist.");
}
if (dashboard.includes("../pages/BookingInternal")) {
  errors.push("Dashboard must not import the historical BookingInternal compatibility wrapper.");
}
requireMatch(
  dashboard,
  /path=["']booking-internal["'][\s\S]{0,250}permission=["']bookings\.create["']/,
  "Internal booking route lost bookings.create permission protection."
);

// Four-step workflow and the separate package/session workspace.
requireText(booking, "type Step = 1 | 2 | 3 | 4;", "Internal booking no longer declares the four-step workflow contract.");
requireText(booking, 'useState<"new" | "sessions">("new")', "New-booking / package-sessions mode switch contract changed.");
requireText(
  booking,
  '<PackageSessionsManager language={language} />',
  "PackageSessionsManager is no longer mounted from internal booking with dashboard language."
);
requireText(booking, "const sidebarCanAdvance =", "Contextual step-advance gate is missing.");
requireMatch(booking, /step === 1[\s\S]*?canContinue && !addingCompanion && !clientPickerOpen && !showNewClient/, "Step 1 → 2 contextual gating changed.");
requireMatch(booking, /step === 2[\s\S]*?allPartyClientsHaveServices/, "Step 2 → 3 must wait until every party client has a service.");
requireMatch(booking, /step === 3[\s\S]*?allScheduled/, "Step 3 → 4 must wait until all services are scheduled.");
requireMatch(booking, /\{sidebarCanAdvance \? \([\s\S]*?if \(step === 1\) setStep\(2\);[\s\S]*?else if \(step === 2\) setStep\(3\);[\s\S]*?else if \(step === 3\) setStep\(4\);/, "Contextual continue action no longer advances through steps 1–3.");
requireText(
  booking,
  "const isStepComplete = (target: Step) =>",
  "Data-based booking step completion marker is missing."
);
requireMatch(
  booking,
  /onClick=\{\(\) => setStep\(item\.id\)\}/,
  "Booking stepper must allow free direct navigation between all four steps."
);
if (booking.includes("disabled={!enabled}") || booking.includes("canOpenStep(item.id)")) {
  errors.push("Booking stepper must not force sequential completion before direct navigation.");
}

// Client/catalog data remains Core-backed and quick-client history remains intact.
requireText(booking, 'const QUICK_CLIENT_HISTORY_KEY = "internal_quick_clients_history_v1";', "Quick-client history storage key changed.");
requireText(booking, "resolveCoreBookingDataSource().searchClients", "Client search is no longer Core-backed.");
requireText(booking, "resolveCoreBookingDataSource().createClient", "Client creation is no longer Core-backed.");
requireText(booking, "resolveCoreBookingDataSource().getServiceSections", "Service sections are no longer loaded through the booking data source.");
requireText(booking, "resolveCoreBookingDataSource().getServices", "Services are no longer loaded through the booking data source.");
requireText(booking, 'CoreSettingsService.get<InternalBookingAppSettings>("app")', "Booking settings are no longer loaded from Core settings.");

// Scheduling safety. These checks protect the canonical Core-HR fresh
// revalidation performed immediately before write, not only the UI-time lookup.
requireText(booking, "forceFresh: true", "Final staff availability revalidation is no longer forced fresh.");
requireText(booking, "listCoreBookableStaffForDate({", "Final Core bookable-staff revalidation is missing.");
requireText(
  booking,
  "isCoreStaffStartBookable(freshAvailability, selection.time, {",
  "Final canonical Core availability range validation is missing."
);
requireText(booking, "const staleSelections", "Stale schedule selection detection is missing.");
requireMatch(booking, /staleSelections\.length[\s\S]{0,1200}setStep\(3\)/, "Stale-slot recovery no longer returns the user to scheduling step 3.");
requireText(booking, "staff_slot_conflict", "Staff slot conflict handling marker is missing.");
requireText(booking, "SLOT_TAKEN", "SLOT_TAKEN conflict handling marker is missing.");
requireText(booking, "client_schedule_conflict", "Client schedule conflict handling marker is missing.");
requireMatch(booking, /code\.includes\("slot"\)[\s\S]{0,220}code\.includes\("client_schedule_conflict"\)/, "Specific slot-conflict handling is missing.");
if (/Number\(error\?\.status \|\| 0\) === 409[\s\S]{0,40}\|\|/.test(booking)) {
  errors.push("Generic HTTP 409 must not be treated as a slot conflict.");
}
requireText(booking, "const staleKeys = new Set(staleRows.map((row) => row.serviceKey))", "Post-write slot conflicts no longer isolate only stale service selections.");
requireMatch(booking, /staleKeys[\s\S]{0,3000}setStep\(3\)/, "Conflict recovery must preserve valid schedule data and return to step 3.");
requireText(booking, "conflictDetails.cartItemId", "Precise Core conflict details are no longer used to target the affected service row.");
requireText(booking, "pushStaleRow(affectedService, staff)", "Staff conflict recovery no longer isolates the exact conflicting service row.");
requireText(booking, "تم الاحتفاظ بكل المواعيد الصحيحة", "Targeted conflict recovery message is missing.");

// Booking write and payment integrity.
requireText(booking, "createBookingGroup({ parent, items: itemRows })", "Grouped booking creation contract changed.");
requireText(booking, 'type PaymentMethod = "cash" | "card" | "transfer" | "mixed";', "Supported payment methods changed.");
requireText(booking, 'type PaymentType = "full" | "partial" | "none";', "Supported payment types changed.");
requireMatch(booking, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/, "Payment retry count changed from three attempts.");
requireText(booking, "bookingDataSource.recordPayment({", "Post-booking payment recording is missing.");
requireText(booking, 'idempotencyKey: `booking-v2-party:${partyId || bookingId}:${bookingId}:${method}:${amountHalalas}`', "Idempotent party-aware payment key contract changed.");
requireText(booking, "setPostSaveWarning(", "Post-save financial warning path is missing.");
requireMatch(booking, /لا تعيدي إنشاء (?:الحجز|الحجوزات|المجموعة)/, "Critical do-not-recreate warning is missing after financial sync failure.");

// Party / multi-client internal booking keeps each client canonical while sharing one admin checkout.
requireText(booking, "const [companions, setCompanions]", "Party booking companion state is missing.");
requireText(booking, "bookingLineClientKey(other) === currentClientKey", "Client overlap is no longer scoped to the same party member.");
requireText(booking, "if (selected.staffId === staffKey)", "Staff overlap must remain global across party members.");
requireText(booking, "for (const plan of memberPlans)", "Party checkout no longer creates a canonical booking per member.");
requireText(booking, "partyLeadClientId: leadCanonicalClientId", "Party lead canonical identity is not attached to member bookings.");
requireText(booking, "Promise.allSettled(", "Partial party creation compensation is missing.");
requireText(booking, "rollbackBookingCreation(bookingId)", "Partial party creation no longer rolls back already-created member bookings.");
requireText(booking, "const cashByMember = splitAmountByWeights(", "Cash allocation across party members is missing.");
requireText(booking, "const cardByMember = splitAmountByWeights(", "Card allocation across party members is missing.");
requireText(booking, "const transferByMember = splitAmountByWeights(", "Transfer allocation across party members is missing.");
requireText(booking, "const paidByMember = memberPlans.map", "Exact per-member paid total derivation is missing.");

// In-progress internal bookings can be persisted as Core drafts without becoming operational bookings.
requireText(booking, "CoreInternalBookingDraftService.save", "Save-for-later draft persistence is missing.");
requireText(booking, "resumeSavedDraft", "Saved draft resume flow is missing.");
requireText(booking, 'className="bk2-draft-save"', "Save-for-later action is missing.");
requireText(booking, 'className="bk2-drafts-panel"', "Saved draft list is missing.");

// Historical-date confirmation and invoice/print handoff.
requireText(booking, "showPastDateConfirmation", "Past-date confirmation state is missing.");
requireText(booking, "confirmPastDateBooking", "Past-date confirmation handler is missing.");
requireText(booking, "buildInternalV2InvoiceRows({", "Internal invoice row builder is no longer used.");
requireText(booking, 'localStorage.setItem("allBookings"', "Invoice allBookings handoff is missing.");
requireText(booking, 'localStorage.setItem("currentBooking"', "Invoice currentBooking handoff is missing.");
requireText(booking, "/success-internal", "Internal invoice print route handoff changed.");
requireText(booking, "resetCompletedBooking", "Completed-booking reset flow is missing.");

// Package/session ledger administration remains attached to the same workflow.
requireText(packages, "PackageOperationsService.sessionDashboard()", "Package session dashboard load is missing.");
requireText(packages, "PackageOperationsService.adjust(", "Package session balance adjustment is missing.");
requireText(packages, "PackageOperationsService.updateClientPackage({", "Client package update operation is missing.");
requireText(packages, "PackageOperationsService.deleteClientPackage(", "Client package delete operation is missing.");
requireText(packages, "PackageOperationsService.grantClientSessions({", "Manual session grant operation is missing.");
requireText(packages, 'reserve: "حجز جلسة"', "Package ledger reserve movement label is missing.");
requireText(packages, 'redeem: "استهلاك جلسة"', "Package ledger redeem movement label is missing.");
requireText(packages, 'release: "إعادة جلسة محجوزة"', "Package ledger release movement label is missing.");
requireText(packages, 'restore: "استرجاع جلسة"', "Package ledger restore movement label is missing.");
requireText(packages, 'admin_adjustment: "تعديل إداري"', "Package ledger admin adjustment movement label is missing.");

if (errors.length) {
  console.error("Internal booking behavior contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Internal booking behavior contract passed.");
