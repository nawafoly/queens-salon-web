import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

import {
  beginIdempotentOperation as beginOwned,
  completeIdempotentOperation as completeOwned,
  abandonIdempotentOperation as abandonOwned,
  requestFingerprint,
  atomicIdempotencyCompletionStatements,
} from "./core/idempotency.js";

// F1 fixtures use a known execution token.
// F2 tests exercise independent execution owners directly.

function beginIdempotentOperation(
  db, tenant, operation, fingerprint, requestId
) {
  return beginOwned(
    db, tenant, operation, fingerprint,
    requestId, "fixture-execution-owner"
  );
}

function completeIdempotentOperation(
  db, tenant, operation, fingerprint,
  requestId, status, body
) {
  return completeOwned(
    db, tenant, operation, fingerprint,
    requestId, status, body,
    "fixture-execution-owner"
  );
}

function abandonIdempotentOperation(
  db, tenant, operation, fingerprint
) {
  return abandonOwned(
    db, tenant, operation, fingerprint,
    "fixture-execution-owner"
  );
}


function setup(t) {
  const sqlite = new DatabaseSync(":memory:");

  sqlite.exec(
    readFileSync(
      "migrations/core/0056_core_request_idempotency.sql",
      "utf8"
    )
  );

  sqlite.exec(
    readFileSync(
      "migrations/core/0122_idempotency_execution_ownership.sql",
      "utf8"
    )
  );

  t.after(() => sqlite.close());

  const db = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const result = sqlite.prepare(sql).run(...params);
              return {
                meta: { changes: Number(result.changes) }
              };
            },

            async first() {
              return sqlite.prepare(sql).get(...params) ?? null;
            }
          };
        }
      };
    }
  };

  const rows = () => sqlite.prepare(
    "SELECT * FROM core_idempotency_operations ORDER BY salon_id, operation_id"
  ).all().map(row => ({...row}));

  return {db, sqlite, rows};
}

test("B04 F1 first operation creates one durable pending record", async t => {
  const {db, rows} = setup(t);

  assert.deepEqual(
    await beginIdempotentOperation(
      db, "main", "op-a", "fingerprint-a", "req-a"
    ),
    {action:"proceed"}
  );

  assert.equal(rows().length,1);
  assert.equal(rows()[0].state,"pending");
});

test("B04 F1 identical concurrent requests acquire only one execution", async t => {
  const {db, rows} = setup(t);

  const results = await Promise.all(
    Array.from({length:10}, (_,index) =>
      beginIdempotentOperation(
        db,"main","op-a","fingerprint-a",`req-${index}`
      )
    )
  );

  assert.equal(
    results.filter(row => row.action === "proceed").length,1
  );

  assert.equal(
    results.filter(row => row.action === "in_progress").length,9
  );

  assert.equal(rows().length,1);
});

test("B04 F1 divergent fingerprints cannot reuse pending operations", async t => {
  const {db, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  const before = rows();

  assert.deepEqual(
    await beginIdempotentOperation(
      db,"main","op-a","fingerprint-b","req-b"
    ),
    {action:"conflict"}
  );

  assert.deepEqual(rows(),before);
});

test("B04 F1 completed operations replay exactly one stored response", async t => {
  const {db, rows} = setup(t);

  const body = JSON.stringify({
    id:"payment-a",
    amountHalalas:7500
  });

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a",201,body
  );

  assert.deepEqual(
    await beginIdempotentOperation(
      db,"main","op-a","fingerprint-a","req-b"
    ),
    {
      action:"replay",
      status:201,
      responseBody:body
    }
  );

  assert.equal(rows().length,1);
  assert.equal(rows()[0].state,"completed");
});

test("B04 F1 operation identity is isolated between tenants", async t => {
  const {db, rows} = setup(t);

  for (const tenant of ["main","other"]) {
    assert.deepEqual(
      await beginIdempotentOperation(
        db,tenant,"op-a","fingerprint-a","req-a"
      ),
      {action:"proceed"}
    );
  }

  assert.equal(rows().length,2);

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a",200,"{}"
  );

  assert.equal(
    rows().find(row => row.salon_id === "other").state,
    "pending"
  );
});

