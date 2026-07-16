import { createHash } from "node:crypto";

export function clean(value) {
  return String(value ?? "").trim();
}

export function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

export function stableId(prefix, value) {
  const hash = createHash("sha1").update(clean(value) || prefix).digest("hex").slice(0, 18);
  return `${prefix}_${hash}`;
}

export function pick(data, fields, fallback = "") {
  for (const field of fields) {
    const value = data?.[field];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return fallback;
}

export function sortText(a, b) {
  return clean(a).localeCompare(clean(b), "en", { sensitivity: "base" });
}

function uniqueClean(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.flat()) {
    const text = clean(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function sourceDate(row) {
  return clean(row.updatedAt || row.updated_at || row.createdAt || row.created_at);
}

function activeClientRank(row) {
  const status = clean(row.status || (row.active === false ? "inactive" : "active")).toLowerCase();
  if (row.active === false || row.disabled === true || row.archived === true) return 1;
  if (["inactive", "disabled", "archived", "deleted", "blocked"].includes(status)) return 1;
  return 0;
}

function isPhoneFallbackId(id, phone) {
  return Boolean(phone) && clean(id) === clean(phone);
}

function packageClientId(row) {
  return clean(pick(row, ["canonicalClientId", "canonical_client_id", "clientId", "client_id", "customerId"]));
}

function packageStatus(row) {
  return clean(row.status || "active").toLowerCase();
}

export function isActiveClientPackage(row, asOfDate = "") {
  const status = packageStatus(row);
  if (["expired", "cancelled", "canceled", "voided", "refunded", "inactive", "deleted"].includes(status)) {
    return false;
  }
  const expiresAt = clean(row.expiresAt || row.expires_at);
  if (expiresAt && asOfDate && expiresAt.slice(0, 10) < asOfDate) return false;
  return true;
}

function clientPrimaryId(row, fallback = "") {
  return clean(
    pick(
      row,
      ["canonicalClientId", "canonical_client_id", "clientId", "client_id", "id", "docId", "customerId"],
      fallback
    )
  );
}

function clientPhone(row) {
  return normalizePhone(
    pick(row, ["phoneNormalized", "phone_normalized", "normalizedPhone", "phone", "mobile", "clientPhone", "phoneNumber"])
  );
}

function trustedClientAliases(row, primaryId, phone) {
  return uniqueClean([
    primaryId,
    row.id,
    row.clientId,
    row.client_id,
    row.canonicalClientId,
    row.canonical_client_id,
    row.docId,
    row.customerId,
    row.legacyClientDocId,
    phone,
  ]);
}

function weakClientAliases(row) {
  return uniqueClean([row.firebaseUid, row.firebase_uid, row.authUid, row.uid]);
}

function candidateLabel(source, row) {
  return `${source}:${clean(row?.id || row?.clientPackageId || row?.clientId || row?.canonicalClientId || "unknown")}`;
}

function addToSetMap(map, key, value) {
  const cleanKey = clean(key);
  const cleanValue = clean(value);
  if (!cleanKey || !cleanValue) return;
  const set = map.get(cleanKey) || new Set();
  set.add(cleanValue);
  map.set(cleanKey, set);
}

function addCandidate(candidates, candidate) {
  const id = clean(candidate.id);
  if (!id) return;
  const existing =
    candidates.get(id) || {
      id,
      salon_id: candidate.salonId,
      name: "",
      phone_normalized: "",
      email: "",
      firebase_uid: "",
      status: "",
      notes: "",
      vip: 0,
      legacy_client_doc_id: "",
      created_at: candidate.now,
      updated_at: candidate.now,
      trustedAliases: new Set(),
      weakAliases: new Set(),
      sourceRefs: new Set(),
      sourceKinds: new Set(),
      packageIds: new Set(),
      activePackageIds: new Set(),
      packagePurchasedAt: [],
      phoneFallback: false,
    };

  existing.sourceRefs.add(candidate.sourceRef);
  existing.sourceKinds.add(candidate.source);
  existing.phoneFallback = existing.phoneFallback || isPhoneFallbackId(id, candidate.phone);
  existing.name ||= clean(candidate.name);
  existing.phone_normalized ||= clean(candidate.phone);
  existing.email ||= clean(candidate.email);
  existing.firebase_uid ||= clean(candidate.firebaseUid);
  const status = clean(candidate.status || "active");
  if (!existing.status || activeClientRank({ status }) < activeClientRank(existing)) {
    existing.status = status;
  }
  existing.notes ||= clean(candidate.notes);
  existing.vip = existing.vip || (candidate.vip ? 1 : 0);
  existing.legacy_client_doc_id ||= clean(candidate.legacyClientDocId);
  existing.created_at =
    [existing.created_at, clean(candidate.createdAt || candidate.now)].filter(Boolean).sort()[0] ||
    candidate.now;
  for (const alias of candidate.trustedAliases || []) existing.trustedAliases.add(alias);
  for (const alias of candidate.weakAliases || []) existing.weakAliases.add(alias);
  for (const packageId of candidate.packageIds || []) existing.packageIds.add(packageId);
  for (const packageId of candidate.activePackageIds || []) existing.activePackageIds.add(packageId);
  for (const purchasedAt of candidate.packagePurchasedAt || []) {
    if (clean(purchasedAt)) existing.packagePurchasedAt.push(clean(purchasedAt));
  }
  candidates.set(id, existing);
}

function addClientRowCandidate(candidates, row, { salonId, now, source }) {
  const phone = clientPhone(row);
  const primaryId = clientPrimaryId(row, phone || stableId("client", JSON.stringify(row)));
  if (!primaryId) return;
  addCandidate(candidates, {
    id: primaryId,
    salonId,
    now,
    source,
    sourceRef: candidateLabel(source, row),
    name: pick(row, ["name", "clientName", "displayName"], "Unnamed client"),
    phone,
    email: row.email,
    firebaseUid: pick(row, ["firebaseUid", "firebase_uid", "authUid", "uid"]),
    status: row.status || (row.active === false ? "inactive" : "active"),
    notes: row.notes || row.note,
    vip: row.vip === true,
    legacyClientDocId: row.legacyClientDocId || (/^\d+$/.test(clean(row.id)) ? row.id : ""),
    createdAt: row.createdAt || row.created_at || now,
    trustedAliases: trustedClientAliases(row, primaryId, phone),
    weakAliases: weakClientAliases(row),
  });
}

function addBookingCandidate(candidates, row, { salonId, now }) {
  const phone = clientPhone(row);
  const explicitId = clean(row.clientId || row.client_id || row.canonicalClientId || row.canonical_client_id);
  const primaryId = explicitId || phone || stableId("client", clean(row.id) || JSON.stringify(row));
  if (!primaryId) return;
  addCandidate(candidates, {
    id: primaryId,
    salonId,
    now,
    source: "bookings",
    sourceRef: candidateLabel("bookings", row),
    name: row.clientName || row.name || "Legacy client",
    phone,
    email: row.clientEmail || row.email,
    status: "active",
    notes: "Created during Core D1 migration from booking history",
    createdAt: row.createdAt || now,
    trustedAliases: uniqueClean([primaryId, explicitId, phone]),
    weakAliases: [],
  });
}

function addPackageCandidate(candidates, row, { salonId, now, asOfDate }) {
  const id = packageClientId(row);
  if (!id) return;
  const phone = clientPhone(row);
  const packageId = clean(row.id || row.clientPackageId);
  const active = isActiveClientPackage(row, asOfDate);
  addCandidate(candidates, {
    id,
    salonId,
    now,
    source: "client_packages",
    sourceRef: candidateLabel("client_packages", row),
    name: pick(row, ["clientName", "name", "displayName"]),
    phone,
    email: row.clientEmail || row.email,
    status: "active",
    createdAt: row.createdAt || row.created_at || now,
    trustedAliases: uniqueClean([id, phone]),
    weakAliases: [],
    packageIds: packageId ? [packageId] : [],
    activePackageIds: active && packageId ? [packageId] : [],
    packagePurchasedAt: [row.purchasedAt || row.purchased_at || row.createdAt || row.created_at],
  });
}

function canonicalRank(a, b) {
  const activePackageDelta = b.activePackageIds.size - a.activePackageIds.size;
  if (activePackageDelta) return activePackageDelta;
  const packageDelta = b.packageIds.size - a.packageIds.size;
  if (packageDelta) return packageDelta;
  const fallbackDelta = Number(a.phoneFallback) - Number(b.phoneFallback);
  if (fallbackDelta) return fallbackDelta;
  const activeDelta = activeClientRank(a) - activeClientRank(b);
  if (activeDelta) return activeDelta;
  const aPackageDate = [...a.packagePurchasedAt].sort()[0] || "";
  const bPackageDate = [...b.packagePurchasedAt].sort()[0] || "";
  if (aPackageDate || bPackageDate) {
    if (aPackageDate !== bPackageDate) return (aPackageDate || "9999").localeCompare(bPackageDate || "9999");
  }
  const aCreated = clean(a.created_at) || "9999-99-99T99:99:99.999Z";
  const bCreated = clean(b.created_at) || "9999-99-99T99:99:99.999Z";
  if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
  const firebaseDelta = (a.firebase_uid ? 0 : 1) - (b.firebase_uid ? 0 : 1);
  if (firebaseDelta) return firebaseDelta;
  return sortText(a.id, b.id);
}

function resolveGroups(candidates) {
  const phoneGroups = new Map();
  const groups = [];
  for (const candidate of candidates.values()) {
    if (!candidate.phone_normalized) {
      groups.push([candidate]);
      continue;
    }
    const group = phoneGroups.get(candidate.phone_normalized) || [];
    group.push(candidate);
    phoneGroups.set(candidate.phone_normalized, group);
  }
  groups.push(...phoneGroups.values());
  return groups;
}

export function sourceClientPackageId(row) {
  return packageClientId(row);
}

export function buildClientCanonicalization({
  salonId,
  now = new Date().toISOString(),
  asOfDate = "",
  clients = [],
  bookings = [],
  clientPackages = [],
}) {
  const candidates = new Map();
  const blockingConflicts = [];
  const warningConflicts = [];

  for (const row of clients) addClientRowCandidate(candidates, row, { salonId, now, source: "clients" });
  for (const row of bookings) addBookingCandidate(candidates, row, { salonId, now });
  for (const row of clientPackages) addPackageCandidate(candidates, row, { salonId, now, asOfDate });

  const clientMap = new Map();
  const aliasRows = new Map();
  const aliasOwnerCandidates = new Map();
  const aliasOwnerSources = new Map();
  const aliasToCanonical = new Map();
  const clientCanonicalMappings = [];
  const packageCanonicalMappings = [];
  let mergedClients = 0;
  let mergedClientGroups = 0;

  const addAlias = (alias, canonicalId, type, sourceRefs) => {
    const value = clean(alias);
    if (!value) return;
    const key = `${salonId}\u0000${value}`;
    addToSetMap(aliasOwnerCandidates, value, canonicalId);
    const ownerSources = aliasOwnerSources.get(value) || new Map();
    const canonicalSources = ownerSources.get(canonicalId) || new Set();
    for (const sourceRef of sourceRefs) canonicalSources.add(sourceRef);
    ownerSources.set(canonicalId, canonicalSources);
    aliasOwnerSources.set(value, ownerSources);
    aliasToCanonical.set(value, canonicalId);
    if (value === canonicalId) return;
    if (aliasRows.has(key)) return;
    aliasRows.set(key, {
      salon_id: salonId,
      alias_id: value,
      canonical_client_id: canonicalId,
      alias_type: type,
      created_at: now,
      sourceRefs: [...sourceRefs].sort(sortText),
    });
  };

  for (const group of resolveGroups(candidates)) {
    const sorted = [...group].sort(canonicalRank);
    const canonical = sorted[0];
    const canonicalId = canonical.id;
    const trustedAliases = uniqueClean(sorted.map((candidate) => [...candidate.trustedAliases]));
    const weakAliases = uniqueClean(sorted.map((candidate) => [...candidate.weakAliases]));
    const duplicateIds = trustedAliases.filter((id) => id !== canonicalId && !normalizePhone(id));
    if (duplicateIds.length) {
      mergedClientGroups += 1;
      mergedClients += duplicateIds.length;
      warningConflicts.push({
        type: "client_phone_merged",
        phone: canonical.phone_normalized,
        canonicalClientId: canonicalId,
        oldClientIds: duplicateIds.sort(sortText),
        packageBacked: canonical.activePackageIds.size > 0,
      });
    }

    const notes = uniqueClean(sorted.map((candidate) => candidate.notes));
    if (duplicateIds.length) notes.push(`Merged legacy client ids: ${duplicateIds.sort(sortText).join(", ")}`);
    const legacyIds = uniqueClean([...trustedAliases, ...weakAliases].filter((alias) => alias !== canonicalId));

    clientMap.set(canonicalId, {
      canonical_client_id: canonicalId,
      id: canonicalId,
      salon_id: salonId,
      name: clean(canonical.name || sorted.find((candidate) => candidate.name)?.name || "Unnamed client"),
      phone_normalized: clean(canonical.phone_normalized || sorted.find((candidate) => candidate.phone_normalized)?.phone_normalized),
      email: clean(canonical.email || sorted.find((candidate) => candidate.email)?.email),
      firebase_uid: clean(canonical.firebase_uid || sorted.find((candidate) => candidate.firebase_uid)?.firebase_uid),
      status: clean(canonical.status || "active"),
      notes: notes.join(" | "),
      vip: sorted.some((candidate) => candidate.vip === 1) ? 1 : 0,
      legacy_client_doc_id: clean(canonical.legacy_client_doc_id || sorted.find((candidate) => candidate.legacy_client_doc_id)?.legacy_client_doc_id),
      legacy_ids_json: JSON.stringify(legacyIds),
      created_at: sorted.map((candidate) => candidate.created_at).filter(Boolean).sort()[0] || now,
      updated_at: now,
      package_ids: uniqueClean(sorted.map((candidate) => [...candidate.packageIds])),
      active_package_ids: uniqueClean(sorted.map((candidate) => [...candidate.activePackageIds])),
      source_refs: uniqueClean(sorted.map((candidate) => [...candidate.sourceRefs])),
    });

    const sourceRefs = new Set(uniqueClean(sorted.map((candidate) => [...candidate.sourceRefs])));
    for (const oldClientId of duplicateIds.sort(sortText)) {
      clientCanonicalMappings.push({ oldClientId, canonicalClientId: canonicalId });
    }
    for (const packageId of uniqueClean(sorted.map((candidate) => [...candidate.packageIds]))) {
      packageCanonicalMappings.push({ clientPackageId: packageId, canonicalClientId: canonicalId });
    }
    for (const alias of trustedAliases) addAlias(alias, canonicalId, "migration", sourceRefs);
    for (const alias of weakAliases) addAlias(alias, canonicalId, "verified_weak", sourceRefs);
  }

  for (const [alias, owners] of aliasOwnerCandidates.entries()) {
    if (owners.size <= 1) continue;
    const ownerList = [...owners].sort(sortText);
    const sourceRefs = [...(aliasOwnerSources.get(alias)?.values() || [])].flatMap((refs) => [...refs]);
    blockingConflicts.push({
      type: "client_alias_conflict",
      alias,
      canonicalClientIds: ownerList,
      sourceRefs: uniqueClean(sourceRefs),
      action: "manual_review_required",
    });
    for (const owner of ownerList) aliasToCanonical.delete(alias);
  }

  const aliases = [...aliasRows.values()]
    .filter((row) => !blockingConflicts.some((conflict) => conflict.alias === row.alias_id))
    .map(({ sourceRefs, ...row }) => row)
    .sort((a, b) => sortText(a.alias_id, b.alias_id));

  const resolveClientId = (value) => {
    const normalized = clean(value);
    if (!normalized) return "";
    return aliasToCanonical.get(normalized) || (clientMap.has(normalized) ? normalized : "");
  };

  const validateClientPackageLinks = (clientPackageRows) => {
    const conflicts = [];
    for (const row of clientPackageRows) {
      const rawClientId = sourceClientPackageId(row);
      const resolved = resolveClientId(rawClientId);
      if (!rawClientId || !resolved || !clientMap.has(resolved)) {
        conflicts.push({
          type: "client_package_unresolved_client",
          clientPackageId: clean(row.id),
          sourceClientId: rawClientId,
        });
      }
    }
    return conflicts;
  };

  return {
    clientMap,
    clients: [...clientMap.values()],
    aliases,
    resolveClientId,
    blockingConflicts,
    warningConflicts,
    validateClientPackageLinks,
    report: {
      mergedClients,
      mergedClientGroups,
      clientCanonicalMappings: clientCanonicalMappings.sort((a, b) => sortText(a.oldClientId, b.oldClientId)),
      packageCanonicalMappings: packageCanonicalMappings.sort((a, b) => sortText(a.clientPackageId, b.clientPackageId)),
      packageBackedCanonicalClientIds: [...clientMap.values()]
        .filter((row) => row.active_package_ids.length)
        .map((row) => row.canonical_client_id)
        .sort(sortText),
    },
  };
}
