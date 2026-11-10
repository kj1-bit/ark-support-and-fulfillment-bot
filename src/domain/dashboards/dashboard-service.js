'use strict';
function createDashboardService({events}){if(!events||typeof events.page!=='function')throw new TypeError('events.page is required.');return Object.freeze({tickets:input=>events.page({...input,category:'ticket',types:['ticket.created','ticket.claimed','ticket.unclaimed','ticket.closed']}),pins:input=>events.page({...input,category:'pin'}),fulfillment:input=>events.page({...input,category:'fulfillment'}),catalog:input=>events.page({...input,category:'catalog'}),all:input=>events.page(input)});}
module.exports={createDashboardService};
