'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../../src/config/validate-config');
const example = require('../../config/examples/instance.example.json');

test('private ticket channels require a category while disabled tickets permit null', () => {
  const config = structuredClone(example);
  config.discord.channels.ticketCategory = null;
  assert.throws(() => validateConfig(config,{ env:{} }),error =>
    error.code === 'CONFIGURATION_INVALID' && error.issues.some(issue => issue.includes('ticketCategory is required')));
  config.features.tickets = false;
  assert.equal(validateConfig(config,{ env:{} }),config);
});

test('shop-only mode requires the requests channel for its standing search panel', () => {
  const config = structuredClone(example);
  config.features.tickets = false;
  config.discord.channels.requests = null;
  assert.throws(() => validateConfig(config,{ env:{} }),error =>
    error.code === 'CONFIGURATION_INVALID' && error.issues.some(issue => issue.includes('features.shop: requests channel is required')));
  config.features.shop = false;
  assert.equal(validateConfig(config,{ env:{} }),config);
});
