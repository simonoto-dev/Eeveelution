# Device Pairing for The Familiar

## Problem

The Familiar connects to the OpenClaw gateway through a Cloudflare Tunnel. The tunnel works and the connection authenticates, but the pre-generated gateway token only grants `operator.read` scope. Sending messages requires `operator.write`, so chat fails with `missing scope: operator.write`.

There is no way to generate a new token with broader scopes via the current token-based auth. The OpenClaw device pairing mechanism is the supported way to obtain full operator permissions.

## Solution

Replace token-based auth with Ed25519 device pairing in `index.html`. This is the same auth mechanism the Control UI uses.

## Architecture

### What changes

1. **Ed25519 crypto library** (~250 lines) - Signing functions extracted from Control UI. Pure JS, no dependencies.

2. **Device identity management** (~50 lines) - `getOrCreateDeviceIdentity()` generates an Ed25519 keypair on first use and stores it in `localStorage` under `openclaw.device.auth.v1`.

3. **Signed connect request** (~30 lines changed) - `sendConnectRequest()` signs the connection payload with the device's private key and includes the public key. Requests scopes: `operator.admin`, `operator.read`, `operator.write`.

4. **Pairing UI** (~30 lines) - When the gateway responds with "pairing required," display a screen with the CLI command to approve the device.

5. **Device token storage** (~30 lines) - After approval, cache the device token in `localStorage` under `openclaw.device.tokens.v1` for future sessions.

### What stays the same

- Firebase Auth (Google sign-in) as login gate
- Firestore config loading for `wsUrl` and `chatId`
- Cloudflare Tunnel for connectivity
- All chat UI, message handling, voice input, streaming
- Reconnection logic with exponential backoff

### First-use flow

```
User opens app
  -> Google sign-in
  -> Load wsUrl/chatId from Firestore
  -> Generate Ed25519 keypair (stored in localStorage)
  -> Connect to gateway via wss:// tunnel
  -> Gateway responds: "pairing required"
  -> UI shows: "Run this command on your Pi to approve"
  -> User SSHes to Pi, runs: openclaw gateway call device.pair.approve
  -> App retries connection
  -> Gateway issues device token with full operator scopes
  -> Token cached in localStorage
  -> Chat works
```

### Return-visit flow

```
User opens app
  -> Google sign-in
  -> Load config from Firestore
  -> Retrieve stored keypair + device token from localStorage
  -> Connect with signed request + cached token
  -> Gateway validates signature and token
  -> Authenticated with full scopes
  -> Chat works immediately
```

## Data stored in localStorage

| Key | Contents |
|-----|----------|
| `openclaw.device.auth.v1` | `{ version, deviceId, publicKey, privateKey, createdAtMs }` |
| `openclaw.device.tokens.v1` | `{ version, deviceId, tokens: { operator: { token, role, scopes, updatedAtMs } } }` |

## Scopes requested

- `operator.admin` - Full admin access
- `operator.read` - Read messages and state
- `operator.write` - Send messages (the missing scope)

## Rollback

If anything breaks, revert `index.html` to the pre-change version. The gateway token in Firestore still works for read-only connections. A backup should be taken before implementation.

## Files modified

- `index.html` - Only file changed. ~300 lines added, ~10 lines modified.

## Approval commands (run on Pi)

```bash
# List pending pairing requests
openclaw gateway call device.pair.list

# Approve a device
openclaw gateway call device.pair.approve --params '{"requestId":"YOUR_REQUEST_ID"}'
```
