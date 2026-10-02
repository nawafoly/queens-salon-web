import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { listClients, getClientDirectorySummary } from './core/repositories/clients.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations/core').filter(x => x.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/core/${name}`, 'utf8'));
  }
  const insert = sqlite.prepare("INSERT INTO clients(id,salon_id,name,phone_normalized,vip,canonical_client_id,created_at,updated_at) VALUES(?, 'salon', ?, ?, ?, ?, '2026-01-01', '2026-01-01')");
  for (let i=0; i<520; i++) insert.run(`c${String(i).padStart(4, '0')}`, i === 0 ? 'أمل' : 'هبة', i === 0 ? '0570142717' : `9665${String(i).padStart(8,'0')}`, i === 0 ? 1 : 0, `canonical${i}`);
  return { sqlite, db: { __fakeD1: true,
    all: (sql,args) => sqlite.prepare(sql).all(...args),
    first: (sql,args) => sqlite.prepare(sql).get(...args) || null,
  } };
}

test('real SQL preserves full and partial localized phone search across list modes', async () => {
  const { sqlite, db } = database();
  try {
    for (const query of ['0570142717','966570142717','+966570142717','٠٥٧٠١٤٢٧١٧','۰۵۷۰۱۴۲۷۱۷','057014']) {
      for (const mode of [{}, {includeMetrics:true}, {includeLoyalty:true}]) {
        assert.equal((await listClients(db,'salon',{search:query,...mode}))[0]?.id,'c0000', JSON.stringify({query,mode}));
      }
    }
    for (const query of ['أمل','امل','أَمَل']) {
      assert.equal((await listClients(db,'salon',{search:query}))[0]?.id,'c0000');
    }
    assert.equal((await getClientDirectorySummary(db,'salon',{search:'هبه'})).totalClients,519);
  } finally { sqlite.close(); }
});

test('real SQL paginates beyond 500 and filters before pagination', async () => {
  const { sqlite, db } = database();
  try {
    assert.equal((await listClients(db,'salon',{limit:50,offset:500,includeMetrics:true})).length,20);
    assert.equal((await listClients(db,'salon',{segment:'vip'}))[0]?.id,'c0000');
    assert.equal((await getClientDirectorySummary(db,'salon',{segment:'vip'})).totalClients,1);
    for (const mode of [{}, {includeMetrics:true}, {includeLoyalty:true}]) {
      assert.deepEqual(await listClients(db,'salon',{segment:'active-packages',lastVisit:'30-days',...mode}),[]);
    }
  } finally { sqlite.close(); }
});
