# V2 ticket foundation

Tickets use validated types and descriptions, require a verified player name, and expose OPEN, CLAIMED, COMPLETED, and CLOSED lifecycle states. Completion is an independent persisted timestamp, preserving the original base-state schema while leaving completed requests active until closure.

New private-channel requests permit one active ticket per guild/user across all request types, with atomic reservation and a partial unique index. The earlier player/type index remains for legacy record-only tickets. Claim, completion, and reopening require centralized staff authorization; closure requires either the tracked requester or authorized staff. All actions validate the tracked context and audit state transitions. The ticket feature depends on the player-name feature. See [ticket runtime](V2_TICKET_RUNTIME.md) for channel provisioning, archival, recovery, and retention.
