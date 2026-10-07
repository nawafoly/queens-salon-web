export function normalizeEmployeeIdentityId(value: unknown) {
  let id = String(value ?? "").trim();
  if (!id) return "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!/%(?:25|[C-Fc-f][0-9A-Fa-f])/.test(id)) break;

    let decoded = id;
    try {
      decoded = decodeURIComponent(id).trim();
    } catch {
      break;
    }

    if (!decoded || decoded === id) break;
    id = decoded;
  }

  return id;
}

export function isCanonicalEmployeeIdentityId(value: unknown) {
  const id = normalizeEmployeeIdentityId(value);
  return Boolean(
    id &&
      id.length <= 128 &&
      id !== "." &&
      id !== ".." &&
      !id.includes("/") &&
      !id.startsWith("app_user_")
  );
}

export function employeeIdentityEquals(left: unknown, right: unknown) {
  const leftId = normalizeEmployeeIdentityId(left);
  const rightId = normalizeEmployeeIdentityId(right);
  return Boolean(leftId && rightId && leftId === rightId);
}

export function normalizeEmployeeIdentityIds(values: readonly unknown[]) {
  return Array.from(
    new Set(values.map(normalizeEmployeeIdentityId).filter(Boolean))
  );
}
