import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listInternalBookingDrafts, saveInternalBookingDraft, getInternalBookingDraft, deleteInternalBookingDraft } from './core/repositories/internal-booking-drafts.js';
import { clientConflictSelectionKeys } from '../src/helpers/clientConflictSelectionKeys.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/core/0091_internal_booking_drafts.sql', 'utf8'));
  const db = { __fakeD1: true,
    first: (sql, args) => sqlite.prepare(sql).get(...args) || null,
    all: (sql, args) => sqlite.prepare(sql).all(...args),
    run: (sql, args) => sqlite.prepare(sql).run(...args),
  };
  return { sqlite, db };
}

test('drafts beyond twenty remain reachable, with deterministic ordering and owner isolation', async () => {
  const { sqlite, db } = database();
  try {
    for (let i = 0; i < 26; i++) {
      await saveInternalBookingDraft(db, 'salon', { id: `draft_${String(i).padStart(2, '0')}`, draft: { step: 3 } }, { uid: 'reception' });
    }
    await saveInternalBookingDraft(db, 'salon', { draft: {} }, { uid: 'other' });
    await saveInternalBookingDraft(db, 'other-salon', { draft: {} }, { uid: 'reception' });
    sqlite.exec("UPDATE internal_booking_drafts SET updated_at = '2026-10-02T00:00:00Z'");
    const first = await listInternalBookingDrafts(db, 'salon', { uid: 'reception' });
    const second = await listInternalBookingDrafts(db, 'salon', { uid: 'reception' }, { offset: 20 });
    assert.equal(first.length, 20);
    assert.equal(second.length, 6);
    assert.equal(new Set([...first, ...second].map(row => row.id)).size, 26);
    assert.deepEqual(second[0].draft, { step: 3 });
    assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name), ['internal_booking_drafts']);
  } finally { sqlite.close(); }
});

test('draft update/delete cannot cross owners or salons', async () => {
  const { sqlite, db } = database();
  try {
    const saved = await saveInternalBookingDraft(db, 'salon', { draft: { name: 'client' } }, { uid: 'owner' });
    await assert.rejects(getInternalBookingDraft(db, 'salon', saved.id, { uid: 'other' }), { code: 'core_booking_draft:not_found' });
    await assert.rejects(saveInternalBookingDraft(db, 'salon', { id: saved.id, draft: {} }, { uid: 'other' }), { code: 'core_booking_draft:forbidden' });
    await assert.rejects(deleteInternalBookingDraft(db, 'other-salon', saved.id, { uid: 'owner' }), { code: 'core_booking_draft:not_found' });
    await deleteInternalBookingDraft(db, 'salon', saved.id, { uid: 'owner' });
    assert.deepEqual(await listInternalBookingDrafts(db, 'salon', { uid: 'owner' }), []);
  } finally { sqlite.close(); }
});

const rows = [
  { key: 'a1', clientKey: 'a', time: '10:00', duration: 60 },
  { key: 'a2', clientKey: 'a', time: '12:00', duration: 30 },
  { key: 'b1', clientKey: 'b', time: '10:00', duration: 60 },
];
test('client conflicts clear only affected services even if their staff remains available', () => {
  assert.deepEqual([...clientConflictSelectionKeys(rows, 'a', { startTime: '10:00', endTime: '11:00' })], ['a1']);
  assert.deepEqual([...clientConflictSelectionKeys(rows, 'a', { startTime: '11:00', endTime: '12:00' })], []);
  assert.deepEqual([...clientConflictSelectionKeys(rows, 'a', {})], ['a1', 'a2']);
  assert.deepEqual([...clientConflictSelectionKeys([{ key: 'night', clientKey: 'a', time: '23:30', duration: 60 }], 'a', { startTime: '23:30', endTime: '00:30' })], ['night']);
});
