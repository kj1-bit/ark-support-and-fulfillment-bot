const Rcon = require('rcon');

const DEFAULT_TIMEOUT_MS = 10000;

function isMockMode() {
  return String(process.env.ARK_RCON_MOCK).toLowerCase() === 'true';
}

function parseListPlayers(response, server) {
  const text = String(response || '').trim();

  if (!text || /no players connected/i.test(text)) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(
        /^\s*(\d+)\.\s*(.+?),\s*([a-f0-9]{32})\s*$/i
      );

      if (!match) {
        return null;
      }

      return {
        index: Number.parseInt(match[1], 10),
        characterName: match[2].trim(),
        eosId: match[3].toLowerCase(),
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        port: server.port
      };
    })
    .filter(Boolean);
}

function mockPlayersForServer(server) {
  const mockPlayers = {
    'example-map-1': [
      {
        characterName: 'Mock Player One',
        eosId: '11111111111111111111111111111111'
      }
    ],
    'example-map-2': [
      {
        characterName: 'Mock Player Two',
        eosId: '22222222222222222222222222222222'
      }
    ],
    'example-test-server': [
      {
        characterName: 'Mock Test Player',
        eosId: '0123456789abcdef0123456789abcdef'
      }
    ]
  };

  return (mockPlayers[server.id] || []).map((player, index) => ({
    index,
    characterName: player.characterName,
    eosId: player.eosId,
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    port: server.port
  }));
}

function executeRconCommand(
  server,
  command,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  if (isMockMode()) {
    if (command.toLowerCase() === 'listplayers') {
      const players = mockPlayersForServer(server);

      if (!players.length) {
        return Promise.resolve('No Players Connected');
      }

      return Promise.resolve(
        players
          .map(
            player =>
              `${player.index}. ${player.characterName}, ${player.eosId}`
          )
          .join('\n')
      );
    }

    return Promise.resolve(
      `MOCK SUCCESS: ${server.name} accepted the command.`
    );
  }

  const password = process.env[server.passwordEnv];

  if (!password) {
    return Promise.reject(
      new Error(
        `Missing RCON password environment variable: ${server.passwordEnv}`
      )
    );
  }

  return new Promise((resolve, reject) => {
    const client = new Rcon(
      server.host,
      server.port,
      password,
      {
        tcp: true,
        challenge: false
      }
    );

    let settled = false;

    const finish = (error, response) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      try {
        client.disconnect();
      } catch {}

      if (error) {
        reject(error);
      } else {
        resolve(String(response || ''));
      }
    };

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `RCON command timed out for ${server.name} ` +
          `after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);

    client.on('auth', () => {
      client.send(command);
    });

    client.on('response', response => {
      finish(null, response);
    });

    client.on('error', error => {
      finish(
        new Error(
          `RCON error for ${server.name}: ${error.message}`
        )
      );
    });

    client.connect();
  });
}

async function listPlayers(server) {
  if (isMockMode()) {
    return mockPlayersForServer(server);
  }

  const response = await executeRconCommand(
    server,
    'ListPlayers'
  );

  return parseListPlayers(response, server);
}

async function listPlayersAcrossServers(servers) {
  const results = await Promise.allSettled(
    servers.map(async server => ({
      server,
      players: await listPlayers(server)
    }))
  );

  const players = [];
  const unavailableServers = [];

  results.forEach((result, index) => {
    const server = servers[index];

    if (result.status === 'fulfilled') {
      players.push(...result.value.players);
    } else {
      unavailableServers.push({
        serverId: server.id,
        serverName: server.name,
        error: result.reason?.message || 'Unknown RCON error'
      });
    }
  });

  return {
    players,
    unavailableServers
  };
}

module.exports = {
  executeRconCommand,
  isMockMode,
  listPlayers,
  listPlayersAcrossServers,
  parseListPlayers
};
