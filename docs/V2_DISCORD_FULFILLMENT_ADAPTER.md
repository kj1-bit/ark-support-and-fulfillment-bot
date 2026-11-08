# V2 Discord fulfillment adapter

The Discord boundary converts interactions into validated actor, guild, channel, message, and role context. Fulfillment confirmation details come only from trusted player and catalog services. Confirmation sessions are opaque and server-side. Moderator logs mask EOS identifiers, scanning delays are displayed, and public errors do not reveal internal database or transport details.

The standing **Dino Fulfillment** panel provides **Browse Dino Catalog** and **Search Dino**. An authorized private wizard pages through catalog results, enabled maps, and trusted online players, then shows **Review Dino Fulfillment** with **Confirm Spawn** (danger) / Cancel. Catalog pages contain 10 creatures; map/player and staff-linking candidate pages contain up to 25 entries, with Previous/Next for larger lists. Each online-player page rescans live state rather than treating a stale list as authoritative.

Wizard steps are actor/guild/channel/message-bound and expire after two minutes; abandoned pre-review selection does not create a fulfillment request. The review issues the existing single-use confirmation token against that exact private message, retaining catalog-version checks and allowlisted execution. Cancellation after review uses the same existing token-bound service. The retired `/dino-fulfillment` and `/player-link` slash commands are no longer handled; the panel wizard and the staff **Link Online Player** button on the IGN panel replace them.

This checkpoint uses mock interactions only and does not log into Discord.
