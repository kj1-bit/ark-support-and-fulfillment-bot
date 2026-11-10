'use strict';

const { ButtonStyle, ComponentType, escapeMarkdown } = require('discord.js');

function ticketPlayerName(value) {
  return escapeMarkdown(String(value || 'Player').slice(0, 80).replace(/[\r\n<>@]/g, ' '));
}

function openTicketsPayload(result) {
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const entries = result.results.map((record, index) => {
    const number = (result.page - 1) * result.pageSize + index + 1;
    const claimed = record.state === 'CLAIMED' || (record.state === 'COMPLETED' && Boolean(record.moderatorId));
    const assignment = claimed ? `Claimed - ${record.moderatorId ? `<@${record.moderatorId}>` : 'Unknown staff member'}` : 'Unclaimed';
    const location = !record.channelStatus ? 'Legacy ticket - no channel'
      : ['ACTIVE','ARCHIVED'].includes(record.channelStatus) ? `<#${record.channelId}>` : 'Channel pending';
    return {
      text:`**${number}.** <@${record.actorId}> (${ticketPlayerName(record.playerName)})\n${record.state === 'COMPLETED' ? 'Completed - ' : ''}${assignment}\n${location}`,
      button:{
        type:ComponentType.Button,custom_id:`v2:open-ticket:unclaim:${record.unclaimToken}`,
        label:`Unclaim ${number}`,style:ButtonStyle.Secondary,disabled:!claimed
      }
    };
  });
  return {
    content:null,
    embeds:[{
      title:'Open Tickets',description:entries.length ? entries.map(entry => entry.text).join('\n\n') : 'No open tickets.',
      color:0x5865f2,...(lastPage > 1 ? { footer:{ text:`Page ${result.page} of ${lastPage}` } } : {})
    }],
    components:[
      ...(entries.length ? [{ type:ComponentType.ActionRow,components:entries.map(entry => entry.button) }] : []),
      ...(lastPage > 1 ? [{
        type:ComponentType.ActionRow,components:[
          { type:ComponentType.Button,custom_id:`v2:open-ticket:prev:${Math.max(1,result.page - 1)}`,
            label:'Previous',style:ButtonStyle.Secondary,disabled:result.page <= 1 },
          { type:ComponentType.Button,custom_id:`v2:open-ticket:next:${Math.min(lastPage,result.page + 1)}`,
            label:'Next',style:ButtonStyle.Secondary,disabled:result.page >= lastPage }
        ]
      }] : [])
    ],
    allowedMentions:{ parse:[] }
  };
}

module.exports = { openTicketsPayload, ticketPlayerName };
