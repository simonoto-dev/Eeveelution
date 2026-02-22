# Device Pairing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace token-based auth with Ed25519 device pairing so The Familiar gets full operator scopes (including `operator.write` for sending messages).

**Architecture:** Single-file modification to `index.html`. Add Web Crypto Ed25519 keypair generation, signed connect requests, device token caching in localStorage, and a pairing-required UI screen. No external dependencies — uses native browser Web Crypto API.

**Tech Stack:** Vanilla JS, Web Crypto API (Ed25519), localStorage, WebSocket

---

### Task 0: Create backup

**Files:**
- Copy: `the-familiar/index.html` -> `the-familiar/index.html.bak`

**Step 1: Copy the current working file**

```bash
cp /c/Tools/Apps/the-familiar/index.html /c/Tools/Apps/the-familiar/index.html.bak
```

**Step 2: Verify backup exists**

```bash
ls -la /c/Tools/Apps/the-familiar/index.html.bak
```

Expected: File exists, same size as original.

---

### Task 1: Add pairing UI screen to HTML

**Files:**
- Modify: `the-familiar/index.html:442` (after login screen, before app div)

**Step 1: Add the pairing screen HTML**

Insert this HTML block between the `<!-- Login Screen -->` closing `</div>` (line 442) and the `<!-- App -->` comment (line 444):

```html
  <!-- Pairing Screen -->
  <div id="pairing-screen">
    <div style="text-align: center; max-width: 500px;">
      <img src="eevee-sprite.jpg" alt="Eevee" style="width: 100px; height: 100px; border-radius: 50%; margin-bottom: 20px; object-fit: cover; opacity: 0.7;">
      <h2 style="color: var(--text); font-size: 22px; margin-bottom: 8px;">Device Pairing Required</h2>
      <p style="color: var(--text-muted); margin-bottom: 24px;">This device needs to be approved before it can connect.</p>

      <div style="background: var(--bg-input); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 16px; text-align: left;">
        <p style="color: var(--text-muted); font-size: 13px; margin: 0 0 8px 0;">1. SSH to your Pi and run:</p>
        <pre style="background: var(--bg-dark); border-radius: 8px; padding: 12px; color: var(--accent-secondary); font-size: 13px; overflow-x: auto; margin: 0 0 12px 0;">openclaw gateway call device.pair.list</pre>
        <p style="color: var(--text-muted); font-size: 13px; margin: 0 0 8px 0;">2. Find your device and approve it:</p>
        <pre style="background: var(--bg-dark); border-radius: 8px; padding: 12px; color: var(--accent-secondary); font-size: 13px; overflow-x: auto; margin: 0;">openclaw gateway call device.pair.approve --params '{"requestId":"..."}'</pre>
      </div>

      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Device ID: <code id="pairing-device-id" style="color: var(--accent); font-size: 12px;">loading...</code></p>

      <button id="pairing-retry-btn" style="padding: 12px 32px; background: var(--accent); border: none; border-radius: 10px; color: white; font-family: 'Quicksand', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer;">
        Retry Connection
      </button>
    </div>
  </div>
```

**Step 2: Add CSS for pairing screen**

Add this CSS inside the existing `<style>` block (after the `#signout-btn:hover` rule, before `</style>`):

```css
    /* Pairing screen */
    #pairing-screen {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--bg-dark);
      justify-content: center;
      align-items: center;
      z-index: 100;
    }
    #pairing-screen.visible {
      display: flex;
    }
```

**Step 3: Verify visually**

Open `index.html` in browser. The pairing screen should NOT be visible (it has `display: none` by default). Inspect the DOM to confirm the `#pairing-screen` element exists.

---

### Task 2: Add Ed25519 crypto and device identity functions

**Files:**
- Modify: `the-familiar/index.html` (inside `<script type="module">`, after the CONFIG section ~line 518, before the STATE section ~line 520)

**Step 1: Add the device identity constants and crypto helpers**

Insert this code block after the `loadConfig` function (after line 518) and before the `// STATE` section:

