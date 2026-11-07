'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize, createAuthorizationPolicy, createInteractionGuard, ERROR_CODES, redact, safeError } = require('../../src/security');
const ids = { guild:'10000000000000001', role:'10000000000000002', channel:'10000000000000003', actor:'10000000000000004', message:'10000000000000005' };

test('missing authorization configuration fails closed', () => {
  assert.throws(() => createAuthorizationPolicy({ guildId: ids.guild }), error => error.code === ERROR_CODES.AUTHORIZATION_CONFIG_INVALID);
  assert.throws(() => createAuthorizationPolicy({ guildId: ids.guild, capabilities: { fulfill: { roleIds: [] } } }), error => error.code === ERROR_CODES.AUTHORIZATION_CONFIG_INVALID);
});

test('authorization rejects wrong guild, channel, role, and malformed actor', () => {
  const policy = createAuthorizationPolicy({ guildId: ids.guild, capabilities: { fulfill: { roleIds:[ids.role], channelIds:[ids.channel] } } });
  const good = { actorId:ids.actor, guildId:ids.guild, channelId:ids.channel, roleIds:[ids.role] };
  assert.equal(authorize(policy, 'fulfill', good).capability, 'fulfill');
  for (const bad of [
    { ...good, guildId:'10000000000000006' },
    { ...good, channelId:'10000000000000006' },
    { ...good, roleIds:[] },
    { ...good, actorId:'bad' }
  ]) assert.throws(() => authorize(policy, 'fulfill', bad), error => error.code === ERROR_CODES.AUTHORIZATION_DENIED);
});

test('interaction guard rejects wrong actor, guild, channel, message, action, expiration, and replay', () => {
  let time = 1000;
  let sequence = 0;
  const binding = { actorId:ids.actor, guildId:ids.guild, channelId:ids.channel, messageId:ids.message, action:'confirm' };
  const guard = createInteractionGuard({ ttlMs:1000, now:() => time, randomUUID:() => `token-${++sequence}` });
  for (const field of Object.keys(binding)) {
    const token = guard.issue(binding);
    assert.throws(() => guard.consume(token, { ...binding, [field]:'wrong' }), error => error.code === ERROR_CODES.INTERACTION_CONTEXT_INVALID);
  }
  const expired = guard.issue(binding); time = 2001;
  assert.throws(() => guard.consume(expired, binding), error => error.code === ERROR_CODES.INTERACTION_EXPIRED);
  time = 1000; const used = guard.issue(binding); guard.consume(used, binding);
  assert.throws(() => guard.consume(used, binding), error => error.code === ERROR_CODES.INTERACTION_REPLAYED);
});

test('redaction removes sensitive keys and masks full EOS identifiers', () => {
  const eos = '0123456789abcdef0123456789abcdef';
  const output = redact({ token:'secret', password:'secret', pin:'1234', eosId:eos, nested:{ message:`player ${eos}`, safe:'ok' } });
  const serialized = JSON.stringify(output);
  assert(!serialized.includes('secret'));
  assert.equal(output.pin, '[REDACTED]');
  assert(!serialized.includes(eos));
  assert.equal(output.nested.safe, 'ok');
});

test('safe errors expose stable categories and public messages', () => {
  const error = safeError(ERROR_CODES.AUTHORIZATION_DENIED, 'This operation is not authorized.', { cause:new Error('sensitive internal detail') });
  assert.equal(error.code, ERROR_CODES.AUTHORIZATION_DENIED);
  assert.equal(error.publicMessage, 'This operation is not authorized.');
  assert(!error.publicMessage.includes('sensitive'));
});
