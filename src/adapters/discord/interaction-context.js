'use strict';
function toInteractionContext(interaction){const actorId=interaction?.user?.id;const guildId=interaction?.guildId;const channelId=interaction?.channelId;const messageId=interaction?.message?.id;if(!actorId||!guildId||!channelId||!messageId)throw new TypeError('Complete Discord interaction context is required.');const roleIds=interaction.member?.roles?.cache?Array.from(interaction.member.roles.cache.keys()):Array.from(interaction.member?.roleIds||[]);return Object.freeze({actorId,guildId,channelId,messageId,roleIds:Object.freeze(roleIds)});}
module.exports={toInteractionContext};
