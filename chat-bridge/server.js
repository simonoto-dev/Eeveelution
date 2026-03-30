#!/usr/bin/env node

/**
 * Eeveelution Chat Bridge
 *
 * WebSocket server that bridges the Eeveelution PWA to Claude Code CLI.
 * Accepts connections, authenticates via Firebase ID token, then streams
 * Claude responses back for each chat message.
 *
 * Protocol:
 *   Client → { type: "auth", token: "<firebase_id_token>" }
 *   Server → { type: "auth", status: "ok" }
 *   Client → { type: "chat", message: "hello" }
 *   Server → { type: "delta", content: "Hi" }
 *   Server → { type: "delta", content: " there!" }
 *   Server → { type: "done", content: "Hi there!" }
 *
 * Runs on Mac Mini behind Cloudflare Tunnel at eevee.professoroffunk.com
 */

import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const PORT = Number(process.env.BRIDGE_PORT || 8765);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.env.HOME + '/Projects';
const FIREBASE_PROJECT = 'eeveelution-3a390';
const MAX_HISTORY = 20; // messages to keep in context

// ---------------------------------------------------------------------------
// Firebase token verification
// ---------------------------------------------------------------------------

async function verifyFirebaseToken(idToken) {
  const url = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=AIzaSyCntodkV9WMDQOPaSUWH-VuURXWFj38erM`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    const user = data.users?.[0];
    if (!user) return null;
    return { uid: user.localId, email: user.email || 'unknown' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Claude streaming
// ---------------------------------------------------------------------------

function streamClaude(prompt, onDelta, onDone, onError) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];

  console.log(`Spawning: ${CLAUDE_BIN} in ${CLAUDE_CWD} — ${args.join(' ').substring(0, 80)}...`);
  const proc = spawn(CLAUDE_BIN, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: CLAUDE_CWD,
    timeout: 5 * 60 * 1000, // 5 min
  });

  // Close stdin so claude doesn't block waiting for input
  proc.stdin.end();

  let fullText = '';

  const rl = createInterface({ input: proc.stdout });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const evt = JSON.parse(line);
      console.log(`Claude event: type=${evt.type} subtype=${evt.subtype || ''}`);

      // assistant message — extract text from content blocks
      if (evt.type === 'assistant' && evt.message?.content) {
        const text = evt.message.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
        if (text && text !== fullText) {
          const delta = text.slice(fullText.length);
          if (delta) {
            fullText = text;
            onDelta(delta);
          }
        }
      } else if (evt.type === 'result') {
        // Final result — use accumulated text or result field
        onDone(fullText || evt.result || '');
      }
    } catch {
      // Non-JSON line — might be raw text
      fullText += line;
      onDelta(line);
    }
  });

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    console.log(`Claude stderr: ${chunk.toString().trim()}`);
  });

  proc.on('close', (code) => {
    console.log(`Claude exited: code=${code} fullText=${fullText.length}chars stderr=${stderr.length}chars`);
    if (code !== 0 && !fullText) {
      onError(stderr || `Claude exited with code ${code}`);
    } else if (!fullText) {
      onDone('');
    }
    // If we already sent text via deltas, the done was already called via result event
  });

  proc.on('error', (err) => {
    onError(err.message);
  });

  return proc;
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });
console.log(`Chat bridge listening on ws://0.0.0.0:${PORT}`);

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`Connection from ${ip}`);

  let authed = false;
  let userEmail = null;
  let history = []; // { role: 'user'|'assistant', content: string }
  let activeProc = null;

  function send(obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    // Auth
    if (msg.type === 'auth') {
      const user = await verifyFirebaseToken(msg.token);
      if (!user) {
        send({ type: 'auth', status: 'error', message: 'Invalid token' });
        ws.close();
        return;
      }
      authed = true;
      userEmail = user.email;
      console.log(`Authenticated: ${userEmail}`);
      send({ type: 'auth', status: 'ok', email: userEmail });
      return;
    }

    if (!authed) {
      send({ type: 'error', message: 'Not authenticated' });
      return;
    }

    // Chat message
    if (msg.type === 'chat') {
      const userMessage = (msg.message || '').trim();
      console.log(`Chat from ${userEmail}: ${userMessage.substring(0, 80)}`);
      if (!userMessage) return;

      // Kill any active process
      if (activeProc) {
        try { activeProc.kill(); } catch {}
        activeProc = null;
      }

      // Add to history
      history.push({ role: 'user', content: userMessage });
      if (history.length > MAX_HISTORY * 2) {
        history = history.slice(-MAX_HISTORY * 2);
      }

      // Build prompt with conversation history
      const contextLines = [];
      if (history.length > 1) {
        contextLines.push('Previous conversation:');
        for (const h of history.slice(0, -1)) {
          contextLines.push(`${h.role === 'user' ? 'Human' : 'Assistant'}: ${h.content}`);
        }
        contextLines.push('');
      }
      contextLines.push(`Human: ${userMessage}`);
      contextLines.push('');
      contextLines.push(`You are Evie, Simon's AI familiar — a friendly, playful assistant who helps with music projects, code, and life.
You are running as Claude Code on a Mac Mini in Simon's home studio. Your working directory is ~/Projects (synced via Syncthing to all machines).
You have full access to read/edit project files. Key projects: the-familiar (this chat app), team-simonoto (orchestrator), simonoto.com, professor-of-funk, house (AI producer).
Open Brain (your memory): API at https://brain.professoroffunk.com with header x-brain-key. You can curl it to search or store memories.
Team Simonoto orchestrator: API at https://bones.professoroffunk.com — manages proposals, scans, research, and the executor daemon.
Keep responses concise and natural. Use tools when asked to do real work (edit files, check systems, etc).`);

      const prompt = contextLines.join('\n');

      send({ type: 'thinking' });

      let fullResponse = '';
      activeProc = streamClaude(
        prompt,
        (delta) => {
          fullResponse += delta;
          send({ type: 'delta', content: delta });
        },
        (final) => {
          const text = final || fullResponse;
          history.push({ role: 'assistant', content: text });
          send({ type: 'done', content: text });
          activeProc = null;
        },
        (error) => {
          send({ type: 'error', message: error });
          activeProc = null;
        },
      );
    }
  });

  ws.on('close', () => {
    console.log(`Disconnected: ${userEmail || ip}`);
    if (activeProc) {
      try { activeProc.kill(); } catch {}
    }
  });
});
