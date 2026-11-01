require('dotenv').config();

const {
  getEnabledArkServers
} = require('../config/ark-servers');

const {
  isMockMode,
  listPlayersAcrossServers
} = require('../services/rcon');

async function main() {
  const servers = getEnabledArkServers();

  console.log(
    `RCON mode: ${isMockMode() ? 'MOCK' : 'LIVE'}`
  );

  console.log(`Checking ${servers.length} configured servers...`);

  const result = await listPlayersAcrossServers(servers);

  if (!result.players.length) {
    console.log('No online players found.');
  } else {
    console.table(
      result.players.map(player => ({
        Player: player.characterName,
        EOS: player.eosId,
        Map: player.serverName,
        Port: player.port
      }))
    );
  }

  if (result.unavailableServers.length) {
    console.log('Unavailable servers:');
    console.table(result.unavailableServers);
  }
}

main().catch(error => {
  console.error('Online-player test failed:', error);
  process.exitCode = 1;
});