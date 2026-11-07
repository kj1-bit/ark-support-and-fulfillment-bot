'use strict';

const NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function defineFeature(manifest) {
  if (!manifest || !NAME_PATTERN.test(manifest.name || '')) {
    throw new TypeError('Feature name must be a stable lowercase identifier.');
  }

  const dependencies = Object.freeze([...(manifest.dependencies || [])]);
  if (new Set(dependencies).size !== dependencies.length) {
    throw new TypeError(`Feature ${manifest.name} has duplicate dependencies.`);
  }
  if (dependencies.includes(manifest.name)) {
    throw new TypeError(`Feature ${manifest.name} cannot depend on itself.`);
  }

  for (const method of ['initialize', 'register', 'start', 'stop']) {
    if (typeof manifest[method] !== 'function') {
      throw new TypeError(`Feature ${manifest.name} must implement ${method}().`);
    }
  }

  return Object.freeze({
    name: manifest.name,
    dependencies,
    initialize: manifest.initialize,
    register: manifest.register,
    start: manifest.start,
    stop: manifest.stop
  });
}

module.exports = { defineFeature };
