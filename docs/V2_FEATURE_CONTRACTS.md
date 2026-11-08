# V2 feature contracts

V2 features use stable manifests with explicit dependencies and initialize, register, start, and stop lifecycles. Enabled features run in dependency order and stop in reverse order. Disabled features receive no lifecycle calls, preventing command, panel, timer, listener, or network activity. Missing dependencies, disabled dependencies, duplicate names, cycles, and incomplete contracts fail closed.

The runtime implements fulfillment, player names, tickets, PINs, shop search, and operational dashboards. Fulfillment confirmation/cancellation uses single-use message-bound sessions; PIN delivery sends the approved PIN privately to its request owner; dashboard panels are persisted and restored after restart or message deletion. Disabled features receive no listeners, panels, or network activity.
