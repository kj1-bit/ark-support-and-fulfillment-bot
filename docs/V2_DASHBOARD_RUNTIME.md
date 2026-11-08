# V2 operational dashboard runtime integration

Migration 006 creates the operational-event store; migration 009 stores the IDs of persistent Discord log-panel messages. Runtime composition constructs the event repository, event service, narrow dashboard service, and panel-message repository. Supported audit events are sanitized before persistence, and persistence failures emit only a generic external audit notice.

Set `features.dashboards` to `true` to enable the panels. The feature requires the staff role and all three log channels: `ticketLogs`, `pinsDashboard`, and `fulfillmentLogs`. After Discord becomes ready, it edits each saved panel or creates and persists a replacement. A deletion event for an active panel triggers immediate recreation. Restarting the process restores the same saved messages where they still exist.

Ticket, PIN, and fulfillment panels share the same button-driven, authorized, paginated ephemeral view. The persisted event records are authoritative; deleting or recreating a Discord panel does not change them. Disabled dashboards register no listeners and perform no Discord network activity.
