import { AppError } from './errors.js';
import { googleAccessToken } from './google-oauth.js';
import { cleanText } from './validation.js';

export function toFirestoreValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return { timestampValue: value };
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue).filter(Boolean) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) {
      const converted = toFirestoreValue(nested);
      if (converted !== undefined) fields[key] = converted;
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFirestoreFields(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data || {})) {
    const converted = toFirestoreValue(value);
    if (converted !== undefined) fields[key] = converted;
  }
  return fields;
}

export function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return undefined;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) return fromFirestoreFields(value.mapValue.fields || {});
  return undefined;
}

export function fromFirestoreFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = fromFirestoreValue(value);
  return out;
}

export function fieldPaths(data) {
  return Object.keys(data || {});
}

export function docIdFromName(name) {
  return decodeURIComponent(String(name || "").split("/").pop() || "");
}

export class FirestoreRestClient {
  constructor(env, projectId) {
    this.env = env;
    this.projectId = projectId;
    this.database = "(default)";
    this.emulatorHost = cleanText(env.FIRESTORE_EMULATOR_HOST);
    this.base = this.emulatorHost
      ? `http://${this.emulatorHost}/v1/projects/${projectId}/databases/${this.database}/documents`
      : `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${this.database}/documents`;
  }

  docName(path) {
    return `projects/${this.projectId}/databases/${this.database}/documents/${path}`;
  }

  async headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.emulatorHost) {
      headers.Authorization = `Bearer ${this.env.FIRESTORE_EMULATOR_OWNER_TOKEN || "owner"}`;
    } else {
      headers.Authorization = `Bearer ${await googleAccessToken(this.env)}`;
    }
    return headers;
  }

  async api(path, init = {}) {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...(await this.headers()), ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(response.status, "packages_firestore:request_failed", body.error?.message || "Firestore request failed", body);
    }
    return body;
  }

  async beginTransaction() {
    const body = await this.api(":beginTransaction", { method: "POST", body: JSON.stringify({}) });
    return body.transaction;
  }

  async rollback(transaction) {
    try {
      await this.api(":rollback", { method: "POST", body: JSON.stringify({ transaction }) });
    } catch (error) {
      console.warn("packages_worker rollback failed", { code: error?.code, status: error?.status });
    }
  }

  async commit(transaction, writes) {
    return this.api(":commit", { method: "POST", body: JSON.stringify({ transaction, writes }) });
  }

  async batchGet(paths, transaction) {
    if (!paths.length) return [];
    const body = await this.api(":batchGet", {
      method: "POST",
      body: JSON.stringify({ documents: paths.map((path) => this.docName(path)), transaction }),
    });
    return body.map((row) => {
      if (!row.found) return { exists: false, id: docIdFromName(row.missing), path: this.pathFromName(row.missing), data: null };
      return {
        exists: true,
        id: docIdFromName(row.found.name),
        path: this.pathFromName(row.found.name),
        name: row.found.name,
        data: fromFirestoreFields(row.found.fields || {}),
      };
    });
  }

  pathFromName(name) {
    const marker = `/databases/${this.database}/documents/`;
    return decodeURIComponent(String(name || "").split(marker)[1] || "");
  }

  async runQuery(parentPath, collectionId, filters = [], transaction, limitValue, offsetValue = 0) {
    const where = buildWhere(filters);
    const structuredQuery = {
      from: [{ collectionId }],
      ...(where ? { where } : {}),
      ...(limitValue ? { limit: limitValue } : {}),
      ...(offsetValue ? { offset: offsetValue } : {}),
    };
    const parent = parentPath ? `/${parentPath.split("/").map(encodeURIComponent).join("/")}` : "";
    const body = await this.api(`${parent}:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery, transaction }),
    });
    return body
      .filter((row) => row.document)
      .map((row) => ({
        exists: true,
        id: docIdFromName(row.document.name),
        path: this.pathFromName(row.document.name),
        name: row.document.name,
        data: fromFirestoreFields(row.document.fields || {}),
      }));
  }

  async runTransaction(callback, attempts = 8) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const transaction = await this.beginTransaction();
      const tx = new FirestoreTx(this, transaction);
      try {
        const result = await callback(tx);
        await this.commit(transaction, tx.writes);
        return result;
      } catch (error) {
        await this.rollback(transaction);
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === attempts) throw error;
        await sleep(75 * attempt * attempt + Math.floor(Math.random() * 75));
      }
    }
    throw lastError;
  }

  async getDoc(path) {
    const [doc] = await this.batchGet([path]);
    return doc || { exists: false, id: docIdFromName(path), path, data: null };
  }

  async query(parentPath, collectionId, filters = [], limitValue, offsetValue = 0) {
    return this.runQuery(parentPath, collectionId, filters, undefined, limitValue, offsetValue);
  }
}

function isRetryableTransactionError(error) {
  if (!(error instanceof AppError)) return false;
  if (error.code !== "packages_firestore:request_failed") return false;
  const message = cleanText(error.message).toLowerCase();
  return (
    message.includes("transaction lock timeout") ||
    message.includes("aborted") ||
    message.includes("too much contention") ||
    message.includes("transaction has expired")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FirestoreTx {
  constructor(client, transaction) {
    this.client = client;
    this.transaction = transaction;
    this.cache = new Map();
    this.writes = [];
  }

  async get(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const [doc] = await this.client.batchGet([path], this.transaction);
    const resolved = doc || { exists: false, id: docIdFromName(path), path, data: null };
    this.cache.set(path, resolved);
    return resolved;
  }

  async getMany(paths) {
    const missing = paths.filter((path) => !this.cache.has(path));
    if (missing.length) {
      const docs = await this.client.batchGet(missing, this.transaction);
      const byPath = new Map(docs.map((doc) => [doc.path, doc]));
      for (const path of missing) {
        this.cache.set(path, byPath.get(path) || { exists: false, id: docIdFromName(path), path, data: null });
      }
    }
    return paths.map((path) => this.cache.get(path));
  }

  async query(parentPath, collectionId, filters = [], limitValue, offsetValue = 0) {
    return this.client.runQuery(parentPath, collectionId, filters, this.transaction, limitValue, offsetValue);
  }

  create(path, data) {
    this.writes.push({
      update: { name: this.client.docName(path), fields: toFirestoreFields(data) },
      currentDocument: { exists: false },
    });
  }

  set(path, data, { merge = true } = {}) {
    const write = { update: { name: this.client.docName(path), fields: toFirestoreFields(data) } };
    if (merge) write.updateMask = { fieldPaths: fieldPaths(data) };
    this.writes.push(write);
  }

  update(path, data) {
    this.writes.push({
      update: { name: this.client.docName(path), fields: toFirestoreFields(data) },
      updateMask: { fieldPaths: fieldPaths(data) },
      currentDocument: { exists: true },
    });
  }

  delete(path) {
    this.writes.push({ delete: this.client.docName(path) });
  }
}

export function buildWhere(filters) {
  const normalized = filters.filter(Boolean);
  if (!normalized.length) return undefined;
  const converted = normalized.map(([fieldPath, op, value]) => ({
    fieldFilter: {
      field: { fieldPath },
      op,
      value: toFirestoreValue(value),
    },
  }));
  return converted.length === 1
    ? converted[0]
    : { compositeFilter: { op: "AND", filters: converted } };
}
