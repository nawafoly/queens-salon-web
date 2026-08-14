// CORE D1 ONLY — canonical employee annual leave balance.
// Do not add Firestore fallback.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from "../d1.js";
import { AppError } from "../errors.js";

const MAX_LEAVE_BALANCE_DAYS = 3650;

function normalizeDays(value, field = "days") {
  const days = Number(value);

  if (
    !Number.isFinite(days) ||
    days <= 0 ||
    days > MAX_LEAVE_BALANCE_DAYS
  ) {
    throw new AppError(
      400,
      "core_leave_balance:invalid_days",
      `${field} is invalid`
    );
  }

  if (Math.round(days * 2) !== days * 2) {
    throw new AppError(
      400,
      "core_leave_balance:invalid_days_increment",
      `${field} must use 0.5 day increments`
    );
  }

  return Math.round(days * 2) / 2;
}

function normalizeActionType(value) {
  const actionType = cleanText(value).toLowerCase();

  if (!["add", "deduct"].includes(actionType)) {
    throw new AppError(
      400,
      "core_leave_balance:invalid_action_type"
    );
  }

  return actionType;
}

function normalizeSourceType(value) {
  const sourceType =
    cleanText(value).toLowerCase() || "manual_adjustment";

  if (
    sourceType.length > 64 ||
    !/^[a-z0-9_:-]+$/.test(sourceType)
  ) {
    throw new AppError(
      400,
      "core_leave_balance:invalid_source_type"
    );
  }

  return sourceType;
}

function actorValue(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function mapLedgerEntry(row) {
  if (!row) return null;

  return {
    id: row.id,
    employeeId: row.employee_id,
    actionType: row.action_type,
    type: row.action_type,
    days: Number(row.days || 0),
    changeAmount: Number(row.change_amount || 0),
    balanceBefore: Number(row.balance_before || 0),
    balanceAfter: Number(row.balance_after || 0),
    date: row.operation_date,
    operationDate: row.operation_date,
    note: row.note || "",
    sourceType: row.source_type,
    sourceId: row.source_id || null,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    createdBy: row.created_by_name || null,
    createdAt: row.created_at,
    deleted: Boolean(row.deleted_at),
    deletedAt: row.deleted_at || null,
    deletedByUid: row.deleted_by_uid || null,
    deletedByEmail: row.deleted_by_email || null,
    deletedByName: row.deleted_by_name || null,
    deleteReason: row.delete_reason || null,
  };
}

async function employmentFor(db, salonId, employeeId) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
}

async function requireEmployment(db, salonId, employeeId) {
  const employment = await employmentFor(
    db,
    salonId,
    employeeId
  );

  if (!employment) {
    throw new AppError(
      404,
      "core_leave_balance:employee_employment_not_found"
    );
  }

  return employment;
}

export async function listLeaveBalanceLedger(
  db,
  salonId,
  employeeIdValue,
  query = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    "employeeId"
  );

  const includeDeleted =
    query.includeDeleted === true ||
    query.includeDeleted === "true";

  const includeReversals =
    query.includeReversals === true ||
    query.includeReversals === "true";

  const limit = Math.max(
    1,
    Math.min(500, Number(query.limit || 200) || 200)
  );

  const where = [
    "salon_id = ?",
    "employee_id = ?",
  ];
  const params = [salonId, employeeId];

  if (!includeDeleted) {
    where.push("deleted_at IS NULL");
  }

  if (!includeReversals) {
    where.push("source_type <> 'reversal'");
  }

  params.push(limit);

  const rows = await dbAll(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );

  return rows.map(mapLedgerEntry);
}

export async function getLeaveBalanceState(
  db,
  salonId,
  employeeIdValue,
  query = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    "employeeId"
  );

  const employment = await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const entries = await listLeaveBalanceLedger(
    db,
    salonId,
    employeeId,
    query
  );

  return {
    employeeId,
    leaveBalance: Number(
      employment.leave_balance || 0
    ),
    leaveEntitlementDate:
      employment.leave_entitlement_date || null,
    entries,
  };
}

