'use strict';

const { ERROR_CODES, safeError } = require('./safe-error');

const SNOWFLAKE = /^[1-9][0-9]{16,19}$/;

function requireSnowflake(value, field) {
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw safeError(ERROR_CODES.AUTHORIZATION_CONFIG_INVALID, `Authorization configuration is invalid: ${field}.`);
  }
  return value;
}

function createAuthorizationPolicy(options = {}) {
  const guildId = requireSnowflake(options.guildId, 'guildId');
  const capabilities = options.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw safeError(ERROR_CODES.AUTHORIZATION_CONFIG_INVALID, 'Authorization configuration is invalid: capabilities.');
  }
  const normalized = {};
  for (const [name, definition] of Object.entries(capabilities)) {
    if (!definition || typeof definition !== 'object') {
      throw safeError(ERROR_CODES.AUTHORIZATION_CONFIG_INVALID, `Authorization configuration is invalid: ${name}.`);
    }
    const roleIds = (definition.roleIds || []).map((id, index) => requireSnowflake(id, `${name}.roleIds[${index}]`));
    const channelIds = (definition.channelIds || []).map((id, index) => requireSnowflake(id, `${name}.channelIds[${index}]`));
    if (!roleIds.length) throw safeError(ERROR_CODES.AUTHORIZATION_CONFIG_INVALID, `Authorization configuration is invalid: ${name}.roleIds.`);
    normalized[name] = Object.freeze({ roleIds: Object.freeze(roleIds), channelIds: Object.freeze(channelIds) });
  }
  return Object.freeze({ guildId, capabilities: Object.freeze(normalized) });
}

function authorize(policy, capability, context = {}) {
  const definition = policy?.capabilities?.[capability];
  if (!definition) throw safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.');
  if (context.guildId !== policy.guildId) throw safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.');
  if (definition.channelIds.length && !definition.channelIds.includes(context.channelId)) {
    throw safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.');
  }
  const roleIds = Array.isArray(context.roleIds) ? context.roleIds : [];
  if (!definition.roleIds.some(roleId => roleIds.includes(roleId))) {
    throw safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.');
  }
  if (typeof context.actorId !== 'string' || !SNOWFLAKE.test(context.actorId)) {
    throw safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.');
  }
  return Object.freeze({ capability, actorId: context.actorId, guildId: context.guildId, channelId: context.channelId || null, authorizedAt: new Date().toISOString() });
}

module.exports = { authorize, createAuthorizationPolicy, SNOWFLAKE };