test("B04 F1 old pending age is not proof that execution is safe", async t => {
  const {db, sqlite, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  sqlite.prepare(
    `UPDATE core_idempotency_operations
     SET created_at = ?, updated_at = ?
     WHERE salon_id = ? AND operation_id = ?`
  ).run(
    "2020-01-01T00:00:00.000Z",
    "2020-01-01T00:00:00.000Z",
    "main","op-a"
  );

  assert.deepEqual(
    await beginIdempotentOperation(
      db,"main","op-a","fingerprint-a","req-b"
    ),
    {action:"in_progress"}
  );

  assert.equal(rows().length,1);
  assert.equal(rows()[0].state,"pending");
});

test("B04 F1 wrong fingerprint cannot complete another operation", async t => {
  const {db, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  const before = rows();

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-b","req-b",200,"{}"
  );

  assert.deepEqual(rows(),before);
});

test("B04 F1 wrong fingerprint cannot abandon another operation", async t => {
  const {db, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  const before = rows();

  await abandonIdempotentOperation(
    db,"main","op-a","fingerprint-b"
  );

  assert.deepEqual(rows(),before);
});

test("B04 F1 completed operations cannot be abandoned", async t => {
  const {db, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a",200,"{}"
  );

  const before = rows();

  await abandonIdempotentOperation(
    db,"main","op-a","fingerprint-a"
  );

  assert.deepEqual(rows(),before);
});

test("B04 F1 fingerprints distinguish actors routes and payloads", async () => {
  function request(path="/api/core/payments", amount=7500) {
    return new Request(`https://worker.test${path}`, {
      method:"POST",
      body:JSON.stringify({amountHalalas:amount})
    });
  }

  const first = await requestFingerprint(
    request(),"main:actor-a"
  );

  assert.equal(
    await requestFingerprint(
      request(),"main:actor-a"
    ),
    first
  );

  assert.notEqual(
    await requestFingerprint(
      request(),"main:actor-b"
    ),
    first
  );

  assert.notEqual(
    await requestFingerprint(
      request("/api/core/refunds"),"main:actor-a"
    ),
    first
  );

  assert.notEqual(
    await requestFingerprint(
      request("/api/core/payments",8000),"main:actor-a"
    ),
    first
  );
});

test("B04 F1 completed response cannot be overwritten by a later completion", async t => {
  const {db, rows} = setup(t);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a",201,'{"id":"original"}'
  );

  const before = rows();

  await completeIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-b",200,'{"id":"changed"}'
  );

  assert.deepEqual(rows(),before);
});

test("B04 F1 a committed domain operation can remain stranded in HTTP pending", async t => {
  const {db, sqlite, rows} = setup(t);

  sqlite.exec(`
    CREATE TABLE synthetic_domain_effects (
      salon_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      amount_halalas INTEGER NOT NULL,
      PRIMARY KEY(salon_id, operation_id)
    )
  `);

  await beginIdempotentOperation(
    db,"main","op-a","fingerprint-a","req-a"
  );

  sqlite.prepare(
    "INSERT INTO synthetic_domain_effects VALUES (?, ?, ?)"
  ).run("main","op-a",7500);

  // Simulated interruption after domain commit and before HTTP completion.

  assert.deepEqual(
    await beginIdempotentOperation(
      db,"main","op-a","fingerprint-a","req-b"
    ),
    {action:"in_progress"}
  );

  assert.equal(rows()[0].state,"pending");

  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM synthetic_domain_effects"
    ).get().count,
    1
  );
});

test("B04 F2 a new operation requires execution ownership", async t => {
  const {db,rows} = setup(t);

  await assert.rejects(
    () => beginOwned(db,"main","op","fp","req"),
    /execution_token_required/
  );

  assert.deepEqual(rows(),[]);
});

test("B04 F2 a second executor cannot complete another pending operation", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  const before = rows();

  assert.equal(
    await completeOwned(
      db,"main","op","fp","req-b",
      200,"{}","owner-b"
    ),
    false
  );

  assert.deepEqual(rows(),before);
});

test("B04 F2 a second executor cannot abandon another pending operation", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  const before = rows();

  assert.equal(
    await abandonOwned(
      db,"main","op","fp","owner-b"
    ),
    false
  );

  assert.deepEqual(rows(),before);
});

