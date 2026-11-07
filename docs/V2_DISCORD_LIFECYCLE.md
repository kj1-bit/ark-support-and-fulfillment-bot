# V2 Discord lifecycle

The V2 Discord adapter registers one fulfillment interaction router only when the fulfillment feature is enabled. It renders confirmation controls using opaque server-side tokens, routes confirmation through trusted services, writes masked moderator logs, returns safe public errors, and supports explicit start and stop lifecycles. Disabled fulfillment performs no registration or network activity.

Tests use a mock client only. No Discord connection is made by this checkpoint.
