#!/usr/bin/env python3
"""WebSocket terminal proxy for Eeveelution.

Accepts WebSocket connections at ws://localhost:8767
Authenticates via Firebase ID token, then spawns a shell with full PTY.
Designed to sit behind a Cloudflare tunnel at evie.professoroffunk.com.

Usage: python server.py
"""

import asyncio
import json
import signal
import sys
import urllib.request

import websockets
from winpty import PtyProcess

# Config
HOST = "0.0.0.0"
PORT = 8767
SHELL = "C:\\PROGRA~1\\Git\\bin\\bash.exe"
FIREBASE_PROJECT = "eeveelution-3a390"
ALLOWED_UIDS = None  # Set to ["uid1", "uid2"] to restrict, or None to allow any authed user

# PTY dimensions (xterm.js will send resize)
DEFAULT_COLS = 120
DEFAULT_ROWS = 30


async def verify_firebase_token(id_token):
    """Verify Firebase ID token via Google's tokeninfo endpoint."""
    url = f"https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=AIzaSyCntodkV9WMDQOPaSUWH-VuURXWFj38erM"
    data = json.dumps({"idToken": id_token}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=5))
        result = json.loads(resp.read())
        users = result.get("users", [])
        if not users:
            return None
        user = users[0]
        uid = user.get("localId")
        email = user.get("email", "unknown")
        if ALLOWED_UIDS and uid not in ALLOWED_UIDS:
            print(f"Auth rejected: {email} (uid {uid}) not in allowed list")
            return None
        print(f"Auth OK: {email} (uid {uid})")
        return uid
    except Exception as e:
        print(f"Auth failed: {e}")
        return None


async def terminal_handler(websocket):
    """Handle a single WebSocket terminal session."""
    remote = websocket.remote_address
    print(f"Connection from {remote}")

    # First message must be auth token
    try:
        auth_msg = await asyncio.wait_for(websocket.recv(), timeout=10)
        auth_data = json.loads(auth_msg)
        if auth_data.get("type") != "auth":
            await websocket.send(json.dumps({"type": "error", "message": "Expected auth message"}))
            return
        uid = await verify_firebase_token(auth_data["token"])
        if not uid:
            await websocket.send(json.dumps({"type": "error", "message": "Authentication failed"}))
            return
        await websocket.send(json.dumps({"type": "auth", "status": "ok"}))
    except Exception as e:
        print(f"Auth error: {e}")
        await websocket.send(json.dumps({"type": "error", "message": str(e)}))
        return

    # Spawn PTY with clean env (no Claude Code session vars)
    import os
    clean_env = {k: v for k, v in os.environ.items()
                 if 'CLAUDE' not in k.upper()}
    clean_env['TERM'] = 'xterm-256color'
    try:
        pty = PtyProcess.spawn(SHELL, dimensions=(DEFAULT_ROWS, DEFAULT_COLS), env=clean_env)
    except Exception as e:
        print(f"PTY spawn failed: {e}")
        await websocket.send(json.dumps({"type": "error", "message": f"Shell failed: {e}"}))
        return

    print(f"Shell spawned for {uid}")

    async def pty_reader():
        """Read from PTY and send to WebSocket."""
        loop = asyncio.get_event_loop()
        while pty.isalive():
            try:
                data = await loop.run_in_executor(None, lambda: pty.read(4096))
                if data:
                    # Send as binary to avoid Cloudflare text frame issues
                    if isinstance(data, str):
                        await websocket.send(data.encode('utf-8', errors='replace'))
                    else:
                        await websocket.send(data)
            except EOFError:
                break
            except Exception:
                break

    async def ws_reader():
        """Read from WebSocket and write to PTY."""
        async for message in websocket:
            try:
                # Check for resize messages
                if isinstance(message, str) and message.startswith('{"type":"resize"'):
                    data = json.loads(message)
                    rows = data.get("rows", DEFAULT_ROWS)
                    cols = data.get("cols", DEFAULT_COLS)
                    pty.setwinsize(rows, cols)
                    continue
                # Regular input
                if isinstance(message, str):
                    pty.write(message)
                elif isinstance(message, bytes):
                    pty.write(message.decode(errors="replace"))
            except Exception:
                break

    try:
        # Run both readers concurrently
        done, pending = await asyncio.wait(
            [asyncio.create_task(pty_reader()), asyncio.create_task(ws_reader())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    finally:
        if pty.isalive():
            pty.terminate()
        print(f"Session ended for {uid}")


async def main():
    print(f"Terminal proxy starting on {HOST}:{PORT}")
    print(f"Shell: {SHELL}")

    async with websockets.serve(terminal_handler, HOST, PORT, max_size=2**20):
        print(f"Listening at ws://{HOST}:{PORT}")
        await asyncio.get_running_loop().create_future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutdown")
