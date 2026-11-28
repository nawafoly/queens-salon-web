export type BookingCreationScope = {
  salonId: string;
  actorUid: string;
  channel: "client" | "internal";
  intentId: string;
};

type IdentityStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function requiredPart(value: string): string {
  const part = String(value || "").trim();

  if (!part || part.length > 512) {
    throw new Error("core_booking:invalid_creation_scope");
  }

  return part;
}

function storageKey(scope: BookingCreationScope): string {
  if (scope.channel !== "client" && scope.channel !== "internal") {
    throw new Error("core_booking:invalid_creation_channel");
  }

  return "malikat:booking-creation:v1:" + JSON.stringify([
    requiredPart(scope.salonId),
    requiredPart(scope.actorUid),
    scope.channel,
    requiredPart(scope.intentId)
  ]);
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value)
  );
}

export function newBookingCreationIntent(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("core_booking:secure_identity_unavailable");
  }

  return globalThis.crypto.randomUUID();
}

export function getOrCreateBookingIdentity(
  scope: BookingCreationScope,
  storage: IdentityStorage = globalThis.sessionStorage
): string {
  const key = storageKey(scope);

  const existing = storage.getItem(key);

  if (existing !== null) {
    if (!validId(existing)) {
      throw new Error("core_booking:stored_identity_invalid");
    }

    return existing;
  }

  const identity = newBookingCreationIntent();

  storage.setItem(key, identity);

  if (storage.getItem(key) !== identity) {
    throw new Error("core_booking:identity_persistence_failed");
  }

  return identity;
}

export function clearConfirmedBookingIdentity(
  scope: BookingCreationScope,
  confirmedIdentity: string,
  storage: IdentityStorage = globalThis.sessionStorage
): boolean {
  const key = storageKey(scope);

  if (!validId(confirmedIdentity)) {
    return false;
  }

  if (storage.getItem(key) !== confirmedIdentity) {
    return false;
  }

  storage.removeItem(key);

  return true;
}

export type BookingIdentityInput = {
  id?: string;
  creationScope?: BookingCreationScope;
};

export function resolveBookingCreationIdentity(
  input: BookingIdentityInput,
  storage?: IdentityStorage
): string {
  const explicitId = input.id;

  if (explicitId !== undefined && !validId(explicitId)) {
    throw new Error("core_booking:invalid_creation_identity");
  }

  if (input.creationScope) {
    const persistedId = getOrCreateBookingIdentity(
      input.creationScope,
      storage
    );

    if (explicitId !== undefined && explicitId !== persistedId) {
      throw new Error("core_booking:creation_identity_conflict");
    }

    return persistedId;
  }

  if (explicitId !== undefined) {
    return explicitId;
  }

  throw new Error("core_booking:stable_creation_identity_required");
}

export type BookingIntentOwner = Omit<
  BookingCreationScope,
  "intentId"
>;

function activeIntentKey(
  owner: BookingIntentOwner,
  flow: string
): string {
  if (owner.channel !== "client" && owner.channel !== "internal") {
    throw new Error("core_booking:invalid_creation_channel");
  }

  return "malikat:active-booking-intent:v1:" + JSON.stringify([
    requiredPart(owner.salonId),
    requiredPart(owner.actorUid),
    owner.channel,
    requiredPart(flow)
  ]);
}

export function getOrCreateActiveBookingIntent(
  owner: BookingIntentOwner,
  flow: string,
  storage: IdentityStorage = globalThis.sessionStorage
): BookingCreationScope {
  const key = activeIntentKey(owner, flow);

  let intentId = storage.getItem(key);

  if (intentId === null) {
    intentId = newBookingCreationIntent();

    storage.setItem(key, intentId);

    if (storage.getItem(key) !== intentId) {
      throw new Error("core_booking:intent_persistence_failed");
    }
  }

  if (!validId(intentId)) {
    throw new Error("core_booking:stored_intent_invalid");
  }

  return { ...owner, intentId };
}

export function finishActiveBookingIntent(
  scope: BookingCreationScope,
  flow: string,
  confirmedIdentity: string,
  storage: IdentityStorage = globalThis.sessionStorage
): boolean {
  const key = activeIntentKey(scope, flow);

  if (storage.getItem(key) !== scope.intentId) {
    return false;
  }

  if (!validId(confirmedIdentity)) {
    return false;
  }

  if (storage.getItem(storageKey(scope)) !== confirmedIdentity) {
    return false;
  }

  storage.removeItem(key);

  if (storage.getItem(key) !== null) {
    throw new Error("core_booking:intent_completion_failed");
  }

  return true;
}

