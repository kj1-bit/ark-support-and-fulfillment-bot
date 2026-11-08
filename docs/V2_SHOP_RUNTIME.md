# V2 shop runtime integration

Runtime composition constructs a narrow shop search service from the catalog manager and exposes only that service to Discord. The shop feature is registered through the common feature manager. Disabled shop configuration produces no listener or network activity. Each search resolves the current active catalog at request time, so validated catalog activation and rollback take effect without rebuilding the service.

The V1-style **Search In-Game Shop** button in `discord.channels.requests` opens a modal with "Tame or package name" and private paged results, retaining catalog DLC warnings. Search-only configurations restore this panel without **Open Request** when tickets are disabled; when tickets are enabled, the ticket feature owns the combined panel. Modal/paging actions retain actor/guild/channel/private-message bindings and expire when abandoned. `/shop-search` remains available. These are V2 catalog results, not a new live F1-shop data source.
