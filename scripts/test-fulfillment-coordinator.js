require('dotenv').config();

const {
  STATUS,
  fulfillCreatureRequest,
  summarizeStatus
} = require('../services/fulfillment-coordinator');

const EOS_ID = '0123456789abcdef0123456789abcdef';
const baseRequest = {
  requestId: 'TEST-001',
  creatureId: 'tek-rex',
  serverId: 'example-map-1',
  eosId: EOS_ID
};

function onlinePlayers() {
  return Promise.resolve([{
    characterName: 'Test Player',
    eosId: EOS_ID,
    serverId: 'example-map-1',
    serverName: 'Example Map 1',
    host: '127.0.0.1',
    port: 27020
  }]);
}

async function testSuccess() {
  const result = await fulfillCreatureRequest(baseRequest, {
    listPlayers: onlinePlayers,
    executeRconCommand: async (_server, command) =>
      `MOCK OK ${command.includes('-Gender=1') ? 'male' : 'female'}`
  });

  if (result.status !== STATUS.SUCCESS) {
    throw new Error('Expected SUCCESS result.');
  }
  if (result.results.length !== 2 || !result.results.every(item => item.success)) {
    throw new Error('Expected two successful pair commands.');
  }
  return result;
}

async function testPartial() {
  let calls = 0;
  const result = await fulfillCreatureRequest(
    { ...baseRequest, requestId: 'TEST-002' },
    {
      listPlayers: onlinePlayers,
      executeRconCommand: async () => {
        calls += 1;
        if (calls === 2) throw new Error('Simulated female failure');
        return 'MOCK OK male';
      }
    }
  );

  if (result.status !== STATUS.PARTIAL) {
    throw new Error('Expected PARTIAL result.');
  }
  return result;
}

async function testFailed() {
  const result = await fulfillCreatureRequest(
    { ...baseRequest, requestId: 'TEST-003' },
    {
      listPlayers: onlinePlayers,
      executeRconCommand: async () => {
        throw new Error('Simulated RCON failure');
      }
    }
  );

  if (result.status !== STATUS.FAILED) {
    throw new Error('Expected FAILED result.');
  }
  return result;
}

async function testOfflineRejection() {
  let executed = false;

  try {
    await fulfillCreatureRequest(
      { ...baseRequest, requestId: 'TEST-004' },
      {
        listPlayers: async () => [],
        executeRconCommand: async () => {
          executed = true;
          return 'should not run';
        }
      }
    );
    throw new Error('Offline request should have been rejected.');
  } catch (error) {
    if (!/no longer online/i.test(error.message)) throw error;
  }

  if (executed) {
    throw new Error('RCON command ran for an offline player.');
  }
}

async function main() {
  if (summarizeStatus([]) !== STATUS.FAILED) {
    throw new Error('Empty result set should be FAILED.');
  }

  const success = await testSuccess();
  const partial = await testPartial();
  const failed = await testFailed();
  await testOfflineRejection();

  console.table([
    { request: success.requestId, status: success.status, commands: success.results.length },
    { request: partial.requestId, status: partial.status, commands: partial.results.length },
    { request: failed.requestId, status: failed.status, commands: failed.results.length }
  ]);

  console.log('Fulfillment coordinator test passed.');
}

main().catch(error => {
  console.error('Fulfillment coordinator test failed:', error);
  process.exitCode = 1;
});
