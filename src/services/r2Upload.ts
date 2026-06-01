const PUBLIC_R2_BASE = "https://pub-6ee7ebda32364985aa26e0386b7fbe28.r2.dev";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function makeSafeExt(fileName: string) {
  const ext = cleanText(fileName).split(".").pop()?.toLowerCase() || "bin";
  return ext.replace(/[^a-z0-9]/g, "") || "bin";
}

export async function uploadFileToR2(args: {
  file: File;
  keyPrefix: string;
  ownerId: string;
}) {
  const { file, keyPrefix, ownerId } = args;
  const ext = makeSafeExt(file.name);
  const safeOwner = cleanText(ownerId).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
  const ym = new Date();
  const yearMonth = `${ym.getFullYear()}-${String(ym.getMonth() + 1).padStart(2, "0")}`;
  const key = `${cleanText(keyPrefix).replace(/\/+$/, "")}/${yearMonth}/${safeOwner}/${Date.now()}.${ext}`;

  const presignRes = await fetch("/api/r2-presign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      contentType: file.type || "application/octet-stream",
    }),
  });

  if (!presignRes.ok) {
    const t = await presignRes.text();
    throw new Error(`Presign failed: ${presignRes.status} ${t}`);
  }

  const { putUrl } = await presignRes.json();
  if (!putUrl) throw new Error("Presign response missing putUrl");

  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`Upload failed: ${putRes.status} ${t}`);
  }

  return {
    storageKey: key,
    storageUrl: `${PUBLIC_R2_BASE.replace(/\/+$/, "")}/${key}`,
  };
}