test("B04 F2 the execution owner can complete its operation exactly once", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  assert.equal(
    await completeOwned(
      db,"main","op","fp","req-a",
      201,'{"id":"payment-a"}',"owner-a"
    ),
    true
  );

  assert.equal(
    await completeOwned(
      db,"main","op","fp","req-a",
      200,"{}","owner-a"
    ),
    false
  );

  assert.equal(rows()[0].state,"completed");
  assert.equal(rows()[0].response_status,201);
});

test("B04 F2 replay observers cannot acquire execution ownership", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  assert.deepEqual(
    await beginOwned(
      db,"main","op","fp","req-b","owner-b"
    ),
    {action:"in_progress"}
  );

  assert.equal(
    rows()[0].execution_token,
    "owner-a"
  );

  assert.equal(
    await abandonOwned(
      db,"main","op","fp","owner-b"
    ),
    false
  );
});

test("B04 F2 stale executor cannot mutate a recreated operation", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","same-req","owner-a"
  );

  assert.equal(
    await abandonOwned(
      db,"main","op","fp","owner-a"
    ),
    true
  );

  await beginOwned(
    db,"main","op","fp","same-req","owner-b"
  );

  assert.equal(
    await completeOwned(
      db,"main","op","fp","same-req",
      200,"{}","owner-a"
    ),
    false
  );

  assert.equal(
    await abandonOwned(
      db,"main","op","fp","owner-a"
    ),
    false
  );

  assert.equal(rows()[0].state,"pending");
  assert.equal(rows()[0].execution_token,"owner-b");
});

test("B04 F2 historical pending operations remain fail closed", async t => {
  const {db,sqlite,rows} = setup(t);

  sqlite.prepare(`
    INSERT INTO core_idempotency_operations (
      salon_id,operation_id,request_fingerprint,
      state,first_request_id,last_request_id,
      created_at,updated_at
    )
    VALUES (
      'main','legacy-op','fp','pending',
      'old-req','old-req',
      '2020-01-01','2020-01-01'
    )
  `).run();

  assert.deepEqual(
    await beginOwned(
      db,"main","legacy-op","fp","new-req","owner-b"
    ),
    {action:"in_progress"}
  );

  assert.equal(
    await abandonOwned(
      db,"main","legacy-op","fp","owner-b"
    ),
    false
  );

  assert.equal(
    await completeOwned(
      db,"main","legacy-op","fp","new-req",
      200,"{}","owner-b"
    ),
    false
  );

  assert.equal(rows()[0].execution_token,null);
  assert.equal(rows()[0].state,"pending");
});

