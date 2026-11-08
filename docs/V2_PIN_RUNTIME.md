# V2 PIN runtime integration

Migration 005 is ordered after tickets. PIN protection uses AES-256-GCM with a fresh 96-bit IV and authentication tag. `PIN_PROTECTION_KEY` must be a non-example base64 value decoding to exactly 32 bytes when the PIN feature is enabled. Tampered protected values fail authentication. Runtime composition exposes only the narrow PIN service and the feature manager enforces the player-name dependency.
