'use strict';

function createFeatureManager({ features, enabled, context }) {
  if (!Array.isArray(features)) throw new TypeError('features must be an array.');
  const byName = new Map();
  for (const feature of features) {
    if (byName.has(feature.name)) throw new TypeError(`Duplicate feature: ${feature.name}`);
    byName.set(feature.name, feature);
  }

  const activeNames = new Set(
    [...byName.keys()].filter(name => enabled?.[name] === true)
  );
  for (const name of activeNames) {
    for (const dependency of byName.get(name).dependencies) {
      if (!byName.has(dependency)) throw new Error(`Feature ${name} has missing dependency ${dependency}.`);
      if (!activeNames.has(dependency)) throw new Error(`Feature ${name} requires enabled dependency ${dependency}.`);
    }
  }

  const order = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Feature dependency cycle detected at ${name}.`);
    visiting.add(name);
    for (const dependency of byName.get(name).dependencies) visit(dependency);
    visiting.delete(name);
    visited.add(name);
    order.push(byName.get(name));
  }
  for (const name of activeNames) visit(name);

  const initialized = [];
  const started = [];
  let registered = false;
  return Object.freeze({
    names: Object.freeze(order.map(feature => feature.name)),
    async initialize() {
      try {
        for (const feature of order) {
          await feature.initialize(context);
          initialized.push(feature);
        }
      } catch (error) {
        for (const feature of initialized.reverse()) await feature.stop(context).catch(() => {});
        throw error;
      }
    },
    async register() {
      for (const feature of order) await feature.register(context);
      registered = true;
    },
    async start() {
      if (!registered) throw new Error('Features must be registered before start.');
      try {
        for (const feature of order) {
          await feature.start(context);
          started.push(feature);
        }
      } catch (error) {
        for (const feature of started.reverse()) await feature.stop(context).catch(() => {});
        throw error;
      }
    },
    async stop() {
      const targets = started.length ? [...started] : [...initialized];
      for (const feature of targets.reverse()) await feature.stop(context);
      started.length = 0;
      initialized.length = 0;
      registered = false;
    }
  });
}

module.exports = { createFeatureManager };
