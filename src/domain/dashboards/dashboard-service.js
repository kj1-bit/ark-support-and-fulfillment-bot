'use strict';

function createDashboardService({ events }) {
  if (!events || typeof events.page !== 'function') throw new TypeError('events.page is required.');
  return Object.freeze({
    subscribeTickets:listener => events.subscribe(event => {
      if (event.type.startsWith('ticket.')) listener();
    }),
    tickets:input => events.page({ ...input,category:'ticket',ticketSummary:true }),
    pins:input => events.page({ ...input,category:'pin' }),
    fulfillment:input => events.page({ ...input,category:'fulfillment',fulfillmentSummary:true }),
    catalog:input => events.page({ ...input,category:'catalog' }),
    all:input => events.page(input)
  });
}

module.exports = { createDashboardService };
