'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');
const schema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'config/schemas/instance.schema.json'), 'utf8'));
const example = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'config/examples/instance.example.json'), 'utf8'));

function resolveReference(root, reference) {
  assert.match(reference, /^#\//, `Only local schema references are supported: ${reference}`);
  return reference.slice(2).split('/').reduce((value, key) => value[key], root);
}

function validateSubset(root, node, value, location = 'configuration') {
  if (node.$ref) return validateSubset(root, resolveReference(root, node.$ref), value, location);
  if (node.anyOf) {
    const matches = node.anyOf.filter(candidate => {
      try { validateSubset(root, candidate, value, location); return true; } catch { return false; }
    });
    assert(matches.length > 0, `${location}: does not match any allowed schema`);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'const')) assert.deepEqual(value, node.const, `${location}: const mismatch`);
  if (node.enum) assert(node.enum.includes(value), `${location}: value is not in enum`);
  if (node.type === 'object') {
    assert(value && typeof value === 'object' && !Array.isArray(value), `${location}: expected object`);
    for (const key of node.required || []) assert(Object.prototype.hasOwnProperty.call(value, key), `${location}.${key}: required`);
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) assert(Object.prototype.hasOwnProperty.call(node.properties || {}, key), `${location}.${key}: unknown property`);
    }
    for (const [key, child] of Object.entries(node.properties || {})) if (Object.prototype.hasOwnProperty.call(value, key)) validateSubset(root, child, value[key], `${location}.${key}`);
  } else if (node.type === 'array') {
    assert(Array.isArray(value), `${location}: expected array`);
    if (node.minItems !== undefined) assert(value.length >= node.minItems, `${location}: too few items`);
    if (node.uniqueItems) assert.equal(new Set(value.map(item => JSON.stringify(item))).size, value.length, `${location}: duplicate items`);
    value.forEach((item, index) => validateSubset(root, node.items, item, `${location}[${index}]`));
  } else if (node.type === 'string') {
    assert.equal(typeof value, 'string', `${location}: expected string`);
    if (node.minLength !== undefined) assert(value.length >= node.minLength, `${location}: string too short`);
    if (node.pattern) assert(new RegExp(node.pattern).test(value), `${location}: pattern mismatch`);
  } else if (node.type === 'integer') {
    assert(Number.isInteger(value), `${location}: expected integer`);
    if (node.minimum !== undefined) assert(value >= node.minimum, `${location}: below minimum`);
    if (node.maximum !== undefined) assert(value <= node.maximum, `${location}: above maximum`);
  } else if (node.type === 'boolean') {
    assert.equal(typeof value, 'boolean', `${location}: expected boolean`);
  } else if (node.type === 'null') {
    assert.equal(value, null, `${location}: expected null`);
  }
}

test('public example conforms to the complete public schema', () => {
  validateSubset(schema, schema, example);
});

test('public schema fully defines each top-level configuration section', () => {
  for (const section of ['runtime', 'discord', 'ark', 'storage', 'features']) {
    const definition = resolveReference(schema, schema.properties[section].$ref);
    assert.equal(definition.type, 'object');
    assert.equal(definition.additionalProperties, false);
    assert(definition.required.length > 0);
    assert(Object.keys(definition.properties).length > 0);
  }
});
