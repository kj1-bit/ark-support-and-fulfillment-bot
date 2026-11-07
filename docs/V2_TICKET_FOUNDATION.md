# V2 ticket foundation

Tickets use validated types and descriptions, require a verified player name, and persist explicit OPEN, CLAIMED, and CLOSED states. A partial unique index prevents duplicate active tickets for the same player and type. Moderator claim, close, and reopen operations use centralized authorization and auditable state transitions. The ticket feature depends on the player-name feature.