export function getBookingChildCreationIdentity(
  scope: BookingCreationScope,
  childKey: string,
  storage: IdentityStorage = globalThis.sessionStorage
): string {
  const normalizedChildKey = requiredPart(childKey);

  const childScope: BookingCreationScope = {
    ...scope,
    intentId: JSON.stringify([
      requiredPart(scope.intentId),
      normalizedChildKey
    ])
  };

  const manifest = readBookingIntentManifest(scope, storage);

  if (manifest) {
    if (!Object.prototype.hasOwnProperty.call(
      manifest.children,
      normalizedChildKey
    )) {
      throw new Error("core_booking:intent_manifest_conflict");
    }

    const expectedId = manifest.children[normalizedChildKey];

    if (storage.getItem(storageKey(childScope)) !== expectedId) {
      throw new Error("core_booking:manifest_identity_mismatch");
    }

    return expectedId;
  }

  return getOrCreateBookingIdentity(childScope, storage);
}

type BookingIntentManifest = {
  version: 1;
  children: Record<string, string>;
};

function manifestKey(scope: BookingCreationScope): string {
  return storageKey(scope) + ":manifest";
}

function normalizeManifestChildren(
  childKeys: readonly string[]
): string[] {
  const keys = childKeys.map(requiredPart);

  if (
    !keys.length ||
    keys.length > 200 ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error("core_booking:invalid_intent_manifest");
  }

  return keys.sort();
}

function readBookingIntentManifest(
  scope: BookingCreationScope,
  storage: IdentityStorage
): BookingIntentManifest | null {
  const raw = storage.getItem(manifestKey(scope));

  if (raw === null) return null;

  let parsed: BookingIntentManifest;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("core_booking:invalid_stored_manifest");
  }

  if (
    !parsed ||
    parsed.version !== 1 ||
    !parsed.children ||
    typeof parsed.children !== "object" ||
    Array.isArray(parsed.children)
  ) {
    throw new Error("core_booking:invalid_stored_manifest");
  }

  const entries = Object.entries(parsed.children);

  if (
    !entries.length ||
    entries.length > 200 ||
    entries.some(([key, id]) =>
      !key.trim() ||
      key !== key.trim() ||
      !validId(id)
    ) ||
    new Set(entries.map(([, id]) => id)).size !== entries.length
  ) {
    throw new Error("core_booking:invalid_stored_manifest");
  }

  return parsed;
}

export function registerBookingIntentManifest(
  scope: BookingCreationScope,
  flow: string,
  childKeys: readonly string[],
  storage: IdentityStorage = globalThis.sessionStorage
): Readonly<Record<string, string>> {
  const activeKey = activeIntentKey(scope, flow);

  if (storage.getItem(activeKey) !== scope.intentId) {
    throw new Error("core_booking:inactive_creation_intent");
  }

  const keys = normalizeManifestChildren(childKeys);
  const existing = readBookingIntentManifest(scope, storage);

  if (existing) {
    const previous = Object.keys(existing.children).sort();

    if (JSON.stringify(previous) !== JSON.stringify(keys)) {
      throw new Error("core_booking:intent_manifest_conflict");
    }

    for (const key of keys) {
      const childScope = {
        ...scope,
        intentId: JSON.stringify([
          requiredPart(scope.intentId),
          requiredPart(key)
        ])
      };

      if (
        storage.getItem(storageKey(childScope)) !==
        existing.children[key]
      ) {
        throw new Error("core_booking:manifest_identity_mismatch");
      }
    }

    return Object.freeze({ ...existing.children });
  }

  const children = Object.fromEntries(
    keys.map(key => [
      key,
      getBookingChildCreationIdentity(scope, key, storage)
    ])
  );

  if (new Set(Object.values(children)).size !== keys.length) {
    throw new Error("core_booking:duplicate_child_identity");
  }

  const manifest: BookingIntentManifest = {
    version: 1,
    children
  };

  const encoded = JSON.stringify(manifest);

  storage.setItem(manifestKey(scope), encoded);

  if (storage.getItem(manifestKey(scope)) !== encoded) {
    throw new Error("core_booking:manifest_persistence_failed");
  }

  return Object.freeze({ ...children });
}

