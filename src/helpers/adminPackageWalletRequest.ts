export type AdminPackageWalletClient = {
  canonicalClientId?: unknown;
  clientId?: unknown;
  id?: unknown;
  docId?: unknown;
  customerId?: unknown;
  uid?: unknown;
  authUid?: unknown;
  firebaseUid?: unknown;
  userId?: unknown;
  name?: unknown;
  fullName?: unknown;
  clientName?: unknown;
  phone?: unknown;
  mobile?: unknown;
  clientPhone?: unknown;
  phoneNumber?: unknown;
};

export type AdminPackageWalletRequest = {
  lookupId: string;
  requestClientId: string;
  strongClientId: string;
  normalizedPhone: string;
  clientName: string;
  uid: string;
  customerId: string;
  hasStrongIdentifier: boolean;
  hasValidIdentifier: boolean;
  clientLookup: {
    id?: string;
    docId?: string;
    uid?: string;
    clientId?: string;
    customerId?: string;
    authUid?: string;
    userId?: string;
    firebaseUid?: string;
    phone?: string;
    mobile?: string;
    clientPhone?: string;
    phoneNumber?: string;
  };
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeAdminPackagePhone(value: unknown) {
  const raw = cleanText(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

export function buildAdminPackageWalletRequest(client: AdminPackageWalletClient | null | undefined): AdminPackageWalletRequest {
  const canonicalClientId = cleanText(client?.canonicalClientId);
  const clientId = cleanText(client?.clientId);
  const id = cleanText(client?.id || client?.docId);
  const uid = cleanText(client?.uid || client?.authUid || client?.firebaseUid || client?.userId);
  const authUid = cleanText(client?.authUid || uid);
  const firebaseUid = cleanText(client?.firebaseUid || uid);
  const userId = cleanText(client?.userId || uid);
  const customerId = cleanText(client?.customerId);
  const normalizedPhone = normalizeAdminPackagePhone(
    client?.phone ?? client?.mobile ?? client?.clientPhone ?? client?.phoneNumber
  );
  const clientName = cleanText(client?.name || client?.fullName || client?.clientName);
  const strongClientId = canonicalClientId || clientId || id || uid || customerId;
  const lookupId = strongClientId || normalizedPhone;
  const clientLookup = {
    ...(id ? { id, docId: id } : {}),
    ...(uid ? { uid, userId, firebaseUid } : {}),
    ...(canonicalClientId || clientId ? { clientId: canonicalClientId || clientId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(authUid ? { authUid } : {}),
    ...(normalizedPhone
      ? {
          phone: normalizedPhone,
          mobile: normalizedPhone,
          clientPhone: normalizedPhone,
          phoneNumber: normalizedPhone,
        }
      : {}),
  };

  return {
    lookupId,
    requestClientId: strongClientId ? lookupId : "",
    strongClientId,
    normalizedPhone,
    clientName,
    uid,
    customerId,
    hasStrongIdentifier: Boolean(strongClientId),
    hasValidIdentifier: Boolean(strongClientId || normalizedPhone),
    clientLookup,
  };
}

export function adminPackageWalletRefreshKey(request: Pick<
  AdminPackageWalletRequest,
  "lookupId" | "normalizedPhone" | "clientName" | "uid" | "customerId"
>) {
  return [
    request.lookupId,
    request.normalizedPhone,
    request.clientName,
    request.uid,
    request.customerId,
  ].join("\u001f");
}
