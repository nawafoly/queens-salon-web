import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const filename =
  "src/services/bookingDataSources/coreD1BookingDataSource.ts";

const source = fs.readFileSync(filename, "utf8");

const tree = ts.createSourceFile(
  filename,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

assert.equal(tree.parseDiagnostics.length, 0);

function findMethod(name) {
  const matches = [];

  function visit(node) {
    if (
      ts.isMethodDeclaration(node) &&
      node.name?.getText(tree) === name
    ) {
      matches.push(node);
    }

    ts.forEachChild(node, visit);
  }

  visit(tree);

  assert.equal(matches.length, 1, name);

  return matches[0];
}

function runtime(overrides = {}) {
  const calls = [];

  const confirmed = {
    id: "booking-local",
    status: "booked"
  };

  const CoreBookingService = {
    async complete(id) {
      calls.push(["complete", id]);

      return {...confirmed, status: "completed"};
    },

    async cancel(id) {
      calls.push(["cancel", id]);

      return {...confirmed, status: "cancelled"};
    },

    async patch(id, payload) {
      calls.push(["patch", id, payload]);

      return {...confirmed, ...payload};
    },

    async get() {
      throw new Error("Unexpected duplicate preflight GET");
    },

    ...overrides
  };

  const method = findMethod("updateBookingStatus");

  const wrapped =
    "const bookingService = {" +
    method.getText(tree) +
    "}; bookingService;";

  const compiled = ts.transpileModule(
    wrapped,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None
      }
    }
  ).outputText;

  const bookingService = vm.runInNewContext(
    compiled,
    {
      CoreBookingService,

      PackageOperationsService: new Proxy(
        {},
        {
          get() {
            throw new Error(
              "Duplicate package mutation is forbidden"
            );
          }
        }
      ),

      invalidateCoreAvailability(value) {
        calls.push([
          "invalidate",
          value.id,
          value.status
        ]);
      }
    }
  );

  return {
    bookingService,
    calls
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("B04 E4 completion performs one Core mutation", async () => {
  const {bookingService, calls} = runtime();

  await bookingService.updateBookingStatus(
    "booking-local", "completed"
  );

  assert.deepEqual(
    plain(calls),
    [
      ["complete", "booking-local"],
      ["invalidate", "booking-local", "completed"]
    ]
  );
});

test("B04 E4 cancellation performs one Core mutation", async () => {
  const {bookingService, calls} = runtime();

  await bookingService.updateBookingStatus(
    "booking-local", "cancelled"
  );

  assert.deepEqual(
    plain(calls),
    [
      ["cancel", "booking-local"],
      ["invalidate", "booking-local", "cancelled"]
    ]
  );
});

test("B04 E4 confirmed status preserves canonical mapping", async () => {
  const {bookingService, calls} = runtime();

  await bookingService.updateBookingStatus(
    "booking-local", "confirmed"
  );

  assert.deepEqual(
    plain(calls),
    [
      ["patch", "booking-local", {status: "booked"}],
      ["invalidate", "booking-local", "booked"]
    ]
  );
});

for (const status of ["completed", "cancelled"]) {
  test(
    "B04 E4 failed Core mutation has no compensation " + status,
    async () => {
      const error = new Error("local-core-unavailable");

      const method =
        status === "completed" ? "complete" : "cancel";

      const {bookingService, calls} = runtime({
        [method]: async () => {
          throw error;
        }
      });

      await assert.rejects(
        () => bookingService.updateBookingStatus(
          "booking-local", status
        ),
        candidate => candidate === error
      );

      assert.deepEqual(calls, []);
    }
  );
}

test("B04 E4 data source contains no independent package mutation calls", () => {
  const calls = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(tree) ===
        "PackageOperationsService"
    ) {
      calls.push(node.expression.getText(tree));
    }

    ts.forEachChild(node, visit);
  }

  visit(tree);

  assert.deepEqual(calls, []);
});

test("B04 E4 lifecycle methods do not depend on speculative booking reads", () => {
  const method = findMethod("updateBookingStatus");

  const text = method.getText(tree);

  assert.ok(!text.includes("CoreBookingService.get("));
  assert.ok(!text.includes("consumeReserved"));
  assert.ok(!text.includes("restoreReserved"));
});

test("B04 E4 lifecycle tests are included in booking integrity gate", () => {
  const pkg = JSON.parse(
    fs.readFileSync("package.json", "utf8")
  );

  assert.match(
    pkg.scripts["test:booking:integrity"],
    /workers\/booking-frontend-lifecycle\.test\.mjs/
  );
});
