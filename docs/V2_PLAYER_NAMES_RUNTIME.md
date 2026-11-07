# V2 player-name runtime integration

Migration 003 is now ordered after the trusted-state migrations. Runtime composition constructs the SQLite player-name repository and audited service, and moderator verification passes through centralized authorization. The Discord adapter maps the public `playerNames` flag to the stable `player-names` feature identifier and exposes only the narrow player-name service.
