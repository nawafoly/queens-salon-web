type VercelRequest = { method?: string; body?: any };
type VercelResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  end(): VercelResponse;
};

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error("Missing env: " + name);
  return String(v).trim();
}

function isSafeKey(key: string) {
  if (!key || typeof key !== "string") return false;
  if (key.includes("..") || key.startsWith("/") || key.includes("\\")) return false;
  return true;
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { key, contentType, dataBase64 } = (req.body || {}) as {
      key?: string;
      contentType?: string;
      dataBase64?: string;
    };
    if (!key || !isSafeKey(key)) return res.status(400).json({ error: "Invalid key" });
    if (!dataBase64) return res.status(400).json({ error: "Missing file data" });

    const s3 = new S3Client({
      region: "auto",
      endpoint: requiredEnv("R2_ENDPOINT"),
      credentials: {
        accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
      },
    });

    const body = Buffer.from(String(dataBase64), "base64");
    await s3.send(new PutObjectCommand({
      Bucket: requiredEnv("R2_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType || "image/jpeg",
    }));

    return res.status(200).json({ ok: true, key });
  } catch (e: any) {
    console.error("r2-upload error:", e);
    return res.status(500).json({ error: e?.message || "Upload failed" });
  }
}
