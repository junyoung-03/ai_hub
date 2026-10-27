import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noiseDb } from '../scripts/noise-db.mjs';

test('atomic SQL retry preserves provider cooldown, resets exhausted attempts, and refuses a live lease', async () => {
  const db = await noiseDb({ migrated: false });
  const owner = '11111111-1111-4111-8111-111111111111';
  const id = '22222222-2222-4222-8222-222222222222';
  const version = 'synthetic-retry';
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const retry = () => scalar('select public.retry_search_index($1::uuid,$2::uuid,$3)', [owner, id, version]);
  try {
    await db.exec(readFileSync('supabase/migrations/20261027090100_atomic_search_index_retry.sql', 'utf8'));
    await db.query('insert into auth.users(id) values($1)', [owner]);
    await db.query("insert into public.items(id,user_id,title,content_text,source,format) values($1,$2,'Synthetic','Synthetic text','manual','text')", [id, owner]);
    await scalar("select public.search_index('read',$1::uuid,$2::uuid,$3)", [owner, id, version]);
    await db.query("update private.search_index_jobs set state='failed',retry_count=3,retry_after=now()+interval '1 hour' where item_id=$1 and version=$2", [id, version]);
    await db.exec('set role service_role');
    assert.equal((await retry()).state, 'failed');
    await db.exec('reset role');
    assert.equal(await scalar('select retry_count from private.search_index_jobs where item_id=$1 and version=$2', [id, version]), 3);
    await db.query("update private.search_index_jobs set retry_after=now()-interval '1 second' where item_id=$1 and version=$2", [id, version]);
    await db.exec('set role service_role');
    assert.equal((await retry()).state, 'pending');
    await db.exec('reset role');
    assert.equal(await scalar('select retry_count from private.search_index_jobs where item_id=$1 and version=$2', [id, version]), 0);
    await db.query("update private.search_index_jobs set state='running',lease_until=now()+interval '1 minute' where item_id=$1 and version=$2", [id, version]);
    await db.exec('set role service_role');
    await assert.rejects(retry(), error => error.code === '55P03');
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(retry(), error => error.code === '42501');
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
