# V2 runtime composition

The V2 composition layer requires frozen validated configuration before database or external adapter construction. Startup checks database integrity, creates the operator-provided pre-migration backup, applies ordered migrations, checks integrity again, and then constructs authorization, interaction, registry, persistence, audit, and allowlisted ARK services.

Discord receives only narrow application services. It does not receive the database, raw transport, secrets, or command builders. Any composition failure closes the database and prevents Discord startup.

This checkpoint keeps the V1 `index.js` entry point unchanged. Activating V2 remains a separate reviewed release decision.