test("B04 F2 execution owner is immutable at the database boundary", async t => {
  const {db,sqlite,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  assert.throws(
    () => sqlite.prepare(
      "UPDATE core_idempotency_operations SET execution_token = ?"
    ).run("owner-b"),
    /execution_owner_immutable/
  );

  assert.equal(rows()[0].execution_token,"owner-a");
});

test("B04 F2 legacy completed replay remains compatible", async t => {
  const {db,sqlite} = setup(t);

  sqlite.prepare(`
    INSERT INTO core_idempotency_operations (
      salon_id,operation_id,request_fingerprint,
      state,response_status,response_body,
      first_request_id,last_request_id,
      created_at,updated_at
    )
    VALUES (
      'main','legacy-complete','fp','completed',
      200,'{"ok":true}',
      'old-req','old-req',
      '2020-01-01','2020-01-01'
    )
  `).run();

  assert.deepEqual(
    await beginOwned(
      db,"main","legacy-complete",
      "fp","new-req","owner-b"
    ),
    {
      action:"replay",
      status:200,
      responseBody:'{"ok":true}'
    }
  );
});

test("B04 F2 ownership does not cross tenant boundaries", async t => {
  const {db,rows} = setup(t);

  await beginOwned(
    db,"main","op","fp","req-a","owner-a"
  );

  await beginOwned(
    db,"other","op","fp","req-b","owner-b"
  );

  assert.equal(
    await completeOwned(
      db,"other","op","fp","req-a",
      200,"{}","owner-a"
    ),
    false
  );

  assert.equal(rows().length,2);

  assert.ok(rows().every(
    row => row.state === "pending"
  ));
});

function f31CommitContext(overrides = {}) {
  return {
    salonId: "main",
    operationId: "f31-operation",
    fingerprint: "f31-fingerprint",
    requestId: "f31-request",
    executionToken: "f31-owner",
    status: 201,
    responseBody: JSON.stringify({
      ok: true,
      data: {
        id: "f31-payment",
        amountHalalas: 7500
      }
    }),
    ...overrides
  };
}

async function f31Setup(t) {
  const fixture = setup(t);

  fixture.sqlite.exec(`
    CREATE TABLE f31_financial_effects (
      salon_id TEXT NOT NULL,
      id TEXT NOT NULL,
      amount_halalas INTEGER NOT NULL,
      PRIMARY KEY(salon_id,id)
    );
  `);

  const ctx = f31CommitContext();

  await beginOwned(
    fixture.db,
    ctx.salonId,
    ctx.operationId,
    ctx.fingerprint,
    ctx.requestId,
    ctx.executionToken
  );

  return {
    ...fixture,
    ctx,
    effects() {
      return fixture.sqlite.prepare(
        "SELECT * FROM f31_financial_effects ORDER BY salon_id,id"
      ).all().map(row => ({...row}));
    }
  };
}

function f31Effect(id = "f31-payment") {
  return {
    sql: "INSERT INTO f31_financial_effects VALUES (?,?,?)",
    params:["main",id,7500]
  };
}

function f31Batch(sqlite, statements) {
  sqlite.exec("BEGIN IMMEDIATE");

  try {
    for (const statement of statements) {
      sqlite.prepare(statement.sql).run(
        ...statement.params
      );
    }

    sqlite.exec("COMMIT");

  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

test("B04 F31 atomic commit survives lost HTTP response", async t => {
  const f = await f31Setup(t);

  f31Batch(f.sqlite, [
    f31Effect(),
    ...atomicIdempotencyCompletionStatements(f.ctx)
  ]);

  // No post-commit HTTP completion call is made.
  const retry = await beginOwned(
    f.db,
    "main",
    f.ctx.operationId,
    f.ctx.fingerprint,
    "retry-request",
    "retry-owner"
  );

  assert.deepEqual(retry,{
    action:"replay",
    status:201,
    responseBody:f.ctx.responseBody
  });

  assert.equal(f.effects().length,1);
  assert.equal(f.rows()[0].state,"completed");
});

test("B04 F31 business failure rolls back commit evidence", async t => {
  const f = await f31Setup(t);
  const before = f.rows();

  assert.throws(
    () => f31Batch(f.sqlite, [
      f31Effect(),
      f31Effect(),
      ...atomicIdempotencyCompletionStatements(f.ctx)
    ]),
    /UNIQUE constraint failed/
  );

  assert.deepEqual(f.effects(),[]);
  assert.deepEqual(f.rows(),before);
});

test("B04 F31 failure after evidence rolls back the entire batch", async t => {
  const f = await f31Setup(t);
  const before = f.rows();

  assert.throws(
    () => f31Batch(f.sqlite, [
      f31Effect(),
      ...atomicIdempotencyCompletionStatements(f.ctx),
      f31Effect()
    ]),
    /UNIQUE constraint failed/
  );

  assert.deepEqual(f.effects(),[]);
  assert.deepEqual(f.rows(),before);
});

for (const [label,overrides] of [
  ["wrong owner",{executionToken:"wrong-owner"}],
  ["wrong fingerprint",{fingerprint:"wrong-fingerprint"}],
  ["wrong tenant",{salonId:"other"}],
  ["missing operation",{operationId:"missing-operation"}],
]) {
  test("B04 F31 rejects " + label + " atomically", async t => {
    const f = await f31Setup(t);
    const before = f.rows();

    assert.throws(
      () => f31Batch(f.sqlite, [
        f31Effect(),
        ...atomicIdempotencyCompletionStatements({
          ...f.ctx,
          ...overrides
        })
      ]),
      /NOT NULL constraint failed: core_idempotency_operations.salon_id/
    );

    assert.deepEqual(f.effects(),[]);
    assert.deepEqual(f.rows(),before);
  });
}

test("B04 F31 completed operation cannot commit a second business mutation", async t => {
  const f = await f31Setup(t);

  f31Batch(f.sqlite, [
    f31Effect(),
    ...atomicIdempotencyCompletionStatements(f.ctx)
  ]);

  const before = f.effects();
  const original = f.rows();

  assert.throws(
    () => f31Batch(f.sqlite, [
      f31Effect("duplicate-payment"),
      ...atomicIdempotencyCompletionStatements(f.ctx)
    ]),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(f.effects(),before);
  assert.deepEqual(f.rows(),original);
});

test("B04 F31 stale executor cannot commit after recreation", async t => {
  const f = await f31Setup(t);

  assert.equal(
    await abandonOwned(
      f.db,
      "main",
      f.ctx.operationId,
      f.ctx.fingerprint,
      f.ctx.executionToken
    ),
    true
  );

  await beginOwned(
    f.db,
    "main",
    f.ctx.operationId,
    f.ctx.fingerprint,
    "new-request",
    "new-owner"
  );

  const before = f.rows();

  assert.throws(
    () => f31Batch(f.sqlite, [
      f31Effect(),
      ...atomicIdempotencyCompletionStatements(f.ctx)
    ]),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(f.effects(),[]);
  assert.deepEqual(f.rows(),before);
});

test("B04 F31 HTTP finalizer cannot overwrite atomic evidence", async t => {
  const f = await f31Setup(t);

  f31Batch(f.sqlite, [
    f31Effect(),
    ...atomicIdempotencyCompletionStatements(f.ctx)
  ]);

  const before = f.rows();

  assert.equal(
    await completeOwned(
      f.db,
      "main",
      f.ctx.operationId,
      f.ctx.fingerprint,
      f.ctx.requestId,
      200,
      '{"changed":true}',
      f.ctx.executionToken
    ),
    false
  );

  assert.equal(
    await abandonOwned(
      f.db,
      "main",
      f.ctx.operationId,
      f.ctx.fingerprint,
      f.ctx.executionToken
    ),
    false
  );

  assert.deepEqual(f.rows(),before);
});

test("B04 F31 invalid completion identity is rejected", () => {
  for (const overrides of [
    {executionToken:""},
    {fingerprint:""},
    {operationId:"bad operation"},
    {salonId:null},
    {requestId:undefined},
  ]) {
    assert.throws(
      () => atomicIdempotencyCompletionStatements(
        f31CommitContext(overrides)
      ),
      /invalid_commit_identity/
    );
  }
});

test("B04 F31 error or bodyless HTTP status cannot become success evidence", () => {
  for (const status of [199,204,205,300,400,409,500,200.5,"200"]) {
    assert.throws(
      () => atomicIdempotencyCompletionStatements(
        f31CommitContext({status})
      ),
      /invalid_commit_status/
    );
  }
});

test("B04 F31 malformed or unsuccessful response cannot become commit evidence", () => {
  for (const responseBody of [
    null,
    "",
    "{",
    "null",
    "[]",
    "123",
    '{"ok":false}'
  ]) {
    assert.throws(
      () => atomicIdempotencyCompletionStatements(
        f31CommitContext({responseBody})
      ),
      /invalid_commit_response/
    );
  }
});

test("B04 F31 historical pending without owner cannot be recovered by invention", async t => {
  const f = await f31Setup(t);

  f.sqlite.prepare(`
    INSERT INTO core_idempotency_operations
      (salon_id,operation_id,request_fingerprint,state,
       first_request_id,last_request_id,created_at,updated_at)
    VALUES
      ('main','historical','f31-fingerprint','pending',
       'old','old','2020-01-01','2020-01-01')
  `).run();

  const before = f.rows();

  assert.throws(
    () => f31Batch(f.sqlite, [
      f31Effect(),
      ...atomicIdempotencyCompletionStatements({
        ...f.ctx,
        operationId:"historical"
      })
    ]),
    /NOT NULL constraint failed/
  );

  assert.deepEqual(f.effects(),[]);
  assert.deepEqual(f.rows(),before);
});
