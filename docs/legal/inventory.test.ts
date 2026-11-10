import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SYNC_TABLES } from '../../packages/domain/src/sync';
import { readSchema } from './schema';

const notice = 'DRAFT — not legal advice — for review by a Ghanaian data-protection lawyer';
test('inventory covers every migrated laptop/cloud column and sync field, with purpose, location and access', async () => {
  const inventory = JSON.parse(await readFile(new URL('./data-inventory.json', import.meta.url), 'utf8'));
  assert.equal(inventory.notice, notice);
  const schema = await readSchema();
  const expected = schema.flatMap((table) => table.columns.map((column) => `${table.source}.${table.table}.${column}`)).sort();
  assert.deepEqual(inventory.fields.map((field: any) => field.key).sort(), expected, 'A table/column changed: classify it in the inventory before updating the snapshot');
  assert.equal(new Set(inventory.fields.map((field: any) => field.key)).size, inventory.fields.length);
  for (const field of inventory.fields) {
    assert.ok(field.purpose?.length > 15, `${field.key}: purpose`);
    assert.ok(field.locations?.length > 0, `${field.key}: locations`);
    assert.ok(field.access?.length > 0, `${field.key}: access`);
    assert.ok(field.assessment?.length > 10, `${field.key}: personal-data assessment`);
  }
  for (const [name, spec] of Object.entries(SYNC_TABLES)) for (const column of Object.keys(spec.cols)) {
    for (const source of ['laptop', 'cloud']) assert.ok(expected.includes(`${source}.${name}.${column}`), `${source}.${name}.${column}: sync/schema mismatch`);
  }
  const retention = await readFile(new URL('./retention-deletion.md', import.meta.url), 'utf8');
  for (const table of schema) assert.ok(retention.includes(`\`${table.source}.${table.table}\``), `${table.source}.${table.table}: missing retention proposal`);
  const inventoryMarkdown = await readFile(new URL('./data-inventory.md', import.meta.url), 'utf8');
  for (const key of expected) assert.ok(inventoryMarkdown.includes(`\`${key}\``), `${key}: missing human-readable inventory field`);
});
