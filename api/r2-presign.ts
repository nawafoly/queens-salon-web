import type { VercelRequest, VercelResponse } from "@vercel/node";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

const s3 = new S3Client({
  region: "auto",
  endpoint: requiredEnv("R2_ENDPOINT"),
  credentials: {
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
  },
});

function isSafeKey(key: string) {
  // يمنع محاولات مثل ../ أو بداية / أو backslashes
  if (!key || typeof key !== "string") return false;
  if (key.includes("..")) return false;
  if (key.startsWith("/")) return false;
  if (key.includes("\\")) return false;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { key, contentType } = (req.body || {}) as {
      key?: string;
      contentType?: string;
    };

    if (!key) return res.status(400).json({ error: "Missing key" });
    if (!isSafeKey(key)) return res.status(400).json({ error: "Invalid key" });

    const bucket = requiredEnv("R2_BUCKET");

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType || "application/octet-stream",

      // ✅ إذا تبغى الملفات تكون قابلة للعرض مباشرة من R2 (Public bucket policy)
      // احذف هذا السطر إذا bucket خاص وتعرض عبر proxy أو signed GET
      // ACL: "public-read",
    });

    const putUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

    // ✅ Signed GET (للإظهار بالمتصفح حتى لو bucket private)
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const getUrl = await getSignedUrl(s3, getCommand, { expiresIn: 60 });

    return res.status(200).json({
      putUrl,
      getUrl,
      key,
      bucket,
      expiresIn: 60,
    });

  } catch (e: any) {
    console.error("r2-presign error:", e);
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
