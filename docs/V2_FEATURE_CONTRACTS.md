# V2 feature contracts

V2 features use stable manifests with explicit dependencies and initialize, register, start, and stop lifecycles. Enabled features run in dependency order and stop in reverse order. Disabled features receive no lifecycle calls, preventing command, panel, timer, listener, or network activity. Missing dependencies, disabled dependencies, duplicate names, cycles, and incomplete contracts fail closed.

The initial manifests cover fulfillment, player names, tickets, PINs, shop, and dashboards. Only fulfillment has an implementation in this checkpoint; the remaining manifests define migration boundaries for later feature blocks.
