# V2 persistent dashboard and operational-event foundation

Operational events use an explicit allowlist, bounded structured details, and pre-persistence redaction. Sensitive keys including PIN data, protected material, secrets, tokens, passwords, EOS identifiers, commands, blueprints, stack traces, and raw errors are discarded before repository insertion. SQLite storage is bounded and indexed for deterministic reverse-chronological pagination. Narrow dashboard services expose ticket, PIN, fulfillment, catalog, and combined views without exposing the database.
