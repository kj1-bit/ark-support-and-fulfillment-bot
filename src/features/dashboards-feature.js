'use strict';
const {defineFeature}=require('./feature-contract');
const {toInteractionContext}=require('../adapters/discord/interaction-context');
const {registerInteractionListener}=require('../adapters/discord/interaction-listener');
function createDashboardsFeature(){let listener;return defineFeature({name:'dashboards',dependencies:[],async initialize(context){if(!context.services?.dashboards)throw new TypeError('dashboards service is required.');},async register(context){listener=registerInteractionListener(context,'dashboards',async interaction=>{if(!String(interaction.type||'').startsWith('dashboard.'))return;const view=interaction.type.slice(10);if(typeof context.services.dashboards[view]!=='function')return;return interaction.reply(await context.services.dashboards[view]({...interaction.input,context:toInteractionContext(interaction)}));});},async start(){},async stop(context){if(listener&&typeof context.client.off==='function')context.client.off('interactionCreate',listener);listener=null;}});}
module.exports={createDashboardsFeature};
