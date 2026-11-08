'use strict';
const { transition } = require('./state-machine');
function createInMemoryFulfillmentRepository(){const records=new Map();return Object.freeze({
 create(record){if(records.has(record.id)||[...records.values()].some(x=>x.idempotencyKey===record.idempotencyKey))throw new Error('Duplicate fulfillment request.');const saved=Object.freeze({...record});records.set(saved.id,saved);return saved;},
 get(id){return records.get(id)||null;},
 claim(id,actorId,now){const current=records.get(id);if(!current)throw new Error('Fulfillment request not found.');if(current.actorId!==actorId)throw new Error('Fulfillment request actor mismatch.');if(now>=current.expiresAt)throw new Error('Fulfillment request expired.');const next=Object.freeze({...current,state:transition(current.state,'CLAIMED'),claimedAt:now});records.set(id,next);return next;},
 cancel(id,actorId,now){const current=records.get(id);if(!current)throw new Error('Fulfillment request not found.');if(current.actorId!==actorId)throw new Error('Fulfillment request actor mismatch.');if(now>=current.expiresAt)throw new Error('Fulfillment request expired.');const next=Object.freeze({...current,state:transition(current.state,'CANCELED'),completedAt:now});records.set(id,next);return next;},
 updateResults(id,results){const current=records.get(id);if(!current)throw new Error('Fulfillment request not found.');if(current.state!=='EXECUTING')throw new Error('Fulfillment results can only be recorded while executing.');const next=Object.freeze({...current,results:Object.freeze([...results])});records.set(id,next);return next;},
 update(id,nextState,patch={}){const current=records.get(id);if(!current)throw new Error('Fulfillment request not found.');const next=Object.freeze({...current,...patch,state:transition(current.state,nextState)});records.set(id,next);return next;}
});}
module.exports={createInMemoryFulfillmentRepository};
