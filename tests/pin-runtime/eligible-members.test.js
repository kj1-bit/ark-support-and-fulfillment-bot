'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibleMemberIds } = require('../../src/features/pins-feature');

test('bulk PIN generation treats member or staff as eligible, deduplicated, and skips bots', async () => {
  const MEMBER = '20000000000000001';
  const STAFF = '20000000000000002';
  const member = (id, roles, bot = false) => [id, { id, user:{ bot }, roles:{ cache:new Set(roles) } }];
  const members = new Map([
    member('30000000000000001', [MEMBER]),
    member('30000000000000002', [STAFF]),
    member('30000000000000003', [MEMBER, STAFF]),
    member('30000000000000004', []),
    member('30000000000000005', [STAFF], true)
  ]);
  const guild = { id:'10000000000000001', members:{ fetch:async () => members } };
  const context = { config:{ discord:{ roles:{ member:MEMBER, staff:STAFF } } } };
  const ids = await eligibleMemberIds(context, { guild }, guild.id);
  assert.deepEqual(ids, ['30000000000000001', '30000000000000002', '30000000000000003']);
  assert.equal(new Set(ids).size, ids.length);
});
