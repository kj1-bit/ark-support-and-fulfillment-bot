# V2 shop runtime integration

Runtime composition constructs a narrow shop search service from the catalog manager and exposes only that service to Discord. The shop feature is registered through the common feature manager. Disabled shop configuration produces no listener or network activity. Each search resolves the current active catalog at request time, so validated catalog activation and rollback take effect without rebuilding the service.
