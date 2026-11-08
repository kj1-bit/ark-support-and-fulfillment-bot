'use strict';

const { OPERATIONS } = require('./operation-service');

const EOS_ID = /^[a-f0-9]{32}$/i;
const MAX_RESPONSE_LENGTH = 65536;
const FAILED_RESPONSE = /\b(?:error|failed|failure|invalid|not found|not allowed|unknown command)\b/i;
const MOCK_PLAYER = Object.freeze({
  displayName: 'Mock Test Player',
  eosId: '0123456789abcdef0123456789abcdef'
});

function parseOnlinePlayers(response) {
  const text = String(response || '').trim();
  if (!text || /^(?:no players connected|0 players connected)\.?$/i.test(text)) return [];
  if (text.length > MAX_RESPONSE_LENGTH) throw new Error('RCON player response exceeded the size limit.');

  const players = text.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*\d+\.\s*(.+?),\s*([a-f0-9]{32})\s*$/i);
    if (!match || !EOS_ID.test(match[2])) return null;
    return Object.freeze({ displayName: match[1].trim().slice(0, 64), eosId: match[2].toLowerCase() });
  }).filter(player => player && player.displayName);

  if (players.length === 0) throw new Error('RCON player response could not be parsed.');
  return Object.freeze(players);
}

function createRconTransport({ mode, env = process.env, timeoutMs = 10000, RconClass } = {}) {
  if (!['mock', 'test', 'production'].includes(mode)) throw new TypeError('A validated runtime mode is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw new TypeError('RCON timeout must be between 1000 and 60000 milliseconds.');
  }
  const Rcon = mode === 'mock' ? null : RconClass || require('rcon');

  return Object.freeze({
    async execute({ type, server, operation }) {
      if (!server || typeof server.id !== 'string') throw new TypeError('A registered server is required.');
      if (mode === 'mock') {
        if (type === OPERATIONS.LIST_PLAYERS) {
          return Object.freeze([Object.freeze({ ...MOCK_PLAYER })]);
        }
        if (type === OPERATIONS.FULFILL) return Object.freeze({ success: true });
        throw new Error('Unsupported RCON operation.');
      }

      if (type !== OPERATIONS.LIST_PLAYERS && type !== OPERATIONS.FULFILL) {
        throw new Error('Unsupported RCON operation.');
      }
      if (type === OPERATIONS.FULFILL && typeof operation?.command !== 'string') {
        throw new TypeError('A validated fulfillment operation is required.');
      }
      const password = env[server.passwordSecret];
      if (typeof password !== 'string' || !password) throw new Error('Configured RCON secret is unavailable.');

      const response = await executeCommand({
        Rcon,
        server,
        password,
        command: type === OPERATIONS.LIST_PLAYERS ? 'ListPlayers' : operation.command,
        timeoutMs
      });
      if (type === OPERATIONS.LIST_PLAYERS) return parseOnlinePlayers(response);
      return Object.freeze({ success: !FAILED_RESPONSE.test(response) });
    }
  });
}

function executeCommand({ Rcon, server, password, command, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let client;
    let settled = false;
    let authenticated = false;
    const timeout = setTimeout(() => finish(new Error('RCON request timed out.')), timeoutMs);

    function finish(error, response) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        client?.disconnect();
      } catch {
        // Disconnect errors do not change the completed operation result.
      }
      if (error) reject(error);
      else resolve(response);
    }

    try {
      client = new Rcon(server.host, server.port, password, { tcp: true, challenge: false });
      client.once('auth', () => {
        if (authenticated) return;
        authenticated = true;
        try {
          client.send(command);
        } catch {
          finish(new Error('RCON request failed.'));
        }
      });
      client.once('response', response => {
        const text = String(response || '');
        if (text.length > MAX_RESPONSE_LENGTH) {
          finish(new Error('RCON response exceeded the size limit.'));
          return;
        }
        finish(null, text);
      });
      // Keep a permanent error listener: the library can emit further errors after the request settles.
      client.on('error', () => finish(new Error(`RCON request failed for server ${server.id}.`)));
      client.once('end', () => finish(new Error(`RCON connection closed for server ${server.id}.`)));
      client.connect();
    } catch {
      finish(new Error(`RCON request failed for server ${server.id}.`));
    }
  });
}

module.exports = { createRconTransport, parseOnlinePlayers };
