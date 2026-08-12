import fs from 'node:fs';

const file = 'src/features/internal-booking-v2/BookingInternalV2.tsx';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const canonicalBlock = `      const bookingDataSource = resolveCoreBookingDataSource();
      const selectedClientId = String(selectedClient.id || "").trim();
      let canonicalClientId = "";
      if (selectedClientId && !selectedClientId.startsWith("history:")) {
        try {
          canonicalClientId = String((await bookingDataSource.getClient(selectedClientId))?.id || "").trim();
        } catch {
          canonicalClientId = "";
        }
      }
      if (!canonicalClientId) {
        const ensuredClient = await bookingDataSource.createClient({
          name: selectedClient.name,
          phone: selectedClient.phone,
        });
        canonicalClientId = String(ensuredClient?.id || "").trim();
      }
      if (!canonicalClientId) {
        throw new Error("تعذر ربط الحجز بحساب العميلة المحدد.");
      }
`;

if (!text.includes('let canonicalClientId = "";')) {
  const marker = `      const authUser = getAuth().currentUser;
      const userId = String(authUser?.uid || "internal_staff");
`;
  const count = text.split(marker).length - 1;
  if (count !== 1) throw new Error(`[internal-v2-client] expected one auth marker, found ${count}`);
  text = text.replace(marker, `${marker}${canonicalBlock}`);
}

const oldPayload = `        return {
          userId,
          createdBy: "staff",
          channel: "internal",`;
const newPayload = `        return {
          clientId: canonicalClientId,
          userId: null,
          createdBy: "staff",
          createdByUid: userId,
          channel: "internal",`;
if (!text.includes(newPayload)) {
  const count = text.split(oldPayload).length - 1;
  if (count !== 1) throw new Error(`[internal-v2-client] expected one booking item identity block, found ${count}`);
  text = text.replace(oldPayload, newPayload);
}

if (!text.includes('clientId: canonicalClientId')) throw new Error('[internal-v2-client] canonical client id not attached');
if (!text.includes('createdByUid: userId')) throw new Error('[internal-v2-client] operator uid not preserved as creator');
if (/return \{\s*userId,\s*createdBy: "staff"/.test(text)) throw new Error('[internal-v2-client] operator uid still occupies userId');

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[internal-v2-client] canonical client binding installed');
