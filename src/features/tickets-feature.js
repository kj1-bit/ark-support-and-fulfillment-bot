'use strict';
const {defineFeature}=require('./feature-contract');
const {toInteractionContext}=require('../adapters/discord/interaction-context');
function createTicketsFeature(){let listener;return defineFeature({name:'tickets',dependencies:['player-names'],async initialize(context){if(!context.services?.tickets)throw new TypeError('tickets service is required.');},async register(context){listener=async interaction=>{if(!String(interaction.type||'').startsWith('ticket.'))return;const action=interaction.type.slice(7);const input={...interaction.input,context:toInteractionContext(interaction)};if(typeof context.services.tickets[action]!=='function')return;return interaction.reply(await context.services.tickets[action](input));};context.client.on('interactionCreate',listener);},async start(){},async stop(context){if(listener&&typeof context.client.off==='function')context.client.off('interactionCreate',listener);listener=null;}});}
module.exports={createTicketsFeature};
