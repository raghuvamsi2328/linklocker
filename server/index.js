import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
// Phase 4: WebSocket signalling for y-webrtc peer discovery.
import {
  createUser,
  getUserByUsername,
  initializeDatabase
} from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';

app.use(cors());
app.use(express.json());

function normalizeOptionalText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function resolveAbsoluteUrl(baseUrl, maybeRelative) {
  if (!maybeRelative) {
    return '';
  }

  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractMetaContent(html, matcher) {
  const match = html.match(matcher);
  if (!match || !match[1]) {
    return '';
  }

  return decodeHtmlEntities(stripHtml(match[1]));
}

async function fetchRichMetadata(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'LinkLockerBot/1.0 (+metadata-fetch)'
    }
  });

  if (!response.ok) {
    throw new Error(`metadata fetch failed (${response.status})`);
  }

  const finalUrl = response.url || url;
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return {
      title: '',
      description: '',
      image: '',
      favicon: resolveAbsoluteUrl(finalUrl, '/favicon.ico'),
      siteName: new URL(finalUrl).hostname.replace(/^www\./i, '')
    };
  }

  const html = await response.text();

  const ogTitle = extractMetaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const twitterTitle = extractMetaContent(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const plainTitle = extractMetaContent(html, /<title[^>]*>([^<]+)<\/title>/i);

  const description =
    extractMetaContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    extractMetaContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    extractMetaContent(html, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["'][^>]*>/i);

  const imageRaw =
    extractMetaContent(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    extractMetaContent(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i);

  const faviconRaw =
    extractMetaContent(html, /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i) ||
    '/favicon.ico';

  const siteName =
    extractMetaContent(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    new URL(finalUrl).hostname.replace(/^www\./i, '');

  return {
    title: ogTitle || twitterTitle || plainTitle,
    description,
    image: resolveAbsoluteUrl(finalUrl, imageRaw),
    favicon: resolveAbsoluteUrl(finalUrl, faviconRaw),
    siteName
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username
    },
    jwtSecret,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = {
      id: Number(payload.sub),
      username: String(payload.username ?? '')
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/metadata', async (req, res) => {
  const rawUrl = normalizeOptionalText(req.query.url);

  if (!rawUrl) {
    res.status(400).json({ error: 'url query is required' });
    return;
  }

  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: 'url must be a valid absolute URL' });
    return;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    res.status(400).json({ error: 'url protocol must be http or https' });
    return;
  }

  try {
    const metadata = await fetchRichMetadata(parsed.toString());
    res.json(metadata);
  } catch {
    res.status(502).json({
      title: '',
      description: '',
      image: '',
      favicon: '',
      siteName: parsed.hostname.replace(/^www\./i, '')
    });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'username and password (min 6 chars) are required' });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const existing = getUserByUsername(normalizedUsername);
  if (existing) {
    res.status(409).json({ error: 'User already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser(normalizedUsername, passwordHash);
  const token = createToken(user);

  res.status(201).json({
    token,
    user: {
      id: user.id,
      username: user.username
    }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();
  const user = getUserByUsername(normalizedUsername);

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = createToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username
    }
  });
});

// ── Phase 4: WebSocket servers ────────────────────────────────────
//
// /signal  — y-webrtc signalling (kept for reference, unused by client now)
// /sync    — y-websocket binary relay for live Yjs sync between devices

const httpServer = createServer(app);

// Both servers use noServer so we route upgrades manually
const wss     = new WebSocketServer({ noServer: true }); // signalling
const syncWss = new WebSocketServer({ noServer: true }); // y-websocket relay

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0] ?? '';
  if (pathname === '/signal') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname.startsWith('/sync')) {
    syncWss.handleUpgrade(req, socket, head, (ws) => syncWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// ── y-websocket binary relay (/sync) ─────────────────────────────
//
// y-websocket client connects to ws://host/sync with the room name
// passed as the second argument to WebsocketProvider, which appends it
// to the URL as the path segment: ws://host/sync/<room>.
// The server just relays binary Yjs messages between all clients in the
// same room. It never decodes the messages — vault data stays encrypted.

/** @type {Map<string, Set<WebSocket>>} room → connected sockets */
const syncRooms = new Map();

syncWss.on('connection', (ws, req) => {
  // Room name is the last path segment after /sync/
  const room = (req.url ?? '/').replace(/^\/sync\/?/, '') || 'default';
  console.log(`[sync] client joined room="${room}"  peers=${(syncRooms.get(room)?.size ?? 0) + 1}`);

  if (!syncRooms.has(room)) syncRooms.set(room, new Set());
  syncRooms.get(room).add(ws);

  ws.on('message', (data, isBinary) => {
    const peers = syncRooms.get(room);
    if (!peers) return;
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === 1 /* OPEN */) {
        peer.send(data, { binary: isBinary });
      }
    }
  });

  ws.on('close', () => {
    const peers = syncRooms.get(room);
    if (peers) {
      peers.delete(ws);
      if (peers.size === 0) syncRooms.delete(room);
    }
    console.log(`[sync] client left  room="${room}"  peers=${syncRooms.get(room)?.size ?? 0}`);
  });

  ws.on('error', (err) => console.error(`[sync] ws error room="${room}"`, err.message));
});

// ── y-webrtc signalling relay (/signal) ──────────────────────────

/** @type {Map<string, Set<WebSocket>>} topic → connected sockets */
const topics = new Map();

wss.on('connection', (conn) => {
  /** @type {Set<string>} */
  const myTopics = new Set();
  let alive = true;

  const ping = setInterval(() => {
    if (!alive) { conn.close(); return; }
    alive = false;
    try { conn.ping(); } catch { conn.close(); }
  }, 30_000);

  conn.on('pong', () => { alive = true; });

  conn.on('close', () => {
    clearInterval(ping);
    myTopics.forEach((topic) => {
      const subs = topics.get(topic);
      if (subs) {
        subs.delete(conn);
        if (subs.size === 0) topics.delete(topic);
      }
    });
    myTopics.clear();
  });

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'subscribe') {
      for (const topic of (msg.topics ?? [])) {
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(conn);
        myTopics.add(topic);
        console.log(`[signal] subscribe  topic="${topic}"  total=${topics.get(topic).size}`);
      }
    } else if (msg.type === 'unsubscribe') {
      for (const topic of (msg.topics ?? [])) {
        topics.get(topic)?.delete(conn);
        myTopics.delete(topic);
        console.log(`[signal] unsubscribe topic="${topic}"  remaining=${topics.get(topic)?.size ?? 0}`);
      }
    } else if (msg.type === 'publish') {
      const subs = topics.get(msg.topic);
      const recipients = subs ? [...subs].filter(p => p !== conn && p.readyState === 1).length : 0;
      console.log(`[signal] publish     topic="${msg.topic}"  subtype=${msg.data?.type ?? '?'}  recipients=${recipients}`);
      if (subs) {
        const payload = JSON.stringify({ ...msg, clients: subs.size });
        subs.forEach((peer) => {
          if (peer !== conn && peer.readyState === 1 /* OPEN */) {
            peer.send(payload);
          }
        });
      }
    } else if (msg.type === 'ping') {
      conn.send(JSON.stringify({ type: 'pong' }));
    }
  });
});

initializeDatabase()
  .then(() => {
    httpServer.listen(port, () => {
      console.log(`API + signalling listening on http://localhost:${port}`);
    });

    httpServer.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Stop the existing server and retry.`);
        process.exit(1);
      }

      console.error('Unexpected server startup error', error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
