'use strict';
const OPERATIONS = Object.freeze({ LIST_PLAYERS: 'listOnlinePlayers', FULFILL: 'fulfillApprovedCreature' });
function createArkOperationService({ serverRegistry, transport, buildFulfillmentPlan }) {
  if (!serverRegistry || typeof serverRegistry.get !== 'function') throw new TypeError('serverRegistry is required.');
  if (!transport || typeof transport.execute !== 'function') throw new TypeError('transport is required.');
  if (typeof buildFulfillmentPlan !== 'function') throw new TypeError('buildFulfillmentPlan is required.');
  return Object.freeze({
    async listOnlinePlayers(serverId) {
      const server=serverRegistry.get(serverId, OPERATIONS.LIST_PLAYERS);
      return transport.execute(Object.freeze({ type: OPERATIONS.LIST_PLAYERS, server }));
    },
    async fulfillApprovedCreature(input) {
      const server=serverRegistry.get(input.serverId, OPERATIONS.FULFILL);
      const plan=buildFulfillmentPlan(input);
      if (!Array.isArray(plan) || !plan.length || plan.length > 20 || plan.some(x=>typeof x.command!=='string')) throw new TypeError('Invalid internal fulfillment plan.');
      const results=[];
      for (const [index, operation] of plan.entries()) {
        const response = await transport.execute(Object.freeze({ type: OPERATIONS.FULFILL, server, operation }));
        const result = Object.freeze({
          operationIndex: index + 1,
          success: response?.success === true,
        });
        results.push(result);
        if (typeof input.onResult === 'function') await input.onResult(result, results.length);
      }
      return Object.freeze(results);
    }
  });
}
module.exports = { createArkOperationService, OPERATIONS };
