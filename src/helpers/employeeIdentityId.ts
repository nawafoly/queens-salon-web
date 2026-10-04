export function normalizeEmployeeIdentityId(value: unknown) {
  let id = String(value ?? "").trim();
  if (!id) return "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Decode only values that look like percent-encoded UTF-8 or another
    // encoded percent layer. This avoids changing ordinary ids that happen to
    // contain a literal percent sign.
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
