'use strict';

const { randomInt } = require('node:crypto');

const SNOWFLAKE = /^[1-9][0-9]{16,19}$/;
const SOURCES = Object.freeze({ SELF_SERVICE: 'SELF_SERVICE', STAFF_BULK: 'STAFF_BULK' });
const MAX_GENERATION_ATTEMPTS = 32;

class VaultPinError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.name = 'VaultPinError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function isWeakPin(pin) {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
  return steps.every(step => step === 1) || steps.every(step => step === -1);
}

function generateVaultPin(random = randomInt) {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const value = random(0, 10000);
    if (!Number.isInteger(value) || value < 0 || value > 9999) continue;
    const pin = String(value).padStart(4, '0');
    if (!isWeakPin(pin)) return pin;
  }
  throw new VaultPinError('GENERATION_FAILED', 'A Vault PIN could not be generated. Please try again later.');
}

function createVaultPinService({
  repository,
  playerNames,
  protector,
  authorization,
  audit,
  guildId,
  vaultChannelId,
  dashboardChannelId,
  eligibleRoleIds = [],
  clock = Date.now,
  random = randomInt,
  cooldownMs = 30000,
  maxBulkMembers = 10000
}) {
  if (!repository || typeof repository.get !== 'function' || typeof repository.insertIfAbsent !== 'function'
    || typeof repository.listUserIds !== 'function' || typeof repository.markDelivered !== 'function') {
    throw new TypeError('Vault PIN repository interface is required.');
  }
  if (!playerNames || typeof playerNames.get !== 'function') throw new TypeError('playerNames.get is required.');
  if (!protector || typeof protector.protect !== 'function' || typeof protector.reveal !== 'function') {
    throw new TypeError('PIN protector interface is required.');
  }
  if (!authorization || typeof authorization.authorize !== 'function') throw new TypeError('authorization.authorize is required.');
  if (!audit || typeof audit.write !== 'function') throw new TypeError('audit.write is required.');
  if (typeof guildId !== 'string' || !SNOWFLAKE.test(guildId)) throw new TypeError('A configured guild ID is required.');
  if (typeof vaultChannelId !== 'string' || !SNOWFLAKE.test(vaultChannelId)) throw new TypeError('A configured vault channel ID is required.');
  const eligible = Object.freeze(eligibleRoleIds.filter(Boolean).map(String));
  const lastRequest = new Map();
  const inFlight = new Set();
  let bulkRunning = false;

  function denied() {
    return new VaultPinError('NOT_AUTHORIZED', 'You are not authorized to receive a Vault PIN here.');
  }

  function assertSelfService(context) {
    if (!context || context.guildId !== guildId || context.channelId !== vaultChannelId
      || typeof context.actorId !== 'string' || !SNOWFLAKE.test(context.actorId)) {
      throw denied();
    }
    const roles = Array.isArray(context.roleIds) ? context.roleIds : [];
    if (eligible.length && !eligible.some(roleId => roles.includes(roleId))) throw denied();
  }

  async function isVerified(userId) {
    const player = await playerNames.get(userId);
    return player?.status === 'VERIFIED';
  }

  async function ensure(userId, source) {
    const existing = await repository.get(guildId, userId);
    if (existing) return Object.freeze({ created: false, record: existing });
    let protectedPin;
    try {
      protectedPin = await protector.protect(generateVaultPin(random));
    } catch (error) {
      if (error instanceof VaultPinError) throw error;
      throw new VaultPinError('PROTECTION_FAILED', 'A Vault PIN could not be secured. Please contact staff.');
    }
    const now = clock();
    let result;
    try {
      result = await repository.insertIfAbsent({
        guildId, userId, protectedPin, source, createdAt: now, updatedAt: now
      });
    } catch {
      throw new VaultPinError('PERSISTENCE_FAILED', 'Your Vault PIN could not be saved. Please try again later.');
    }
    if (!result?.record) throw new VaultPinError('PERSISTENCE_FAILED', 'Your Vault PIN could not be saved. Please try again later.');
    if (result.created && source === SOURCES.SELF_SERVICE) audit.write('pin.vault-generated', { guildId, userId, source });
    return result;
  }

  function assertCanGenerate(context) {
    authorization.authorize('pins.moderate', context);
    if (dashboardChannelId && context.channelId !== dashboardChannelId) throw denied();
    return true;
  }

  return Object.freeze({
    assertCanGenerate,

    async deliverOwn(input) {
      const context = input?.context;
      assertSelfService(context);
      if (typeof input.deliver !== 'function') throw new TypeError('A private PIN delivery function is required.');
      const key = context.actorId;
      if (inFlight.has(key)) {
        throw new VaultPinError('IN_PROGRESS', 'Your Vault PIN is already being sent. Please check your direct messages.');
      }
      const now = clock();
      const previous = lastRequest.get(key);
      if (previous !== undefined && now - previous < cooldownMs) {
        throw new VaultPinError('COOLDOWN', 'Please wait a moment before requesting your Vault PIN again.');
      }
      inFlight.add(key);
      try {
        if (!(await isVerified(key))) {
          throw new VaultPinError('NAME_NOT_VERIFIED', 'A verified player name is required before you can receive a Vault PIN. Submit your player name and wait for staff verification.');
        }
        const { created, record } = await ensure(key, SOURCES.SELF_SERVICE);
        let pin;
        try {
          pin = await protector.reveal(record.protectedPin);
        } catch {
          pin = null;
        }
        if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
          throw new VaultPinError('UNREADABLE', 'Your Vault PIN could not be read. Please contact staff.');
        }
        let delivered;
        try {
          delivered = await input.deliver(pin);
        } catch {
          delivered = false;
        }
        if (delivered !== true) {
          audit.write('pin.vault-delivery-failed', { guildId, userId: key });
          throw new VaultPinError('DM_FAILED', 'I could not send you a direct message. Enable direct messages from server members, then try again.');
        }
        lastRequest.set(key, clock());
        audit.write('pin.vault-delivered', { guildId, userId: key });
        let metadataRecorded;
        try {
          metadataRecorded = (await repository.markDelivered(guildId, key, clock())) === true;
        } catch {
          metadataRecorded = false;
        }
        if (!metadataRecorded) {
          audit.write('pin.vault-delivery-metadata-failed', {
            guildId, userId: key, reason: 'Delivery timestamp could not be recorded after the DM was sent.'
          });
        }
        return Object.freeze({ created, delivered: true, metadataRecorded });
      } finally {
        inFlight.delete(key);
      }
    },

    async generateMissing(input) {
      const context = input?.context;
      assertCanGenerate(context);
      const memberIds = Array.isArray(input.memberIds) ? input.memberIds : null;
      if (!memberIds) throw new TypeError('memberIds are required.');
      const unique = [...new Set(memberIds.map(String))].filter(id => SNOWFLAKE.test(id));
      if (unique.length > maxBulkMembers) {
        throw new VaultPinError('TOO_MANY_MEMBERS', `Too many eligible members (${unique.length}); the limit is ${maxBulkMembers}.`);
      }
      if (bulkRunning) throw new VaultPinError('IN_PROGRESS', 'Vault PIN generation is already running.');
      bulkRunning = true;
      try {
        const existing = new Set(await repository.listUserIds(guildId));
        let created = 0;
        let failed = 0;
        let alreadyPresent = 0;
        let unverified = 0;
        for (const userId of unique) {
          if (existing.has(userId)) {
            alreadyPresent += 1;
            continue;
          }
          try {
            if (!(await isVerified(userId))) {
              unverified += 1;
              continue;
            }
            const result = await ensure(userId, SOURCES.STAFF_BULK);
            if (result.created) created += 1;
            else alreadyPresent += 1;
          } catch {
            failed += 1;
          }
        }
        const summary = Object.freeze({
          eligible: unique.length,
          created,
          existing: alreadyPresent,
          unverified,
          failed
        });
        audit.write('pin.vault-bulk-generated', { guildId, moderatorId: context.actorId, ...summary });
        return summary;
      } finally {
        bulkRunning = false;
      }
    }
  });
}

module.exports = { SOURCES, VaultPinError, createVaultPinService, generateVaultPin, isWeakPin };