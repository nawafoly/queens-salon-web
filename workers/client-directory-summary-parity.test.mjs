import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getClientDirectorySummary } from './core/repositories/clients.js';

test('client directory summary preserves legacy SQL results across filters and tenants', async () => {
  const sqlite = new DatabaseSync(':memory:');

  try {
    sqlite.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        salon_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        firebase_uid TEXT,
        phone_normalized TEXT,
        canonical_client_id TEXT,
        vip INTEGER,
        status TEXT,
        created_at TEXT
      );

      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        salon_id TEXT NOT NULL,
        client_id TEXT,
        status TEXT,
        booking_date TEXT,
        deleted_at TEXT
      );

      CREATE TABLE client_packages (
        salon_id TEXT,
        canonical_client_id TEXT,
        status TEXT,
        expires_at TEXT,
        remaining_sessions INTEGER,
        reserved_sessions INTEGER
      );

      CREATE INDEX idx_core_bookings_client
      ON bookings(salon_id, client_id);

      INSERT INTO clients VALUES
        ('c1','main','Alpha',NULL,NULL,'966500000001','k1',1,'active',date('now')),
        ('c2','main','Beta',NULL,NULL,'966500000002','k2',0,'inactive','2020-01-01'),
        ('c3','main','Gamma',NULL,NULL,'966500000003','k3',NULL,NULL,'2020-01-01'),
        ('c4','main','Delta',NULL,NULL,'966500000004','k4',0,'','2020-01-01'),
        ('c5','main','Epsilon',NULL,NULL,'966500000005','k5',1,' ACTIVE ','2020-01-01'),
        ('c6','other','Alpha',NULL,NULL,'966500000006','k6',1,'active',date('now'));

      INSERT INTO bookings VALUES
        ('b1','main','c1','completed',date('now'),NULL),
        ('b2','main','c1','cancelled',date('now'),NULL),
        ('b3','main','c1','completed',date('now'),date('now')),
        ('b4','main','c2','completed',date('now','-60 days'),NULL),
        ('b5','main','c4','pending',date('now'),NULL),
        ('b6','other','c1','completed',date('now'),NULL),
        ('b7','other','c6','completed',date('now'),NULL),
        ('b8','main','missing','completed',date('now'),NULL),
        ('b9','main',NULL,'completed',date('now'),NULL),
        ('b10','main','c3','completed',date('now'),date('now'));

      INSERT INTO client_packages VALUES
        ('main','k1','active',NULL,2,0),
        ('main','k2','active','2020-01-01',2,0),
        ('main','k3','active',NULL,0,0),
        ('other','k5','active',NULL,2,0);
    `);

    let captured;

    const db = {
      __fakeD1: true,
      first(sql, args) {
        captured = { sql, args };
        return sqlite.prepare(sql).get(...args) || null;
      },
    };

    async function compare(salonId, query = {}) {
      const actual = await getClientDirectorySummary(db, salonId, query);

      const marker = 'WHERE c.salon_id = ?';
      const index = captured.sql.lastIndexOf(marker);

      assert.ok(index >= 0);

      const clause = captured.sql.slice(index + marker.length);

      const legacySql = `
        WITH filtered_clients AS (
          SELECT c.id, c.vip, c.status, c.created_at
          FROM clients c
          WHERE c.salon_id = ?${clause}
        ),
        booking_metrics AS (
          SELECT b.client_id, COUNT(*) AS bookings_count
          FROM bookings b
          INNER JOIN filtered_clients fc ON fc.id = b.client_id
          WHERE b.salon_id = ?
            AND b.deleted_at IS NULL
          GROUP BY b.client_id
        )
        SELECT
          COUNT(*) AS total_clients,
          COALESCE(SUM(CASE WHEN COALESCE(fc.vip,0)=1 THEN 1 ELSE 0 END),0) AS vip_clients,
          COALESCE(SUM(CASE WHEN TRIM(LOWER(COALESCE(fc.status,''))) IN ('','active') THEN 1 ELSE 0 END),0) AS active_clients,
          COALESCE(SUM(CASE WHEN date(fc.created_at)>=date('now','start of month') THEN 1 ELSE 0 END),0) AS new_this_month,
          COALESCE(SUM(COALESCE(bm.bookings_count,0)),0) AS total_bookings
        FROM filtered_clients fc
        LEFT JOIN booking_metrics bm ON bm.client_id = fc.id
      `;

      const old = sqlite.prepare(legacySql).get(
        ...captured.args,
        salonId
      );

      const expected = {
        totalClients: old.total_clients,
        totalBookings: old.total_bookings,
        activeClients: old.active_clients,
        newThisMonth: old.new_this_month,
        vipClients: old.vip_clients,
        averageBookings: old.total_clients
          ? old.total_bookings / old.total_clients
          : 0,
      };

      assert.deepEqual(
        actual,
        expected,
        JSON.stringify({ salonId, query })
      );

      return actual;
    }

    assert.deepEqual(await compare('main'), {
      totalClients: 5,
      totalBookings: 4,
      activeClients: 4,
      newThisMonth: 1,
      vipClients: 2,
      averageBookings: 0.8,
    });

    assert.equal((await compare('main', {
      segment: 'vip',
    })).totalClients, 2);

    assert.equal((await compare('main', {
      segment: 'with-bookings',
    })).totalClients, 3);

    assert.equal((await compare('main', {
      segment: 'without-bookings',
    })).totalClients, 2);

    assert.equal((await compare('main', {
      segment: 'active-packages',
    })).totalClients, 1);

    assert.equal((await compare('main', {
      lastVisit: '30-days',
    })).totalClients, 1);

    assert.equal((await compare('main', {
      lastVisit: '90-days',
    })).totalClients, 2);

    assert.equal((await compare('main', {
      lastVisit: 'never',
    })).totalClients, 3);

    assert.equal((await compare('main', {
      search: 'Alpha',
    })).totalBookings, 2);

    assert.equal((await compare('main', {
      search: '0500000001',
    })).totalClients, 1);

    assert.equal((await compare('other')).totalBookings, 1);

    assert.deepEqual(await compare('empty'), {
      totalClients: 0,
      totalBookings: 0,
      activeClients: 0,
      newThisMonth: 0,
      vipClients: 0,
      averageBookings: 0,
    });

    let cases = 0;

    for (const salonId of ['main', 'other', 'empty']) {
      for (const segment of [
        'all',
        'vip',
        'with-bookings',
        'without-bookings',
        'active-packages',
      ]) {
        for (const lastVisit of [
          'all',
          '30-days',
          '90-days',
          'never',
        ]) {
          for (const source of [
            '',
            'combined',
            'client-record',
          ]) {
            for (const search of [
              '',
              'Alpha',
              '0500000001',
              'nonexistent',
            ]) {
              await compare(salonId, {
                segment,
                lastVisit,
                source,
                search,
              });

              cases++;
            }
          }
        }
      }
    }

    assert.equal(cases, 720);

    console.log(`SQL_PARITY_CASES_PASSED: ${cases}`);
  } finally {
    sqlite.close();
  }
});