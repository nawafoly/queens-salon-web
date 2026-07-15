# Queens Salon files on Cloudflare R2

## Storage split

Binary content belongs in R2. D1 stores metadata only:

```text
Frontend -> Core Worker -> FILES_BUCKET (binary)
                        -> CORE_DB.file_metadata (metadata)
```

The binding is intentionally commented in `wrangler.core.jsonc` until the bucket is created:

```jsonc
"r2_buckets": [
  { "binding": "FILES_BUCKET", "bucket_name": "queens-salon-files" }
]
```

The frontend flag remains disabled:

```env
VITE_USE_R2_FILES=false
```

## Metadata

`file_metadata` stores the file id, employee relation, category, name, content type, byte size, visibility, storage key, replacement links and audit fields. It never stores base64 or binary content.

## Protected flow

`src/services/CoreFilesService.ts` calls protected Core Worker routes:

- create/list file metadata
- upload object content to `/api/core/files/:id/content`
- download object content from the same protected route

The Worker validates the Firebase ID token, resolves role metadata from D1 and requires `FILES_BUCKET`. If the binding is absent it returns a clear configuration error. It never falls back to Firebase Storage.

## Creation commands for later

```powershell
npx wrangler r2 bucket create queens-salon-files
```

After creation, uncomment the `FILES_BUCKET` binding in `wrangler.core.jsonc`, run the file integration checks, deploy the Core Worker, then enable `VITE_USE_R2_FILES=true` only after metadata and object migration have been validated.

## Legacy migration

The Core migration script imports file metadata only. Actual Firebase Storage objects require a separate one-time copy job that:

1. enumerates approved legacy objects;
2. preserves a stable storage key;
3. writes the object to R2;
4. verifies byte size/content type;
5. upserts `file_metadata`;
6. does not delete the legacy object until a later audited cleanup.
