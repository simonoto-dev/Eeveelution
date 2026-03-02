# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Eeveelution** is a JRPG-styled PWA chat interface for talking to an OpenClaw AI running on a Raspberry Pi. It is a single-file web app (`index.html`) with no build step, no bundler, and no npm dependencies.

## Tech Stack

- **Vanilla JS** in a single `index.html` (all HTML, CSS, and JS in one file)
- **Firebase Hosting** for deployment, **Firebase Auth** (Google sign-in via popup) for login, **Firestore** for per-user config storage, **Firebase Storage** for image uploads
- **WebSocket** connection to an OpenClaw gateway (running on a Pi, exposed via Cloudflare Tunnel)
- **Web Crypto API** (Ed25519) for device pairing authentication
- **Web Speech API** for voice input
- Firebase JS SDK loaded from CDN (`https://www.gstatic.com/firebasejs/10.8.0/`)

## Infrastructure

### URLs & Endpoints

| What | URL |
|------|-----|
| Live site | `https://eeveelution.professoroffunk.com` |
| Firebase Hosting | `https://eeveelution-3a390.web.app` |
| Gateway WebSocket (via tunnel) | `wss://eevee.professoroffunk.com/ws` |
| Gateway dashboard (LAN only) | `http://192.168.4.28:18789/` |
| Orchestrator API (via tunnel) | `https://bones.professoroffunk.com` |
| Firebase console | `https://console.firebase.google.com/project/eeveelution-3a390` |

### Firestore Config

Collection `config/{userId}` — three required fields:

| Field | Value | Notes |
|-------|-------|-------|
| `wsUrl` | `wss://eevee.professoroffunk.com/ws` | Cloudflare Tunnel to Mac Mini gateway |
| `gatewayToken` | `34509AB6C0F94FC19A346231878DF131` | Must match `gateway.auth.token` in Mac Mini's `~/.openclaw/openclaw.json` |
| `chatId` | `8231604636` | Telegram chat ID |

**If the gateway token is missing or wrong, the app will fail with "gateway token missing" or "device identity mismatch".** Update via Firebase console.

### Mac Mini (gateway + orchestrator)