```javascript
    // ============================================
    // DEVICE IDENTITY (Ed25519 crypto pairing)
    // ============================================
    const DEVICE_IDENTITY_KEY = 'openclaw.device.auth.v1';
    const DEVICE_TOKENS_KEY = 'openclaw.device.tokens.v1';

    function bytesToHex(bytes) {
      return Array.from(new Uint8Array(bytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    function hexToBytes(hex) {
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return bytes;
    }

    async function generateDeviceIdentity() {
      const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const deviceId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

      return {
        deviceId,
        publicKey: bytesToHex(publicKeyRaw),
        privateKeyJwk
      };
    }

    async function getOrCreateDeviceIdentity() {
      try {
        const stored = localStorage.getItem(DEVICE_IDENTITY_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.version === 1 && parsed.deviceId && parsed.publicKey && parsed.privateKeyJwk) {
            return parsed;
          }
        }
      } catch {}

      const identity = await generateDeviceIdentity();
      const record = {
        version: 1,
        ...identity,
        createdAtMs: Date.now()
      };
      localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(record));
      return record;
    }

    async function signMessage(privateKeyJwk, message) {
      const key = await crypto.subtle.importKey('jwk', privateKeyJwk, 'Ed25519', false, ['sign']);
      const encoded = new TextEncoder().encode(message);
      const signature = await crypto.subtle.sign('Ed25519', key, encoded);
      return bytesToHex(signature);
    }

    function storeDeviceToken(deviceId, role, token, scopes) {
      const record = {
        version: 1,
        deviceId,
        tokens: {
          [role]: { token, role, scopes, updatedAtMs: Date.now() }
        }
      };
      localStorage.setItem(DEVICE_TOKENS_KEY, JSON.stringify(record));
    }

    function getStoredToken(deviceId, role) {
      try {
        const item = localStorage.getItem(DEVICE_TOKENS_KEY);
        if (!item) return null;
        const stored = JSON.parse(item);
        if (stored.deviceId !== deviceId) return null;
        return stored.tokens[role]?.token || null;
      } catch {
        return null;
      }
    }
```

**Step 2: Verify crypto works in browser console**

Open `index.html` in the browser. In the console, this won't be directly testable (it's in a module), but we verify there are no syntax/load errors in the console on page load.

---

### Task 3: Replace `connect()` WebSocket URL

**Files:**
- Modify: `the-familiar/index.html:545-547`

**Step 1: Change the connect function to not pass token in URL**

The current code passes the token as a query parameter:
```javascript
    function connect() {
      const url = `${CONFIG.wsUrl}?token=${CONFIG.gatewayToken}`;
      ws = new WebSocket(url);
```

Change to just use the base URL (device pairing handles auth in the protocol, not the URL):
```javascript
    function connect() {
      const url = CONFIG.wsUrl;
      ws = new WebSocket(url);
```

---

### Task 4: Replace `sendConnectRequest()` with device-pairing version

**Files:**
- Modify: `the-familiar/index.html:612-637`

**Step 1: Replace the entire `sendConnectRequest` function**

Replace the current function (lines 612-637) with this async version:

```javascript
    async function sendConnectRequest() {
      try {
        const identity = await getOrCreateDeviceIdentity();
        const role = 'operator';
        const scopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'];
        const storedToken = getStoredToken(identity.deviceId, role);

        // Update pairing screen device ID display
        const deviceIdEl = document.getElementById('pairing-device-id');
        if (deviceIdEl) deviceIdEl.textContent = identity.deviceId;

        // Sign the connection payload
        const signedAtMs = Date.now();
        const message = [
          'v1',
          identity.deviceId,
          'webchat',
          'ui',
          role,
          scopes.join(','),
          String(signedAtMs),
          storedToken || ''
        ].join('|');

        const signature = await signMessage(identity.privateKeyJwk, message);

        const connectMsg = {
          type: 'req',
          id: generateId(),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'webchat',
              version: '1.0.0',
              platform: 'web',
              mode: 'ui'
            },
            role: role,
            scopes: scopes,
            device: {
              id: identity.deviceId,
              publicKey: identity.publicKey,
              signature: signature,
              signedAt: signedAtMs
            },
            auth: storedToken ? { token: storedToken } : undefined,
            locale: navigator.language || 'en-US',
            userAgent: navigator.userAgent
          }
        };

        ws.send(JSON.stringify(connectMsg));
      } catch (err) {
        console.error('Failed to build connect request:', err);
      }
    }
```

**Step 2: Update the challenge handler to use await**

In `ws.onmessage` (line 559), the challenge handler calls `sendConnectRequest()` which is now async. It was fire-and-forget before, and still is — no change needed since we don't await the result. But verify there are no issues.

---

### Task 5: Update connect response handler for pairing flow

**Files:**
- Modify: `the-familiar/index.html:566-577`

**Step 1: Replace the connect response handler**

Replace the current block (lines 566-577):
```javascript
          // Handle connect response
          if (data.type === 'res' && !wsAuthenticated) {
            if (data.ok) {
              console.log('✅ Authenticated!');
              wsAuthenticated = true;
              updateStatus(true);
              loadingEl.classList.remove('active');
            } else {
              console.error('❌ Auth failed:', data.error);
              ws.close();
            }
            return;
          }
```

