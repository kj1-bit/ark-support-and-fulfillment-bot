'use strict';
const plannedFeatureManifests = Object.freeze([
  Object.freeze({ name: 'fulfillment', dependencies: Object.freeze([]) }),
  Object.freeze({ name: 'player-names', dependencies: Object.freeze([]) }),
  Object.freeze({ name: 'tickets', dependencies: Object.freeze(['player-names']) }),
  Object.freeze({ name: 'pins', dependencies: Object.freeze(['player-names']) }),
  Object.freeze({ name: 'shop', dependencies: Object.freeze([]) }),
  Object.freeze({ name: 'dashboards', dependencies: Object.freeze([]) })
]);
module.exports = { plannedFeatureManifests };
