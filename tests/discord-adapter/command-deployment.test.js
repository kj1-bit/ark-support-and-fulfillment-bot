'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RETIRED_COMMAND_NAMES, commandDiff, commands, commandsForFeatures, deploy, mergeCommands
} = require('../../scripts/deploy-v2-commands');

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
  features: { tickets: true, pins: true, playerNames: true, shop: true, fulfillment: true }
};

const retiredNames = ['dino-fulfillment', 'player-link', 'player-name', 'player-name-verify', 'ticket', 'pin', 'shop-search'];
const registered = [
  ...retiredNames.map((name, index) => ({ id: `retired-${index}`, application_id: 'configured-client-id', name, description: 'Old V2 command' })),
  { id: 'unrelated-id', application_id: 'configured-client-id', name: 'legacy', description: 'Unmanaged' }
];

test('every slash command the panels replaced is retired and none are registered', () => {
  assert.deepEqual([...RETIRED_COMMAND_NAMES].sort(), [...retiredNames].sort());
  assert(Object.isFrozen(RETIRED_COMMAND_NAMES));
  assert.deepEqual(commands, []);
  assert.deepEqual(commandsForFeatures(config.features), []);
  assert.deepEqual(mergeCommands(registered, config.features).map(command => command.name), ['legacy']);
  const diff = commandDiff(registered, []);
  assert.deepEqual([...diff.remove].sort(), [...retiredNames].sort());
  assert.equal(diff.preserve, 1);
});

test('command cleanup dry run reports the retired commands for removal and preserves unrelated commands', async () => {
  const { calls, rest } = fakeRest(registered);
  const result = await deploy({
    env: { DISCORD_TOKEN: 'token', CLIENT_ID: 'wrong-client-id' },
    rest,
    config
  });
  assert.equal(result.applied, false);
  assert.deepEqual([...result.diff.remove].sort(), [...retiredNames].sort());
  assert.deepEqual(result.diff.add, []);
  assert.deepEqual(result.diff.update, []);
  assert.equal(result.diff.preserve, 1);
  assert(calls.every(call => call[0] !== 'post' && call[0] !== 'patch' && call[0] !== 'delete'));
  assert(calls.filter(call => call[0] === 'get').every(call => call[1].includes('configured-client-id')));
});

test('command cleanup apply deletes exactly the retired commands and leaves unrelated commands', async () => {
  const { calls, rest } = fakeRest(registered);
  const result = await deploy({ env: { DISCORD_TOKEN: 'token' }, rest, config, apply: true });
  assert.equal(result.applied, true);
  const writes = calls.filter(call => ['post', 'patch', 'delete'].includes(call[0]));
  assert(writes.every(call => call[0] === 'delete'));
  assert.equal(writes.length, 7);
  const deletedIds = writes.map(call => call[1].split('/').pop()).sort();
  assert.deepEqual(deletedIds, retiredNames.map((_, index) => `retired-${index}`).sort());
  assert(!writes.some(call => call[1].endsWith('/unrelated-id')));
});

test('command cleanup is a no-op once the retired commands are gone', async () => {
  const { calls, rest } = fakeRest([registered.at(-1)]);
  const result = await deploy({ env: { DISCORD_TOKEN: 'token' }, rest, config, apply: true });
  assert.deepEqual(result.diff.remove, []);
  assert.equal(result.diff.preserve, 1);
  assert(calls.every(call => !['post', 'patch', 'delete'].includes(call[0])));
});

test('command cleanup aborts if the application command list changes during review', async () => {
  const { calls, rest } = fakeRest(registered, current => [...current, { id: 'new-id', name: 'other', description: 'Concurrent' }]);
  await assert.rejects(() => deploy({ env: { DISCORD_TOKEN: 'token' }, rest, config, apply: true }), /changed during review/);
  assert(calls.every(call => call[0] !== 'post' && call[0] !== 'patch' && call[0] !== 'delete'));
});
