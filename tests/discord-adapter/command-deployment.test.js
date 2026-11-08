'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deploy } = require('../../scripts/deploy-v2-commands');

function fakeRest(initial, afterRead) {
  const calls = [];
  let reads = 0;
  const rest = {
    setToken(token) { calls.push(['token', token]); },
    async get(route) {
      calls.push(['get', route]);
      reads += 1;
      return structuredClone(reads === 1 ? initial : (afterRead ? afterRead(initial) : initial));
    },
    async post(route, options) { calls.push(['post', route, options.body.name]); },
    async patch(route, options) { calls.push(['patch', route, options.body.name]); },
    async delete(route) { calls.push(['delete', route]); }
  };
  return { calls, rest };
}

const config = {
  discord: { clientId: 'configured-client-id' },
  features: { tickets: false, pins: true, playerNames: false, shop: false, fulfillment: false }
};

test('command deployment defaults to a reviewed dry run and uses the validated application ID', async () => {
  const { calls, rest } = fakeRest([{ id: 'legacy-id', name: 'legacy', description: 'Unmanaged' }]);
  const result = await deploy({
    env: { DISCORD_TOKEN: 'token', CLIENT_ID: 'wrong-client-id' },
    rest,
    config
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.diff.add.map(command => command.name), ['pin']);
  assert.deepEqual(result.diff.remove, []);
  assert.deepEqual(result.diff.update, []);
  assert.equal(result.diff.preserve, 1);
  assert.deepEqual(result.diff.add[0].options.map(option => option.name), ['request', 'approve', 'deliver', 'cancel']);
  assert(calls.every(call => call[0] !== 'post' && call[0] !== 'patch' && call[0] !== 'delete'));
  assert(calls.filter(call => call[0] === 'get').every(call => call[1].includes('configured-client-id')));
});

test('command deployment aborts if the application command list changes during review', async () => {
  const initial = [{ id: 'legacy-id', name: 'legacy', description: 'Unmanaged' }];
  const { calls, rest } = fakeRest(initial, current => [...current, { id: 'new-id', name: 'other', description: 'Concurrent' }]);
  await assert.rejects(() => deploy({
    env: { DISCORD_TOKEN: 'token' },
    rest,
    config,
    apply: true
  }), /changed during review/);
  assert(calls.every(call => call[0] !== 'post' && call[0] !== 'patch' && call[0] !== 'delete'));
});

test('command deployment updates only its managed names instead of replacing all global commands', async () => {
  const initial = [{ id: 'legacy-id', name: 'legacy', description: 'Unmanaged' }];
  const { calls, rest } = fakeRest(initial);
  const result = await deploy({
    env: { DISCORD_TOKEN: 'token' },
    rest,
    config,
    apply: true
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls.filter(call => ['post', 'patch', 'delete'].includes(call[0])).map(call => call[0]), ['post']);
  assert.equal(calls.find(call => call[0] === 'post')[2], 'pin');
});
