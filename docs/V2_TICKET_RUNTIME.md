# V2 ticket runtime integration

Migration 004 is ordered after player names. Runtime composition constructs the SQLite ticket repository and narrow ticket service, adds centralized ticket-moderation authorization, and exposes tickets without exposing the database. The Discord feature manager registers tickets only when both tickets and the required player-name feature are enabled.

Migration 012 adds channel provisioning/status, source channel, control-message ID, completion timestamp, and a durable number counter. Existing record-only V2 tickets are preserved without retroactively creating channels. Both the standing **Open Request** button and `/ticket create` now reserve a single active request per guild/user before creating a private channel under `discord.channels.ticketCategory`.

The Discord gateway explicitly denies `@everyone`, grants requester/staff/bot access, posts the V1-style opening/DLC notice, and persists the control-message binding. **Ticket Completed** is staff-only and leaves the channel active. **Close Ticket** accepts the requester or staff, denies requester access, renames the archived channel, and retains staff access. Staff reopening restores requester access only if there is no newer active request.

Moderation inside dynamic ticket channels first checks the stored guild/channel/message and then the centralized staff capability; it does not trust a custom ID or category membership alone. Startup reconciles interrupted provisioning and missing controls. Deletion events recreate bound controls or mark a manually deleted channel closed/deleted. Retention deletes an expired archived channel before purging its row; a Discord failure leaves the row available for retry. See [V2 retention](V2_RETENTION.md).
