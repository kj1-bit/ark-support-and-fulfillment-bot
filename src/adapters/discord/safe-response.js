'use strict';
function safeInteractionMessage(error){const message=String(error?.message||'');if(/expired|already consumed|mismatched|invalid/i.test(message))return 'This confirmation is no longer valid. Please start again.';if(/authorized|role|guild|channel/i.test(message))return 'You are not authorized to perform this action.';if(/verified player/i.test(message))return 'A verified in-game identity is required before fulfillment.';return 'The request could not be completed safely. A moderator can review the audit log.';}
module.exports={safeInteractionMessage};
