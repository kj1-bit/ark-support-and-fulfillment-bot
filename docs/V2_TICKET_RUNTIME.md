# V2 ticket runtime integration

Migration 004 is ordered after player names. Runtime composition constructs the SQLite ticket repository and narrow ticket service, adds centralized ticket-moderation authorization, and exposes tickets without exposing the database. The Discord feature manager registers tickets only when both tickets and the required player-name feature are enabled.
