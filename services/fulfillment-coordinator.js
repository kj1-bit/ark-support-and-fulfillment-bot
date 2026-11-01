const { arkServers } = require('../config/ark-servers');
const {
  buildFulfillmentCommands,
  buildFulfillmentSummary,
  validateEosId
} = require('./aat-command-builder');
const { getCreatureById } = require('./creature-catalog');
const {
  executeRconCommand,
  listPlayers
} = require('./rcon');

const STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED'
});

function getServerById(serverId) {
  return arkServers.find(
    server => server.enabled === true && server.id === serverId
  ) || null;
}

function summarizeStatus(results) {
  const succeeded = results.filter(result => result.success).length;

  if (succeeded === results.length && results.length > 0) {
    return STATUS.SUCCESS;
  }

  if (succeeded > 0) {
    return STATUS.PARTIAL;
  }

  return STATUS.FAILED;
}

async function verifyPlayerOnline(server, eosId, listPlayersFn = listPlayers) {
  validateEosId(eosId);
  const normalizedEosId = eosId.toLowerCase();
  const players = await listPlayersFn(server);
  const player = players.find(
    candidate => candidate.eosId.toLowerCase() === normalizedEosId
  );

  if (!player) {
    throw new Error(
      `Target EOS ID is no longer online on ${server.name}.`
    );
  }

  return player;
}

async function fulfillCreatureRequest(request, dependencies = {}) {
  const executor = dependencies.executeRconCommand || executeRconCommand;
  const listPlayersFn = dependencies.listPlayers || listPlayers;

  if (!request || typeof request !== 'object') {
    throw new Error('Fulfillment request is required.');
  }

  const { requestId, creatureId, serverId, eosId } = request;

  if (!requestId || typeof requestId !== 'string') {
    throw new Error('A request ID is required.');
  }

  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Unknown or disabled ARK server: ${serverId}`);
  }

  const creature = getCreatureById(creatureId);
  if (!creature) {
    throw new Error(`Unknown or disabled creature: ${creatureId}`);
  }

  const player = await verifyPlayerOnline(server, eosId, listPlayersFn);
  const commands = buildFulfillmentCommands(creature, eosId);
  const results = [];

  for (const item of commands) {
    const startedAt = new Date().toISOString();

    try {
      const response = await executor(server, item.command);
      results.push({
        key: item.key,
        label: item.label,
        success: true,
        response: String(response || ''),
        error: null,
        startedAt,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        key: item.key,
        label: item.label,
        success: false,
        response: '',
        error: error?.message || 'Unknown RCON error',
        startedAt,
        completedAt: new Date().toISOString()
      });
    }
  }

  return {
    requestId,
    status: summarizeStatus(results),
    server: {
      id: server.id,
      name: server.name,
      host: server.host,
      port: server.port
    },
    player: {
      characterName: player.characterName,
      eosId: player.eosId
    },
    summary: buildFulfillmentSummary(creature),
    results,
    completedAt: new Date().toISOString()
  };
}

module.exports = {
  STATUS,
  fulfillCreatureRequest,
  getServerById,
  summarizeStatus,
  verifyPlayerOnline
};