async function existingSourceEntry(
  db,
  salonId,
  sourceType,
  sourceId
) {
  if (!sourceId) return null;

  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND source_type = ?
        AND source_id = ?
      LIMIT 1`,
    [salonId, sourceType, sourceId]
  );
}

export async function adjustLeaveBalance(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    "employeeId"
  );

  await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const actionType = normalizeActionType(
    data.actionType || data.action_type
  );

  const days = normalizeDays(data.days);

  const changeAmount =
    actionType === "add" ? days : -days;

  const operationDate = validDate(
    data.operationDate ||
      data.operation_date ||
      data.date,
    "operationDate"
  );

  const sourceType = normalizeSourceType(
    data.sourceType || data.source_type
  );

  const rawSourceId = cleanText(
    data.sourceId || data.source_id
  );

  const sourceId = rawSourceId
    ? requiredId(rawSourceId, "sourceId")
    : null;

  if (sourceId) {
    const existing = await existingSourceEntry(
      db,
      salonId,
      sourceType,
      sourceId
    );

    if (existing) {
      if (cleanText(existing.employee_id) !== employeeId) {
        throw new AppError(
          409,
          "core_leave_balance:source_employee_mismatch"
        );
      }

      const state = await getLeaveBalanceState(
        db,
        salonId,
        employeeId
      );

      return {
        previousBalance: Number(
          existing.balance_before || 0
        ),
        leaveBalanceDays: state.leaveBalance,
        leaveEntries: state.entries,
        createdEntry: mapLedgerEntry(existing),
        idempotent: true,
      };
    }
  }

  const id = requiredId(
    data.id || generatedId("leave_balance"),
    "id"
  );

  const createdAt = nowIso();
  const note =
    optionalText(data.note) || null;

  const createdByUid = actorValue(actor, "uid");
  const createdByEmail = actorValue(
    actor,
    "email"
  );
  const createdByName =
    actorValue(actor, "name") ||
    actorValue(actor, "displayName");

  const statements = [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance = leave_balance + ?,
               leave_balance_last_entry_id = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND leave_balance + ? >= 0
           AND (
             ? IS NULL
             OR NOT EXISTS (
               SELECT 1
                 FROM employee_leave_balance_ledger existing
                WHERE existing.salon_id = ?
                  AND existing.source_type = ?
                  AND existing.source_id = ?
             )
           )
      `,
      params: [
        changeAmount,
        id,
        createdByUid,
        createdByEmail,
        createdAt,
        salonId,
        employeeId,
        changeAmount,
        sourceId,
        salonId,
        sourceType,
        sourceId,
      ],
    },
    {
      sql: `
        INSERT INTO employee_leave_balance_ledger (
          id,
          salon_id,
          employee_id,
          action_type,
          days,
          change_amount,
          balance_before,
          balance_after,
          operation_date,
          note,
          source_type,
          source_id,
          created_by_uid,
          created_by_email,
          created_by_name,
          created_at
        )
        SELECT
          ?,
          ?,
          e.employee_id,
          ?,
          ?,
          ?,
          e.leave_balance - ?,
          e.leave_balance,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        FROM employee_employment e
        WHERE e.salon_id = ?
          AND e.employee_id = ?
          AND e.leave_balance_last_entry_id = ?
      `,
      params: [
        id,
        salonId,
        actionType,
        days,
        changeAmount,
        changeAmount,
        operationDate,
        note,
        sourceType,
        sourceId,
        createdByUid,
        createdByEmail,
        createdByName,
        createdAt,
        salonId,
        employeeId,
        id,
      ],
    },
  ];
  let results;

  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    if (sourceId) {
      const existing = await existingSourceEntry(
        db,
        salonId,
        sourceType,
        sourceId
      );

      if (existing) {
        const state = await getLeaveBalanceState(
          db,
          salonId,
          employeeId
        );

        return {
          previousBalance: Number(
            existing.balance_before || 0
          ),
          leaveBalanceDays: state.leaveBalance,
          leaveEntries: state.entries,
          createdEntry: mapLedgerEntry(existing),
          idempotent: true,
        };
      }
    }

    throw error;
  }

  if (changes(results?.[0]) < 1) {
    if (sourceId) {
      const existing = await existingSourceEntry(
        db,
        salonId,
        sourceType,
        sourceId
      );

      if (existing) {
        if (
          cleanText(existing.employee_id) !==
          employeeId
        ) {
          throw new AppError(
            409,
            "core_leave_balance:source_employee_mismatch"
          );
        }

        const state = await getLeaveBalanceState(
          db,
          salonId,
          employeeId
        );

        return {
          previousBalance: Number(
            existing.balance_before || 0
          ),
          leaveBalanceDays: state.leaveBalance,
          leaveEntries: state.entries,
          createdEntry: mapLedgerEntry(existing),
          idempotent: true,
        };
      }
    }

    const employment = await requireEmployment(
      db,
      salonId,
      employeeId
    );

    if (
      changeAmount < 0 &&
      Number(employment.leave_balance || 0) < days
    ) {
      throw new AppError(
        409,
        "core_leave_balance:insufficient_balance"
      );
    }

    throw new AppError(
      409,
      "core_leave_balance:adjustment_not_applied"
    );
  }

  if (changes(results?.[1]) < 1) {
    throw new AppError(
      500,
      "core_leave_balance:ledger_not_written"
    );
  }
  const [createdEntry, state] =
    await Promise.all([
      dbFirst(
        db,
        `SELECT *
           FROM employee_leave_balance_ledger
          WHERE salon_id = ?
            AND id = ?
          LIMIT 1`,
        [salonId, id]
      ),
      getLeaveBalanceState(
        db,
        salonId,
        employeeId
      ),
    ]);

  return {
    previousBalance: Number(
      createdEntry?.balance_before || 0
    ),
    leaveBalanceDays: state.leaveBalance,
    leaveEntries: state.entries,
    createdEntry: mapLedgerEntry(createdEntry),
    idempotent: false,
  };
}

