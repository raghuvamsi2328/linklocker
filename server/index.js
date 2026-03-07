import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  createLink,
  createUser,
  getLinksForUser,
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

app.get('/api/links', authRequired, (req, res) => {
  const groupName = normalizeOptionalText(req.query.group);
  const tag = normalizeOptionalText(req.query.tag).toLowerCase();

  const links = getLinksForUser(req.user.id, {
    groupName: groupName || undefined,
    tag: tag || undefined
  });

  res.json({ links });
});

app.post('/api/links', authRequired, (req, res) => {
  const { url, title, group, tags } = req.body ?? {};

  if (typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'url must be a valid URL' });
    return;
  }

  const normalizedGroup = normalizeOptionalText(group);
  const normalizedTags = normalizeTags(tags);

  const link = createLink(req.user.id, {
    url: url.trim(),
    title: normalizeOptionalText(title),
    groupName: normalizedGroup,
    tags: normalizedTags
  });

  res.status(201).json({ link });
});

initializeDatabase()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });

    server.on('error', (error) => {
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
