# Core D1 Backup / Restore Baseline

## Safety rule

Production restore is destructive. Never restore production in-place without
first capturing the current recovery point and explicitly approving the target
timestamp or recovery artifact.

## Repository restore drill

Run:

```bash
npm run test:backup-restore
```

The drill is local-only and isolated from normal development state.

It:

1. Builds a current-schema source database from `migrations/core`.
2. Inserts a known restore sentinel.
3. Uses `wrangler d1 export --no-schema` to back up every application table.
4. Builds a completely separate restore target from the same canonical
   migrations.
5. Loads the data-only backup into that target.
6. Verifies SHA-256 artifact generation, exact application table set, exact row
   counts per table, sentinel fidelity, `PRAGMA integrity_check`, and
   `PRAGMA foreign_key_check`.
7. Deletes all temporary drill state.

### Why the drill is data-only

The application schema is already version-controlled by `migrations/core`.
The restore drill therefore treats migrations as schema authority and D1 export
as the data backup artifact.

Wrangler/D1 has a known local full schema+data dump import ordering problem for
schemas with dependencies: an exported full SQL file can reference an object
before its dependency has been created. P6 does not weaken the restore check to
work around that behavior. It reconstructs schema from canonical migrations,
then restores exported application data and verifies the resulting database.

## Production recovery

For production D1, prefer the supported platform recovery mechanism appropriate
to the incident, especially D1 Time Travel for point-in-time recovery.

Before any production restore:

- identify database, tenant, and environment;
- capture the current recovery bookmark / recovery point;
- record requested target time or backup artifact checksum;
- record operator and approval;
- stop conflicting writes when required;
- restore;
- run Core health checks and critical business smoke checks;
- record the resulting recovery point.

Never run the local P6 drill against `--remote`.
