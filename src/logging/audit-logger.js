'use strict';
const { redact }=require('../security');
function createAuditLogger({sink,clock=Date.now}){if(typeof sink!=='function')throw new TypeError('audit sink is required.');return Object.freeze({write(type,data){if(typeof type!=='string'||!type)throw new TypeError('audit event type is required.');const event=Object.freeze({type,at:new Date(clock()).toISOString(),data:redact(data)});sink(event);return event;}});}
module.exports={createAuditLogger};