With this expanded version that handles device token storage and pairing-required errors:
```javascript
          // Handle connect response
          if (data.type === 'res' && !wsAuthenticated) {
            if (data.ok) {
              console.log('✅ Authenticated!');
              wsAuthenticated = true;

              // Store device token if gateway provides one
              if (data.payload?.auth?.deviceToken) {
                try {
                  const identity = await getOrCreateDeviceIdentity();
                  storeDeviceToken(
                    identity.deviceId,
                    data.payload.auth.role || 'operator',
                    data.payload.auth.deviceToken,
                    data.payload.auth.scopes || []
                  );
                  console.log('💾 Device token stored');
                } catch (e) {
                  console.warn('Failed to store device token:', e);
                }
              }

              // Hide pairing screen if it was showing
              document.getElementById('pairing-screen').classList.remove('visible');
              updateStatus(true);
              loadingEl.classList.remove('active');
            } else {
              // Check if error indicates pairing is required
              const errCode = data.error?.code || '';
              const errMsg = data.error?.message || '';
              if (errCode === 'UNAUTHORIZED' || errMsg.toLowerCase().includes('pair')) {
                console.log('🔑 Device pairing required');
                showPairingScreen();
              } else {
                console.error('❌ Auth failed:', data.error);
                ws.close();
              }
            }
            return;
          }
```

**Important:** The `ws.onmessage` callback is currently a regular function. Since we now use `await` inside it, we need to make it `async`. Change line 554 from:
```javascript
      ws.onmessage = (event) => {
```
to:
```javascript
      ws.onmessage = async (event) => {
```

---

### Task 6: Add pairing screen show/hide logic and retry button

**Files:**
- Modify: `the-familiar/index.html` (in the AUTH UI section, around line 991-1015)

**Step 1: Add the `showPairingScreen` function and retry handler**

Add this code after the existing AUTH UI section (after the `signoutBtn` click handler, before the `// INIT` section):

```javascript
    // ============================================
    // PAIRING UI
    // ============================================
    const pairingScreen = document.getElementById('pairing-screen');
    const pairingRetryBtn = document.getElementById('pairing-retry-btn');

    function showPairingScreen() {
      loadingEl.classList.remove('active');
      pairingScreen.classList.add('visible');
    }

    pairingRetryBtn.addEventListener('click', () => {
      pairingScreen.classList.remove('visible');
      loadingEl.classList.add('active');
      if (ws) ws.close();
      reconnectAttempts = 0;
      connect();
    });
```

---

### Task 7: Remove gatewayToken dependency from CONFIG loading

**Files:**
- Modify: `the-familiar/index.html:497-501` and `the-familiar/index.html:1028-1033`

**Step 1: Clean up CONFIG object**

The `gatewayToken` field in CONFIG is no longer needed for auth (device pairing handles it). However, keep loading it from Firestore for backward compatibility — it just won't be used in the connect URL anymore.

No changes needed to `loadConfig()` — it still loads `wsUrl` and `chatId` which are needed.

But verify that the `configLoaded` check (line 1028-1033) still works. It checks `snap.exists()` which returns true if the Firestore doc exists at all. This is fine — we still need `wsUrl` and `chatId`.

No code change needed for this task. Just verification.

---

### Task 8: Test the full flow

**Step 1: Open the app in browser**

Navigate to the Firebase-hosted URL (or open `index.html` locally).

**Step 2: Sign in with Google**

Expected: Login succeeds, app loads.

**Step 3: Check browser console for connection attempt**

Expected output:
```
⚡ WebSocket opened, waiting for challenge...
📋 Received challenge, sending connect...
🔑 Device pairing required
```

**Step 4: Verify pairing screen appears**

Expected: The pairing screen shows with:
- Device ID displayed
- CLI commands to approve
- Retry button

**Step 5: On the Pi, list and approve the device**

```bash
openclaw gateway call device.pair.list
# Find the request, then:
openclaw gateway call device.pair.approve --params '{"requestId":"YOUR_REQUEST_ID"}'
```

**Step 6: Click "Retry Connection" in the app**

Expected: App reconnects, authenticates with the new device token, chat works.

**Step 7: Verify token caching**

Refresh the page. Expected: App auto-connects without showing pairing screen again.

---

### Task 9: Deploy to Firebase

**Step 1: Deploy**

```bash
cd /c/Tools/Apps/the-familiar && firebase deploy
```

**Step 2: Test on the live URL**

Open the Firebase Hosting URL, sign in, verify the pairing flow works through the Cloudflare Tunnel.

---

## Rollback

If anything breaks:
```bash
cp /c/Tools/Apps/the-familiar/index.html.bak /c/Tools/Apps/the-familiar/index.html
cd /c/Tools/Apps/the-familiar && firebase deploy
```

## Notes

- **Web Crypto Ed25519** requires Chrome 137+, Firefox 130+, Safari 17+. All current as of Feb 2026.
- The `gatewayToken` from Firestore is still loaded but no longer used in the connect flow. It can be removed from Firestore later.
- If the gateway expects a different signature format than hex-encoded Ed25519, this will need adjustment in `signMessage()` and the message template in `sendConnectRequest()`.
- The pairing error detection checks for `UNAUTHORIZED` code or the word "pair" in the error message. If the gateway uses different error codes, the check in Task 5 may need updating.
