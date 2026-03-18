# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Eeveelution (The Familiar)** is a JRPG-styled PWA chat interface. Chat is powered by Claude Haiku via an OpenRouter-backed SSE endpoint on the Team Simonoto orchestrator. It is a single-file web app (`index.html`) with no build step, no bundler, and no npm dependencies.

## Tech Stack

- **Vanilla JS** in a single `index.html` (all HTML, CSS, and JS in one file)
- **Firebase Hosting** for deployment, **Firebase Auth** (Google sign-in via popup) for login, **Firestore** for per-user config/authorization, **Firebase Storage** for image uploads
- **SSE streaming** via orchestrator `/chat` endpoint (Claude Haiku through OpenRouter)
- **Web Push** notifications (VAPID, no FCM SDK)
- **Web Speech API** for voice input
- **xterm.js** terminal tab (connects to Pi via WebSocket)
- Firebase JS SDK loaded from CDN (`https://www.gstatic.com/firebasejs/10.8.0/`)

## Infrastructure

### URLs & Endpoints

| What | URL |
|------|-----|
| Live site | `https://eeveelution.professoroffunk.com` |
| Firebase Hosting | `https://eeveelution-3a390.web.app` |
| Orchestrator API (via tunnel) | `https://bones.professoroffunk.com` |
| Terminal WebSocket | `wss://eevee.professoroffunk.com/ws` |
| Firebase console | `https://console.firebase.google.com/project/eeveelution-3a390` |

### Firestore Config

Collection `config/{userId}` — presence of a document for the user's UID authorizes access.

### Mac Mini (orchestrator)

- IP: `192.168.4.28`, user: `SimonsMac`
- SSH: `/c/Windows/System32/OpenSSH/ssh.exe SimonsMac@192.168.4.28` (MUST use Windows OpenSSH, not Git's)
- Shell: **fish** — wrap commands in `bash -c '...'` over SSH
- Cloudflare Tunnel: `bones.professoroffunk.com` → `localhost:7070`, `eevee.professoroffunk.com` → `localhost:18789`
- Orchestrator: Team Simonoto on port 7070

## Architecture

### Single-File Structure

Everything lives in `index.html`. The `<script type="module">` section is organized into labeled sections:

1. **FIREBASE & AUTH** — Firebase init, Google sign-in (popup), Firestore config loading
2. **STATE** — `chatReady` flag, message array
3. **CONNECTION STATUS** — `generateId()`, `updateStatus()`
4. **MESSAGE HANDLING** — `currentStreamingMessage` state
5. **EMOTE SYSTEM** — Sprite animation (yap, think, laugh) synced to streaming text
6. **RENDERING** — `renderStreamingMessage()`, `updateStreamingContent()`, JRPG typewriter reveal system
7. **UTILITIES** — `escapeHtml()`, `formatTime()`, markdown rendering
8. **BRAIN INTEGRATION** — Open Brain semantic memory search/store for chat context
9. **SEND MESSAGE** — `sendMessage()` via orchestrator SSE `/chat` endpoint
10. **EVENT LISTENERS** — Send button, Enter key, voice input, image paste
11. **TABS** — Bottom nav (Chat, Ops, History, Settings, Terminal)
12. **OPS TAB** — `opsApi()` fetch helper, status/proposals/brief/deadlines rendering
13. **PUSH NOTIFICATIONS** — VAPID Web Push subscription
14. **OFFLINE SUPPORT** — Message queuing, offline UI, `flushOfflineQueue()`
15. **SETTINGS** — Theme switching, theme schedule, personality slider
16. **TERMINAL** — xterm.js terminal connected to Pi via WebSocket
17. **INIT** — `onAuthStateChanged` watcher

### Authentication Flow

1. **Firebase Auth** (Google sign-in popup) gates access to the app UI
2. **Firestore config doc** (`config/{userId}`) must exist to authorize the user
3. Chat goes through the orchestrator SSE endpoint (authenticated via `x-simonoto-key` header)

### Chat Flow

1. User sends message → `sendMessage()` called
2. Brain search injects relevant memories as context
3. POST to `OPS_API + '/chat'` with message history (SSE response)
4. `ReadableStream` reader consumes `data: {"content":"..."}` chunks
5. JRPG typewriter system reveals text character-by-character with emote animations
6. Message persisted to Firestore + local cache on completion

### JRPG Typewriter System

`renderStreamingMessage()` → `updateStreamingContent()` → `drainRevealQueue()` → `finalizeStreamingMessage()`

**Critical:** `currentStreamingMessage` must be initialized with `{id, role, content, type, timestamp, element: null}` BEFORE calling `renderStreamingMessage()`.

### Image Upload + Vision

Images (pasted or file-picked) are uploaded to Firebase Storage (`chat-images/{uid}/{timestamp}_{filename}`), and the download URL is sent to the orchestrator as an OpenRouter multimodal `image_url` content part. Claude Sonnet analyzes the image and responds. Images flow through `sendMessage()` alongside text — they get brain context, personality hints, and offline queueing like any other message. Client-side validation: JPEG/PNG/GIF/WebP only, 5MB max. Storage rules enforce the same server-side.

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `eevee.theme` | Selected theme |
| `eevee.personality` | Personality slider value |
| `eevee.offlineQueue` | Queued offline messages |
| `eevee.cachedMessages` | Local message cache for offline |
| `eevee.themeSchedule` | Auto theme switching schedule |

## Deploy

```bash
firebase deploy --only hosting,storage --project eeveelution-3a390
```

**IMPORTANT:** Always specify `--project eeveelution-3a390` or run `firebase use eeveelution-3a390` first. The CLI may default to a different project (`professor-of-funk`).

## Key Conventions

- No build step. Edit files directly and deploy.
- CSS lives in `styles2.css`. JS/HTML lives in `index.html`.
- All JS code sections are delimited with `// ============` comment banners.
- **NEVER** use `signInWithRedirect` — it breaks on this app. Use `signInWithPopup`.
- Orchestrator API requires `x-simonoto-key` header (key hardcoded as `OPS_API_KEY` constant).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Chat shows "Error: Chat API error: 401" | API key wrong or missing | Check `OPS_API_KEY` matches orchestrator's key |
| Chat shows "Error: Chat API error: 502" | Orchestrator down | SSH to Mac Mini, check orchestrator |
| Login redirects endlessly | Using `signInWithRedirect` | Must use `signInWithPopup` |
| COOP popup warning in console | Normal with `signInWithPopup` | Harmless |
| Deployed to wrong project | Firebase CLI defaulting | Use `--project eeveelution-3a390` flag |
| Stale content after deploy | Service worker cache | Bump `CACHE_NAME` version in `sw.js` |
