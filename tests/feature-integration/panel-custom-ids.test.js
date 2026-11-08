'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUniqueCustomIds } = require('../helpers/custom-ids');
const { pagePayload } = require('../../src/features/dashboards-feature');
const { requestPayload, legacyPanelPayload, legacyTicketPayload } = require('../../src/features/tickets-feature');
const { vaultPanelPayload, moderationPayload } = require('../../src/features/pins-feature');
const { ticketControls } = require('../../src/adapters/discord/ticket-channel-gateway');
const { fulfillmentPanelView, playerNamesPanelView } = require('../../src/adapters/discord/fulfillment-view');

test('every standing panel and ticket control message uses unique custom_ids', () => {
  const payloads = {
    'request panel (shop)':requestPayload(true),
    'request panel (no shop)':requestPayload(false),
    'legacy ticket panel':legacyPanelPayload(),
    'legacy ticket controls':legacyTicketPayload({
      id:'TKT-legacy', state:'OPEN', type:'SUPPORT', playerName:'Survivor', description:'Original request'
    }, ['claim','complete','close'].map(action => ({ action, token:`token-${action}` }))),
    'vault panel':vaultPanelPayload(),
    'pin moderation (pending)':moderationPayload({ id:'PIN-1',state:'PENDING' }),
    'pin moderation (delivered)':moderationPayload({ id:'PIN-1',state:'DELIVERED' }),
    'ticket controls (open)':{ components:ticketControls({ id:'TKT-1',state:'OPEN' }) },
    'ticket controls (completed)':{ components:ticketControls({ id:'TKT-1',state:'COMPLETED' }) },
    'ticket controls (closed)':{ components:ticketControls({ id:'TKT-1',state:'CLOSED' }) },
    'fulfillment panel':fulfillmentPanelView(),
    'player names panel':playerNamesPanelView()
  };
  for (const [label,payload] of Object.entries(payloads)) assertUniqueCustomIds(payload,label);
});

test('log panel paging keeps Previous, Refresh, and Next distinct on every page boundary', () => {
  const event = { type:'ticket.created',occurredAt:1000,details:{ id:'TKT-1' } };
  const cases = [
    ['empty log',1,{ results:[],total:0,pageSize:10 }],
    ['single page',1,{ results:[event],total:1,pageSize:10 }],
    ['first page',1,{ results:[event],total:30,pageSize:10 }],
    ['middle page',2,{ results:[event],total:30,pageSize:10 }],
    ['last page',3,{ results:[event],total:30,pageSize:10 }]
  ];
  for (const key of ['tickets','pins','fulfillment']) {
    for (const [label,page,result] of cases) {
      const ids = assertUniqueCustomIds(pagePayload({ key,title:key },page,result,true),`${key} ${label}`);
      assert.deepEqual(ids.slice(0,3).map(id => id.split(':')[3]),['prev','refresh','next']);
      assert.equal(ids[1],`v2:dashboard:${key}:refresh:${page}`);
    }
  }
});
