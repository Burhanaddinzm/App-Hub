const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 80;
const DB_PATH = process.env.DB_PATH || '/data/hub.db';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'changeme-hub-secret-2024';

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// --- Database setup ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    description TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1'
  );

  CREATE TABLE IF NOT EXISTS card_labels (
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, label_id)
  );
`);

// Seed some default labels if empty
const labelCount = db.prepare('SELECT COUNT(*) as c FROM labels').get();
if (labelCount.c === 0) {
  const insertLabel = db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)');
  [
    ['monitoring', '#f59e0b'],
    ['storage', '#10b981'],
    ['network', '#3b82f6'],
    ['security', '#ef4444'],
    ['dev', '#8b5cf6'],
  ].forEach(([name, color]) => insertLabel.run(name, color));
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// --- Auth routes ---
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ ok: true, username });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (req.session?.authenticated) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// --- Card routes ---
// Public: get all cards with labels
app.get('/api/cards', (req, res) => {
  const cards = db.prepare(`
    SELECT c.*,
      json_group_array(
        CASE WHEN l.id IS NOT NULL
          THEN json_object('id', l.id, 'name', l.name, 'color', l.color)
          ELSE NULL END
      ) as labels_json
    FROM cards c
    LEFT JOIN card_labels cl ON cl.card_id = c.id
    LEFT JOIN labels l ON l.id = cl.label_id
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.created_at ASC
  `).all();

  const result = cards.map(card => ({
    ...card,
    labels: JSON.parse(card.labels_json).filter(Boolean)
  }));
  delete result.labels_json;
  res.json(result);
});

// Protected: create card
app.post('/api/cards', requireAuth, (req, res) => {
  const { title, url, description, icon, label_ids } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'title and url required' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM cards').get().m || 0;
  const info = db.prepare(
    'INSERT INTO cards (title, url, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(title, url, description || '', icon || '', maxOrder + 1);

  const cardId = info.lastInsertRowid;
  if (Array.isArray(label_ids) && label_ids.length) {
    const insertCL = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
    label_ids.forEach(lid => insertCL.run(cardId, lid));
  }

  const card = getCardById(cardId);
  res.status(201).json(card);
});

// Protected: update card
app.put('/api/cards/:id', requireAuth, (req, res) => {
  const { title, url, description, icon, label_ids } = req.body;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM cards WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(
    `UPDATE cards SET title=?, url=?, description=?, icon=?, updated_at=datetime('now') WHERE id=?`
  ).run(title, url, description || '', icon || '', id);

  // Re-sync labels
  db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(id);
  if (Array.isArray(label_ids) && label_ids.length) {
    const insertCL = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
    label_ids.forEach(lid => insertCL.run(id, lid));
  }

  res.json(getCardById(id));
});

// Protected: delete card
app.delete('/api/cards/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Protected: reorder cards
app.put('/api/cards/reorder', requireAuth, (req, res) => {
  const { order } = req.body; // array of ids in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const update = db.prepare('UPDATE cards SET sort_order = ? WHERE id = ?');
  const tx = db.transaction(() => order.forEach((id, i) => update.run(i, id)));
  tx();
  res.json({ ok: true });
});

// --- Label routes ---
app.get('/api/labels', (req, res) => {
  res.json(db.prepare('SELECT * FROM labels ORDER BY name').all());
});

app.post('/api/labels', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'name and color required' });
  try {
    const info = db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)').run(name.toLowerCase().trim(), color);
    res.status(201).json(db.prepare('SELECT * FROM labels WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Label name already exists' });
    throw e;
  }
});

app.put('/api/labels/:id', requireAuth, (req, res) => {
  const { name, color } = req.body;
  const { id } = req.params;
  try {
    db.prepare('UPDATE labels SET name=?, color=? WHERE id=?').run(name.toLowerCase().trim(), color, id);
    res.json(db.prepare('SELECT * FROM labels WHERE id = ?').get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Label name already exists' });
    throw e;
  }
});

app.delete('/api/labels/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// --- Helper ---
function getCardById(id) {
  const card = db.prepare(`
    SELECT c.*,
      json_group_array(
        CASE WHEN l.id IS NOT NULL
          THEN json_object('id', l.id, 'name', l.name, 'color', l.color)
          ELSE NULL END
      ) as labels_json
    FROM cards c
    LEFT JOIN card_labels cl ON cl.card_id = c.id
    LEFT JOIN labels l ON l.id = cl.label_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);
  if (!card) return null;
  return { ...card, labels: JSON.parse(card.labels_json).filter(Boolean), labels_json: undefined };
}

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Hub running on :${PORT}`));
