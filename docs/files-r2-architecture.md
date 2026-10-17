# MALIKAT files on Cloudflare R2

## Storage split

Binary content belongs in R2. D1 stores metadata only:

```text
Frontend -> Core Worker -> FILES_BUCKET (binary)
                        -> CORE_DB.file_metadata (metadata)
```

The Core Worker has the active R2 binding in `wrangler.core.jsonc`:

```jsonc
"r2_buckets": [
  { "binding": "FILES_BUCKET", "bucket_name": "queens-salon-files" }
]
```

There is no runtime file source-selection flag. `CoreFilesService` is R2-only and always targets the Core Worker file routes; it never falls back to Firebase Storage.

## Metadata

`file_metadata` stores the file id, employee relation, category, name, content type, byte size, visibility, storage key, replacement links and audit fields. It never stores base64 or binary content.

## Protected flow

`src/services/CoreFilesService.ts` calls protected Core Worker routes:

- create/list file metadata
- upload object content to `/api/core/files/:id/content`
- download object content from the same protected route

The Worker validates the Firebase ID token, resolves role metadata from D1 and requires `FILES_BUCKET`. If the binding is absent it returns a clear configuration error. Binary file operations never fall back to Firebase Storage.

`src/services/firebase.ts` remains available for Firebase authentication and other explicitly audited Firebase compatibility surfaces, but it must not initialize or export a Firebase Storage client.

## Current operational state

- `FILES_BUCKET` is bound to `queens-salon-files` in the Core Worker configuration.
- frontend file metadata/content operations use `CoreFilesService` and Core Worker routes without a storage source-selection flag.
- Firebase Storage is not a runtime file backend.

## Legacy migration

Any remaining legacy Firebase Storage objects are migration or cleanup artifacts, not a runtime source of truth. Their deletion must remain a separate audited operation: verify the matching R2 object, byte size/content type and `file_metadata` row before removing any legacy object.
