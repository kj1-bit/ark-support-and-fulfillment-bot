'use strict';
const crypto=require('node:crypto');
function createSessionStore({repository,clock=Date.now,uuid=crypto.randomUUID}){
 if(!repository||typeof repository.create!=='function'||typeof repository.consume!=='function')throw new TypeError('session repository create/consume interface is required.');
 return Object.freeze({
  async issue(input){const now=clock();if(!Number.isInteger(input.ttlMs)||input.ttlMs<1)throw new TypeError('Positive session ttlMs is required.');const record=Object.freeze({token:uuid(),feature:input.feature,actorId:input.actorId,guildId:input.guildId,channelId:input.channelId,messageId:input.messageId,action:input.action,requestId:input.requestId,state:'ACTIVE',createdAt:now,expiresAt:now+input.ttlMs,version:1});return repository.create(record);},
  async consume(token,context){return repository.consume(token,context,clock());}
 });
}
module.exports={createSessionStore};