export function finishBookingIntentManifest(
  scope: BookingCreationScope,
  flow: string,
  confirmedIds: readonly string[],
  storage: IdentityStorage = globalThis.sessionStorage
): boolean {
  const key = activeIntentKey(scope, flow);

  if (storage.getItem(key) !== scope.intentId) {
    return false;
  }

  const manifest = readBookingIntentManifest(scope, storage);

  if (!manifest) return false;

  const expected = Object.values(manifest.children).sort();
  const confirmed = [...confirmedIds].sort();

  if (
    confirmed.some(id => !validId(id)) ||
    new Set(confirmed).size !== confirmed.length ||
    JSON.stringify(expected) !== JSON.stringify(confirmed)
  ) {
    return false;
  }

  for (const [childKey, id] of Object.entries(manifest.children)) {
    const childScope = {
      ...scope,
      intentId: JSON.stringify([
        requiredPart(scope.intentId),
        requiredPart(childKey)
      ])
    };

    if (storage.getItem(storageKey(childScope)) !== id) {
      throw new Error("core_booking:manifest_identity_mismatch");
    }
  }

  storage.removeItem(key);

  if (storage.getItem(key) !== null) {
    throw new Error("core_booking:intent_completion_failed");
  }

  return true;
}

export type BookingCompletionEvidence = {
  bookingId: string;
  bookingConfirmed: boolean;
  settlement: "not_required" | "confirmed" | "unknown" | "failed";
};

export function finishVerifiedBookingIntent(
  scope: BookingCreationScope,
  flow: string,
  evidence: readonly BookingCompletionEvidence[],
  storage: IdentityStorage = globalThis.sessionStorage
): boolean {
  const key = activeIntentKey(scope, flow);

  if (storage.getItem(key) !== scope.intentId) {
    return false;
  }

  const manifest = readBookingIntentManifest(scope, storage);

  if (!manifest) return false;

  const expected = Object.values(manifest.children);

  if (evidence.length !== expected.length) {
    return false;
  }

  const confirmedIds: string[] = [];

  for (const row of evidence) {
    if (!row || !validId(row.bookingId)) {
      return false;
    }

    if (row.bookingConfirmed !== true) {
      return false;
    }

    if (
      row.settlement !== "confirmed" &&
      row.settlement !== "not_required"
    ) {
      return false;
    }

    confirmedIds.push(row.bookingId);
  }

  return finishBookingIntentManifest(
    scope,
    flow,
    confirmedIds,
    storage
  );
}

export function getBookingIntentTimestamp(
  scope: BookingCreationScope,
  storage: IdentityStorage = globalThis.sessionStorage
): string {
  const key = storageKey(scope) + ":timestamp";
  const existing = storage.getItem(key);

  if (existing !== null) {
    const milliseconds = Date.parse(existing);

    if (
      !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== existing
    ) {
      throw new Error("core_booking:invalid_intent_timestamp");
    }

    return existing;
  }

  if (readBookingIntentManifest(scope, storage)) {
    throw new Error("core_booking:missing_intent_timestamp");
  }

  const timestamp = new Date().toISOString();

  storage.setItem(key, timestamp);

  if (storage.getItem(key) !== timestamp) {
    throw new Error("core_booking:timestamp_persistence_failed");
  }

  return timestamp;
}
// Party metadata is not a booking child and must never count as a confirmation.
export function getBookingPartyIdentity(
  scope: BookingCreationScope,
  storage: IdentityStorage = globalThis.sessionStorage
): string {
  const partyScope = {
    ...scope,
    intentId: JSON.stringify([requiredPart(scope.intentId), "party"])
  };
  const existing = storage.getItem(storageKey(partyScope));
  if (existing !== null) {
    if (!validId(existing)) {
      throw new Error("core_booking:stored_identity_invalid");
    }
    return existing;
  }
  if (readBookingIntentManifest(scope, storage)) {
    throw new Error("core_booking:manifest_identity_mismatch");
  }
  return getOrCreateBookingIdentity(partyScope, storage);
}

export function requireBookingCreationActor(
  uid: unknown
): string {
  if (typeof uid !== "string") {
    throw new Error("core_booking:verified_actor_required");
  }

  const actor = uid.trim();

  if (
    !actor ||
    actor === "guest" ||
    actor === "internal_staff" ||
    actor.length > 512
  ) {
    throw new Error("core_booking:verified_actor_required");
  }

  return actor;
}

export function assertBookingCreationConfirmation(
  expectedId: string,
  confirmedId: unknown
): string {
  if (
    !validId(expectedId) ||
    typeof confirmedId !== "string" ||
    confirmedId !== expectedId
  ) {
    throw new Error("core_booking:creation_confirmation_mismatch");
  }

  return confirmedId;
}
