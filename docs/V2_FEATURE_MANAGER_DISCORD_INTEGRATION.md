# V2 feature-manager Discord integration

The Discord adapter now delegates fulfillment registration and cleanup to the common feature manager. Enabled features initialize, register, start, and stop through one lifecycle. Disabled features do not register listeners, log in, or destroy a client that was never started. Startup failure removes previously registered listeners before the error is returned.

This checkpoint uses mock clients only and does not connect to Discord.