- IP: `192.168.4.28`, user: `SimonsMac`
- SSH: `/c/Windows/System32/OpenSSH/ssh.exe SimonsMac@192.168.4.28` (MUST use Windows OpenSSH, not Git's)
- Shell: **fish** — wrap commands in `bash -c '...'` over SSH
- Gateway config: `~/.openclaw/openclaw.json`
- Gateway logs: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- Cloudflare Tunnel config: `~/.cloudflared/config.yml` (routes `eevee.professoroffunk.com` → `localhost:18789`, `bones.professoroffunk.com` → `localhost:7070`)
- Orchestrator: Team Simonoto on port 7070, accessed via Ops tab

## Architecture

### Single-File Structure

Everything lives in `index.html`. The `<script type="module">` section is organized into labeled sections:

1. **FIREBASE & AUTH** - Firebase init, Google sign-in (popup), Firestore config loading, Storage init
2. **DEVICE IDENTITY** - Ed25519 keypair generation, device token storage in localStorage
3. **STATE** - WebSocket handle, reconnect counter, message array
4. **WEBSOCKET** - `connect()`, challenge-response auth flow, `sendConnectRequest()`, reconnection with exponential backoff
5. **MESSAGE HANDLING** - Streaming message rendering, `handleMessage()`, `sendMessage()` via `chat.send` RPC
6. **UTILITIES** - `escapeHtml()`, `formatTime()`
7. **EVENT LISTENERS** - Send button, Enter key, voice input, image input
8. **AUTH UI** - Login/signout button handlers, theme switching
9. **TABS** - Bottom nav tab switching, `OPS_API` constant, `opsApi()` fetch helper, `loadOps()`, render functions for status/proposals/brief/deadlines
10. **PAIRING UI** - Device pairing screen show/retry logic
11. **INIT** - `onAuthStateChanged` watcher that orchestrates the startup flow

### Authentication Flow (two layers)

1. **Firebase Auth** (Google sign-in popup) gates access to the app UI
2. **Device Pairing** (Ed25519 signed WebSocket connect) authenticates with the OpenClaw gateway

### Connect Signature — CRITICAL

The signature and `auth.token` MUST use the **same token value**. The signed payload format is:

```
version|deviceId|webchat|ui|role|scopes|signedAtMs|TOKEN[|nonce]
```

- If a **stored device token** exists → use it in both signature and `auth.token`
- If no device token → use **`CONFIG.gatewayToken`** in both signature and `auth.token`
- **NEVER** put a different token in the signature vs `auth.token` — the gateway rejects with "device identity mismatch"
- **NEVER** use `signInWithRedirect` — it breaks on this app. Use `signInWithPopup` (the COOP console warning is harmless)

### First-Use Device Pairing Flow

1. User opens app → Google sign-in popup
2. App loads `wsUrl`, `gatewayToken`, `chatId` from Firestore
3. App generates Ed25519 keypair (stored in localStorage)
4. Connects to gateway, signs with gateway token
5. Gateway creates **pending pairing request**
6. App shows pairing screen with CLI instructions
7. On Pi: `openclaw devices approve --latest`
8. User clicks "Retry Connection" → gateway issues device token
9. Device token cached in localStorage for future sessions

### Return Visit Flow

1. Google sign-in → load config → retrieve stored keypair + device token
2. Connect with signed request using cached device token
3. Authenticated immediately, no pairing needed

### Image Uploads

Images are uploaded to Firebase Storage under `chat-images/{userId}/{timestamp}-{filename}`. Security rules enforce auth, ownership, 5 MB limit, and image content type. The download URL is displayed locally and sent to the gateway as `[image] {url}` via `chat.send`.

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `openclaw.device.auth.v1` | Ed25519 keypair + deviceId |
| `openclaw.device.tokens.v1` | Cached device tokens by role |

### WebSocket Protocol

Uses OpenClaw gateway protocol v3. Messages are JSON with `type: 'req'|'res'|'event'`. The connect flow is:
1. Open WebSocket to `CONFIG.wsUrl`
2. Gateway sends `connect.challenge` event with nonce
3. Client sends signed `connect` request with Ed25519 signature (v2 includes nonce)
4. Gateway responds with auth result; on success, issues a device token
5. Chat messages sent via `chat.send` RPC, received via `chat` events with `delta`/`final` states

## Deploy

```bash
firebase deploy --only hosting,storage --project eeveelution-3a390
```

**IMPORTANT:** Always specify `--project eeveelution-3a390` or run `firebase use eeveelution-3a390` first. The CLI may default to a different project (`professor-of-funk`).

## Device Management (Pi CLI)

```bash
# List all devices (pending + paired)
openclaw devices list

# Approve latest pending request
openclaw devices approve --latest

# Approve specific request
openclaw devices approve <requestId>

# Revoke a device token
openclaw devices revoke --device <deviceId> --role operator

# Gateway RPC (alternative)
openclaw gateway call device.pair.list
openclaw gateway call device.pair.approve --params '{"requestId":"..."}'
```

## Rollback

Use `git` to revert to a previous version if needed, then redeploy.

## Key Conventions

- No build step. Edit files directly and deploy.
- CSS lives in `styles.css` (safe to edit freely). JS/HTML lives in `index.html` (do not edit unless you understand the auth flow).
- CSS uses custom properties defined in `:root` (dark theme with purple/cyan accents).
- All JS code sections are delimited with `// ============` comment banners.
- Public keys are base64url-encoded, deviceId is SHA-256 of the public key (hex).
- Web Crypto Ed25519 requires Chrome 137+, Firefox 130+, Safari 17+.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "gateway token missing" | `gatewayToken` missing from Firestore config doc | Add it in Firebase console |
| "device identity mismatch" | Token in signature doesn't match `auth.token` | Check that code uses same token for both; clear localStorage and retry |
| Pairing screen but no pending request on Pi | Signature is wrong or gateway token invalid | Check console `Auth debug:` log; verify token matches Pi's `~/.openclaw/openclaw.json` → `gateway.auth.token` |
| Login redirects endlessly | Using `signInWithRedirect` | Must use `signInWithPopup` — redirect breaks on this app |
| COOP popup warning in console | Normal with `signInWithPopup` | Harmless — auth still completes |
| Deployed to wrong project | Firebase CLI defaulting to `professor-of-funk` | Use `--project eeveelution-3a390` flag |
