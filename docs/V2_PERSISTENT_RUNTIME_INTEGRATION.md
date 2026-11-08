# V2 persistent runtime integration

Runtime composition now constructs authoritative SQLite-backed interaction sessions, reloads verified players, restores the active catalog after restart, initializes the first active catalog when needed, and exposes only narrow trusted services to Discord. Fulfillment awaits single-use session consumption before claiming a request. V1 startup remains unchanged.