export async function reverseLeaveBalanceAdjustment(
  db,
  salonId,
  entryIdValue,
  data = {},
  actor = {},
  options = {}
) {
  const entryId = requiredId(
    entryIdValue,
    "entryId"
  );

  const original = await dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, entryId]
  );

  if (!original) {
    throw new AppError(
      404,
      "core_leave_balance:entry_not_found"
    );
  }

  const expectedEmployeeId = cleanText(
    options.expectedEmployeeId
  );

  if (
    expectedEmployeeId &&
    cleanText(original.employee_id) !==
      requiredId(expectedEmployeeId, "employeeId")
  ) {
    throw new AppError(
      404,
      "core_leave_balance:entry_not_found"
    );
  }

  if (original.source_type === "reversal") {
    throw new AppError(
      409,
      "core_leave_balance:cannot_reverse_reversal"
    );
  }

  const allowedSourceTypes = Array.isArray(
    options.allowedSourceTypes
  )
    ? options.allowedSourceTypes
        .map((value) =>
          cleanText(value).toLowerCase()
        )
        .filter(Boolean)
    : null;

  if (
    allowedSourceTypes?.length &&
    !allowedSourceTypes.includes(
      cleanText(original.source_type).toLowerCase()
    )
  ) {
    throw new AppError(
      409,
      "core_leave_balance:source_not_reversible"
    );
  }

  const employeeId = requiredId(
    original.employee_id,
    "employeeId"
  );

  await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const existingReversal =
    await existingSourceEntry(
      db,
      salonId,
      "reversal",
      entryId
    );

  if (original.deleted_at || existingReversal) {
    const state = await getLeaveBalanceState(
      db,
      salonId,
      employeeId
    );

    return {
      previousBalance: state.leaveBalance,
      leaveBalanceDays: state.leaveBalance,
      leaveEntries: state.entries,
      deletedEntry: mapLedgerEntry(original),
      reversalEntry: mapLedgerEntry(
        existingReversal
      ),
      reversedChangeAmount:
        existingReversal
          ? Number(
              existingReversal.change_amount || 0
            )
          : 0,
      idempotent: true,
    };
  }

  const originalChangeAmount = Number(
    original.change_amount || 0
  );

  if (
    !Number.isFinite(originalChangeAmount) ||
    originalChangeAmount === 0
  ) {
    throw new AppError(
      409,
      "core_leave_balance:invalid_original_change"
    );
  }

  const reversedChangeAmount =
    -originalChangeAmount;

  const reversalActionType =
    reversedChangeAmount > 0
      ? "add"
      : "deduct";

  const reversalDays = Math.abs(
    reversedChangeAmount
  );

  const reversalId = requiredId(
    generatedId("leave_balance_reversal")
  );

  const createdAt = nowIso();

  const operationDate = validDate(
    data.operationDate ||
      data.operation_date ||
      new Date().toISOString().slice(0, 10),
    "operationDate"
  );

  const deleteReason =
    optionalText(
      data.reason ||
        data.deleteReason ||
        data.delete_reason
    ) || null;

  const createdByUid = actorValue(actor, "uid");
  const createdByEmail = actorValue(
    actor,
    "email"
  );
  const createdByName =
    actorValue(actor, "name") ||
    actorValue(actor, "displayName");

  const statements = [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance = leave_balance + ?,
               leave_balance_last_entry_id = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND leave_balance + ? >= 0
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger original
              WHERE original.salon_id = ?
                AND original.id = ?
                AND original.employee_id = ?
                AND original.deleted_at IS NULL
                AND original.source_type <> 'reversal'
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger existing
              WHERE existing.salon_id = ?
                AND existing.source_type = 'reversal'
                AND existing.source_id = ?
           )
      `,
      params: [
        reversedChangeAmount,
        reversalId,
        createdByUid,
        createdByEmail,
        createdAt,
        salonId,
        employeeId,
        reversedChangeAmount,
        salonId,
        entryId,
        employeeId,
        salonId,
        entryId,
      ],
    },
    {
      sql: `
        INSERT INTO employee_leave_balance_ledger (
          id,
          salon_id,
          employee_id,
          action_type,
          days,
          change_amount,
          balance_before,
          balance_after,
          operation_date,
          note,
          source_type,
          source_id,
          created_by_uid,
          created_by_email,
          created_by_name,
          created_at
        )
        SELECT
          ?,
          ?,
          original.employee_id,
          ?,
          ?,
          ?,
          employment.leave_balance - ?,
          employment.leave_balance,
          ?,
          ?,
          'reversal',
          original.id,
          ?,
          ?,
          ?,
          ?
        FROM employee_leave_balance_ledger original
        JOIN employee_employment employment
          ON employment.salon_id = original.salon_id
         AND employment.employee_id = original.employee_id
        WHERE original.salon_id = ?
          AND original.id = ?
          AND original.deleted_at IS NULL
          AND employment.leave_balance_last_entry_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_leave_balance_ledger existing
             WHERE existing.salon_id = original.salon_id
               AND existing.source_type = 'reversal'
               AND existing.source_id = original.id
          )
      `,
      params: [
        reversalId,
        salonId,
        reversalActionType,
        reversalDays,
        reversedChangeAmount,
        reversedChangeAmount,
        operationDate,
        deleteReason,
        createdByUid,
        createdByEmail,
        createdByName,
        createdAt,
        salonId,
        entryId,
        reversalId,
      ],
    },
    {
      sql: `
        UPDATE employee_leave_balance_ledger
           SET deleted_at = ?,
               deleted_by_uid = ?,
               deleted_by_email = ?,
               deleted_by_name = ?,
               delete_reason = ?
         WHERE salon_id = ?
           AND id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.id = ?
                AND reversal.source_type = 'reversal'
                AND reversal.source_id = ?
           )
      `,
      params: [
        createdAt,
        createdByUid,
        createdByEmail,
        createdByName,
        deleteReason,
        salonId,
        entryId,
        salonId,
        reversalId,
        entryId,
      ],
    },
  ];
  let results;

  try {
    results = await dbBatch(db, statements);
  } catch (error) {
    const reversal =
      await existingSourceEntry(
        db,
        salonId,
        "reversal",
        entryId
      );

    if (reversal) {
      const latestOriginal = await dbFirst(
        db,
        `SELECT *
           FROM employee_leave_balance_ledger
          WHERE salon_id = ?
            AND id = ?
          LIMIT 1`,
        [salonId, entryId]
      );

      const state = await getLeaveBalanceState(
        db,
        salonId,
        employeeId
      );

      return {
        previousBalance: Number(
          reversal.balance_before || 0
        ),
        leaveBalanceDays: state.leaveBalance,
        leaveEntries: state.entries,
        deletedEntry:
          mapLedgerEntry(latestOriginal),
        reversalEntry:
          mapLedgerEntry(reversal),
        reversedChangeAmount: Number(
          reversal.change_amount || 0
        ),
        idempotent: true,
      };
    }

    throw error;
  }

  if (changes(results?.[0]) < 1) {
    const reversal =
      await existingSourceEntry(
        db,
        salonId,
        "reversal",
        entryId
      );

    const latestOriginal = await dbFirst(
      db,
      `SELECT *
         FROM employee_leave_balance_ledger
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, entryId]
    );

    if (
      latestOriginal?.deleted_at ||
      reversal
    ) {
      const state = await getLeaveBalanceState(
        db,
        salonId,
        employeeId
      );

      return {
        previousBalance: state.leaveBalance,
        leaveBalanceDays: state.leaveBalance,
        leaveEntries: state.entries,
        deletedEntry:
          mapLedgerEntry(latestOriginal),
        reversalEntry:
          mapLedgerEntry(reversal),
        reversedChangeAmount: reversal
          ? Number(
              reversal.change_amount || 0
            )
          : 0,
        idempotent: true,
      };
    }

    const employment = await requireEmployment(
      db,
      salonId,
      employeeId
    );

    if (
      reversedChangeAmount < 0 &&
      Number(employment.leave_balance || 0) <
        reversalDays
    ) {
      throw new AppError(
        409,
        "core_leave_balance:insufficient_balance_for_reversal"
      );
    }

    throw new AppError(
      409,
      "core_leave_balance:reversal_not_applied"
    );
  }

  if (
    changes(results?.[1]) < 1 ||
    changes(results?.[2]) < 1
  ) {
    throw new AppError(
      409,
      "core_leave_balance:reversal_incomplete"
    );
  }

  const [
    latestOriginal,
    reversalEntry,
    state,
  ] = await Promise.all([
    dbFirst(
      db,
      `SELECT *
         FROM employee_leave_balance_ledger
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, entryId]
    ),
    dbFirst(
      db,
      `SELECT *
         FROM employee_leave_balance_ledger
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, reversalId]
    ),
    getLeaveBalanceState(
      db,
      salonId,
      employeeId
    ),
  ]);

  return {
    previousBalance: Number(
      reversalEntry?.balance_before || 0
    ),
    leaveBalanceDays: state.leaveBalance,
    leaveEntries: state.entries,
    deletedEntry:
      mapLedgerEntry(latestOriginal),
    reversalEntry:
      mapLedgerEntry(reversalEntry),
    reversedChangeAmount,
    idempotent: false,
  };
}

export async function setLeaveEntitlementDate(
  db,
  salonId,
  employeeIdValue,
  dateValue,
  actor = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    "employeeId"
  );

  await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const rawDate = cleanText(dateValue);
  const entitlementDate = rawDate
    ? validDate(
        rawDate,
        "leaveEntitlementDate"
      )
    : null;

  const updatedAt = nowIso();

  const result = await dbRun(
    db,
    `UPDATE employee_employment
        SET leave_entitlement_date = ?,
            updated_by_uid = ?,
            updated_by_email = ?,
            updated_at = ?
      WHERE salon_id = ?
        AND employee_id = ?`,
    [
      entitlementDate,
      actorValue(actor, "uid"),
      actorValue(actor, "email"),
      updatedAt,
      salonId,
      employeeId,
    ]
  );

  if (changes(result) < 1) {
    throw new AppError(
      404,
      "core_leave_balance:employee_employment_not_found"
    );
  }

  return getLeaveBalanceState(
    db,
    salonId,
    employeeId
  );
}