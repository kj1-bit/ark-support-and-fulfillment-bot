# V2 operational dashboard runtime integration

Migration 006 is ordered after PIN persistence. Runtime composition constructs the operational-event repository, event service, and narrow dashboard service. Supported audit events are sanitized again before asynchronous persistence. Persistence failures emit only a generic external audit notice. Dashboard queries require centralized staff authorization, and Discord receives only the narrow query service. Disabled dashboards register no listener or network activity.
