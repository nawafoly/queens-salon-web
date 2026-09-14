# Reachable Firestore → Core/D1 cutover

UI → Core API → D1 for these prod-reachable flows (no Firestore fallback):

1. ChatBot — settings/app+public, catalog, taken booking times
2. Home Testimonials — `/api/core/testimonials`
3. About staff — `/api/core/staff/public-about` (from `employee_profiles.show_on_about`)
4. Client profile — `/api/auth/me` + `/api/core/client/me` (+ ensure-client)
5. Register client profile writes — Firebase Auth + `POST /api/core/auth/ensure-client`

## Schema

- `migrations/core/0070_testimonials_and_client_profile.sql`
  - `testimonials` table
  - `clients` columns: `city`, `birthdate`, `avatar_url`, `membership_id`, `membership_percent`

## Data cutover scripts (dry-run default)

```bash
# Testimonials (export salons/main/testimonials to JSON first)
node scripts/migrate-testimonials-firestore-to-d1.mjs --input ./testimonials-export.json
node scripts/migrate-testimonials-firestore-to-d1.mjs --input ./testimonials-export.json --apply

# Client profile fields (export salons/main/users client docs to JSON first)
node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json
node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json --apply
```

If `wrangler d1 execute` returns API 7403, apply the generated SQL via Cloudflare Bindings MCP `d1_database_query` in batches.

About staff does not need a Firestore import: D1 `employee_profiles` already holds `show_on_about` rows.

## Firebase remaining

- Firebase Auth only (login/register tokens)
- Unrouted legacy modules outside these five flows are intentionally untouched
