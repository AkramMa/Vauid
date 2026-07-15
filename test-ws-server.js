/**
 * Minimal diagnostic WebSocket server — run this while the Electron app is STOPPED.
 *
 * Usage:
 *   node test-ws-server.js
 *
 * Then in Chrome DevTools console (any tab), paste:
 *   const ws = new WebSocket('ws://127.0.0.1:49152');
 *   ws.onopen    = () => console.log('[OPEN]');
 *   ws.onerror   = () => console.log('[ERROR]');
 *   ws.onclose   = e => console.log('[CLOSE]', e.code, e.reason);
 *   ws.onmessage = e => console.log('[MSG]', e.data);
 *
 * Expected result if all is well:
 *   Chrome console → [OPEN]  then  [MSG] {"type":"hello","version":1}
 *   Node console   → [Connection] ...  [Message] { type: 'hello' }
 */

'use strict';

const { WebSocketServer } = require('ws');

const PORT = 49152;

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });

// ── PNA / CORS headers (same as main server) ──────────────────────────────────
wss.on('headers', (headers, req) => {
  const origin = req.headers['origin'] || '*';
  headers.push(`Access-Control-Allow-Origin: ${origin}`);
  headers.push('Access-Control-Allow-Private-Network: true');
  headers.push('Access-Control-Allow-Headers: *');
  console.log(`[Headers] response to Origin: ${origin}`);
});

wss.on('listening', () => {
  console.log(`\n[Server] Listening on ws://127.0.0.1:${PORT}`);
  console.log('[Server] Waiting for connections...\n');
  console.log('Now paste this into Chrome DevTools console on any tab:');
  console.log('─'.repeat(60));
  console.log(`const ws = new WebSocket('ws://127.0.0.1:${PORT}');`);
  console.log(`ws.onopen    = () => console.log('[OPEN]');`);
  console.log(`ws.onerror   = e => console.log('[ERROR]', e.message || e);`);
  console.log(`ws.onclose   = e => console.log('[CLOSE]', e.code, e.reason);`);
  console.log(`ws.onmessage = e => console.log('[MSG]', e.data);`);
  console.log('─'.repeat(60));
});

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  const origin = req.headers['origin'] || '(no origin)';
  console.log(`\n[Connection] from ${addr}  origin: ${origin}`);

  // Send hello immediately
  const hello = JSON.stringify({ type: 'hello', version: 1 });
  ws.send(hello);
  console.log('[Sent] hello');

  ws.on('message', (data) => {
    console.log('[Received]', data.toString());
  });

  ws.on('close', (code, reason) => {
    console.log(`[Disconnected] code=${code} reason=${reason || '(none)'}`);
  });

  ws.on('error', (err) => {
    console.error('[Error]', err.message);
  });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Error] Port ${PORT} is already in use. Stop the Electron app first.`);
  } else {
    console.error('[Error]', err.message);
  }
  process.exit(1);
});
