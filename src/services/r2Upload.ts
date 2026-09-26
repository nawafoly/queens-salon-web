const PUBLIC_R2_BASE = "https://pub-6ee7ebda32364985aa26e0386b7fbe28.r2.dev";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function makeSafeExt(fileName: string) {
  const ext = cleanText(fileName).split(".").pop()?.toLowerCase() || "bin";
  return ext.replace(/[^a-z0-9]/g, "") || "bin";
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

  const uploadRes = await fetch("/api/r2-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      contentType: file.type || "application/octet-stream",
      dataBase64: await fileToBase64(file),
    }),
  });

  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    throw new Error("Upload failed: " + uploadRes.status + " " + t);
  }

  return {
    storageKey: key,
    storageUrl: `${PUBLIC_R2_BASE.replace(/\/+$/, "")}/${key}`,
  };
}
