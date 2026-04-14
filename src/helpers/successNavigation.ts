export type SuccessMode = "created" | "updated";

export type SuccessBookingRef = {
  id?: string;
  bookingId?: string;
  trackId?: string;
  publicId?: string;
  bookingPublicId?: string;
  parentId?: string;
  groupId?: string;
};

function trimmed(value: unknown) {
  return String(value ?? "").trim();
}

function uniqueValues(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];

  values.forEach((value) => {
    const next = trimmed(value);
    if (!next) return;
    const key = next.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(next);
  });

  return out;
}

export function normalizeSuccessBookingRef(input: any): SuccessBookingRef {
  const id = trimmed(input?.id) || trimmed(input?.bookingId) || trimmed(input?.trackId);
  const bookingId = trimmed(input?.bookingId) || id;
  const trackId = trimmed(input?.trackId) || bookingId || id;
  const publicId = trimmed(input?.publicId) || trimmed(input?.bookingPublicId);
  const bookingPublicId = trimmed(input?.bookingPublicId) || publicId;
  const parentId = trimmed(input?.parentId) || trimmed(input?.groupId);
  const groupId = trimmed(input?.groupId) || trimmed(input?.parentId);

  return {
    ...(id ? { id } : {}),
    ...(bookingId ? { bookingId } : {}),
    ...(trackId ? { trackId } : {}),
    ...(publicId ? { publicId } : {}),
    ...(bookingPublicId ? { bookingPublicId } : {}),
    ...(parentId ? { parentId } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

export function collectSuccessBookingRefs(input: any[] | any): SuccessBookingRef[] {
  const rows = Array.isArray(input) ? input : [input];
  const out: SuccessBookingRef[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    const ref = normalizeSuccessBookingRef(row);
    const key = [
      ref.id,
      ref.bookingId,
      ref.trackId,
      ref.publicId,
      ref.bookingPublicId,
      ref.parentId,
      ref.groupId,
    ]
      .map((value) => trimmed(value))
      .join("|")
      .toLowerCase();

    if (!key.replace(/\|/g, "")) return;
    if (seen.has(key)) return;

    seen.add(key);
    out.push(ref);
  });

  return out;
}

export function buildSuccessSearch(refsInput: SuccessBookingRef[] | any[] | any) {
  const refs = collectSuccessBookingRefs(refsInput);
  const params = new URLSearchParams();
  const first = refs[0];
  const bookingIds = uniqueValues(refs.map((row) => row.bookingId || row.id || row.trackId));
  const publicIds = uniqueValues(refs.map((row) => row.publicId || row.bookingPublicId));
  const groupIds = uniqueValues(refs.map((row) => row.groupId || row.parentId));

 if (first?.id) params.set("id", first.id);
if (first?.bookingId) params.set("bookingId", first.bookingId);
if (first?.trackId) params.set("trackId", first.trackId);
if (first?.publicId) params.set("publicId", first.publicId);
if (first?.bookingPublicId) params.set("bookingPublicId", first.bookingPublicId);
if (first?.groupId) params.set("groupId", first.groupId);
if (first?.parentId) params.set("parentId", first.parentId);
if (bookingIds.length > 1) params.set("bookingIds", bookingIds.join(","));
if (publicIds.length > 1) params.set("publicIds", publicIds.join(","));
if (groupIds.length > 1) params.set("groupIds", groupIds.join(","));
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function buildSuccessNavigationPayload(
  refsInput: SuccessBookingRef[] | any[] | any,
  mode: SuccessMode = "created"
) {
  const refs = collectSuccessBookingRefs(refsInput);
  const first = refs[0];

  return {
    to: {
      pathname: "/success",
      search: buildSuccessSearch(refs),
    },
    state: {
      mode,
      id: first?.id,
      bookingId: first?.bookingId || first?.id,
      trackId: first?.trackId || first?.bookingId || first?.id,
      publicId: first?.publicId || first?.bookingPublicId,
      bookingPublicId: first?.bookingPublicId || first?.publicId,
      parentId: first?.parentId || first?.groupId,
      groupId: first?.groupId || first?.parentId,
      bookings: refs,
      allBookings: refs,
    },
  };
}
