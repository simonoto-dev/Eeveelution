# Eeveelution

A JRPG-styled chat interface for OpenClaw.

## Setup

The app connects to an OpenClaw gateway via Cloudflare Tunnel. Connection config (`wsUrl`, `chatId`) is loaded from Firestore per user.

### First-time device pairing

1. Sign in with Google
2. The app generates an Ed25519 keypair and connects to the gateway
3. Gateway prompts for device pairing
4. SSH to Pi and approve:

```bash
openclaw gateway call device.pair.list
openclaw gateway call device.pair.approve --params '{"requestId":"..."}'
```

5. Click "Retry Connection" in the app

After pairing, the device token is cached in localStorage for future sessions.

### Deploy

```bash
firebase deploy
```

Firebase project: `eeveelution-3a390`

## File Structure

```
the-familiar/
  index.html        # Single-file PWA (all HTML, CSS, JS)
  manifest.json     # PWA manifest
  eevee-sprite.jpg  # Avatar image
  firebase.json     # Firebase hosting config
  firestore.rules   # Firestore security rules
  CLAUDE.md         # Architecture guide
```
