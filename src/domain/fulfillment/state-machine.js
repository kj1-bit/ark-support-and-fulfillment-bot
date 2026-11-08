'use strict';
const STATES=Object.freeze({PENDING:'PENDING',CLAIMED:'CLAIMED',EXECUTING:'EXECUTING',SUCCEEDED:'SUCCEEDED',PARTIAL:'PARTIAL',FAILED:'FAILED',UNCERTAIN:'UNCERTAIN',CANCELED:'CANCELED',EXPIRED:'EXPIRED'});
const ALLOWED=Object.freeze({PENDING:new Set(['CLAIMED','CANCELED','EXPIRED']),CLAIMED:new Set(['EXECUTING','FAILED']),EXECUTING:new Set(['SUCCEEDED','PARTIAL','FAILED','UNCERTAIN'])});
function transition(current,next){if(!ALLOWED[current]?.has(next))throw new Error(`Invalid fulfillment transition: ${current} -> ${next}`);return next;}
function terminal(state){return ['SUCCEEDED','PARTIAL','FAILED','UNCERTAIN','CANCELED','EXPIRED'].includes(state);}
module.exports={ALLOWED,STATES,terminal,transition};
