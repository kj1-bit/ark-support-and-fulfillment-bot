'use strict';

function safeInteractionMessage(error) {
  const message = String(error?.message || '');
  if (error?.code === 'TICKET_ALREADY_OPEN') {
    const channel = /^[1-9][0-9]{16,19}$/.test(error.ticketChannelId || '')
      ? ` <#${error.ticketChannelId}>` : ' creation is in progress.';
    return `You already have an open request:${channel}`;
  }
  if (/PIN must contain exactly four digits/i.test(message)) return 'PIN must contain exactly four digits.';
  if (/player name contains unsupported characters or length/i.test(message)) return 'Player name contains unsupported characters or length.';
  if (/ticket description is invalid/i.test(message)) return 'Ticket description is invalid.';
  if (/^A verified player name is required/.test(message)) {
    return 'Set your in-game name and ask staff to verify it before opening a request or receiving a Vault PIN.';
  }
  if (/expired|already consumed|mismatched|invalid/i.test(message)) return 'This confirmation is no longer valid. Please start again.';
  if (/authorized|role|guild|channel/i.test(message)) return 'You are not authorized to perform this action.';
  if (/verified player/i.test(message)) return 'A verified in-game identity is required before fulfillment.';
  return 'The request could not be completed safely. A moderator can review the audit log.';
}

module.exports = { safeInteractionMessage };
