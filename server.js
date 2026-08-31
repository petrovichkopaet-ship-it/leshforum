// Лешуйск / Форум — сервер форума
// Использует только встроенные модули Node.js (без npm install)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // слушаем все сетевые интерфейсы, чтобы форум был доступен по Wi-Fi

function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');
const INDEX_FILE = path.join(__dirname, 'index.html');

// ---------- Утилиты для хранения данных ----------
function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let users = loadJSON(USERS_FILE, []);
let forum = loadJSON(FORUM_FILE, { categories: [], threads: [], posts: [] });

// Сессии храним в памяти: token -> userId
const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeUserSafe(u) {
  const { passwordHash, salt, ...safe } = u;
  return safe;
}
function findUserByPhone(phone) {
  return users.find(u => u.phone === phone);
}
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}
function getUserFromRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const userId = sessions.get(token);
  if (!userId) return null;
  return users.find(u => u.id === userId) || null;
}

// ---------- Обработка тела запроса ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// ---------- Единственная HTML-страница (CSS и JS уже внутри неё) ----------
function serveIndex(res) {
  fs.readFile(INDEX_FILE, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html не найден рядом с server.js');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
}

// ---------- API маршруты ----------
async function handleApi(req, res, pathname) {
  // РЕГИСТРАЦИЯ
  if (pathname === '/api/register' && req.method === 'POST') {
    const { phone, password, name } = await readBody(req);
    if (!phone || !password) {
      return sendJSON(res, 400, { error: 'Укажите телефон и пароль' });
    }
    if (findUserByPhone(phone)) {
      return sendJSON(res, 409, { error: 'Пользователь с таким номером уже зарегистрирован' });
    }
    if (password.length < 4) {
      return sendJSON(res, 400, { error: 'Пароль слишком короткий' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const newUser = {
      id: crypto.randomUUID(),
      phone,
      name: name || phone,
      passwordHash: hashPassword(password, salt),
      salt,
      isMayor: false,
      tag: null,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    saveJSON(USERS_FILE, users);
    const token = genToken();
    sessions.set(token, newUser.id);
    return sendJSON(res, 201, { token, user: makeUserSafe(newUser) });
  }

  // ВХОД
  if (pathname === '/api/login' && req.method === 'POST') {
    const { phone, password } = await readBody(req);
    const user = findUserByPhone(phone);
    if (!user) return sendJSON(res, 401, { error: 'Неверный номер телефона или пароль' });
    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) {
      return sendJSON(res, 401, { error: 'Неверный номер телефона или пароль' });
    }
    const token = genToken();
    sessions.set(token, user.id);
    return sendJSON(res, 200, { token, user: makeUserSafe(user) });
  }

  // ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
  if (pathname === '/api/me' && req.method === 'GET') {
    const user = getUserFromRequest(req);
    if (!user) return sendJSON(res, 401, { error: 'Не авторизован' });
    return sendJSON(res, 200, { user: makeUserSafe(user) });
  }

  // ВЫХОД
  if (pathname === '/api/logout' && req.method === 'POST') {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) sessions.delete(auth.slice(7));
    return sendJSON(res, 200, { ok: true });
  }

  // СПИСОК РАЗДЕЛОВ
  if (pathname === '/api/categories' && req.method === 'GET') {
    return sendJSON(res, 200, { categories: forum.categories });
  }

  // СПИСОК ТЕМ (?category=id)
  if (pathname === '/api/threads' && req.method === 'GET') {
    const q = url.parse(req.url, true).query;
    let threads = forum.threads;
    if (q.category) threads = threads.filter(t => t.categoryId === q.category);
    threads = threads.map(t => {
      const author = users.find(u => u.id === t.authorId);
      const postCount = forum.posts.filter(p => p.threadId === t.id).length;
      return {
        ...t,
        authorName: author ? author.name : 'Неизвестно',
        authorTag: author ? author.tag : null,
        postCount
      };
    });
    return sendJSON(res, 200, { threads });
  }

  // СОЗДАТЬ ТЕМУ
  if (pathname === '/api/threads' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return sendJSON(res, 401, { error: 'Войдите, чтобы создать тему' });
    const { categoryId, title, message } = await readBody(req);
    if (!categoryId || !title || !message) return sendJSON(res, 400, { error: 'Заполните все поля' });
    const thread = {
      id: crypto.randomUUID(),
      categoryId,
      title,
      authorId: user.id,
      createdAt: new Date().toISOString()
    };
    forum.threads.push(thread);
    forum.posts.push({
      id: crypto.randomUUID(),
      threadId: thread.id,
      authorId: user.id,
      message,
      createdAt: new Date().toISOString()
    });
    saveJSON(FORUM_FILE, forum);
    return sendJSON(res, 201, { thread });
  }

  // ПОСТЫ ТЕМЫ (?thread=id)
  if (pathname === '/api/posts' && req.method === 'GET') {
    const q = url.parse(req.url, true).query;
    const posts = forum.posts
      .filter(p => p.threadId === q.thread)
      .map(p => {
        const author = users.find(u => u.id === p.authorId);
        return {
          ...p,
          authorName: author ? author.name : 'Неизвестно',
          authorTag: author ? author.tag : null
        };
      });
    const thread = forum.threads.find(t => t.id === q.thread);
    return sendJSON(res, 200, { posts, thread });
  }

  // ОТВЕТ В ТЕМЕ
  if (pathname === '/api/posts' && req.method === 'POST') {
    const user = getUserFromRequest(req);
    if (!user) return sendJSON(res, 401, { error: 'Войдите, чтобы ответить' });
    const { threadId, message } = await readBody(req);
    if (!threadId || !message) return sendJSON(res, 400, { error: 'Заполните сообщение' });
    const post = {
      id: crypto.randomUUID(),
      threadId,
      authorId: user.id,
      message,
      createdAt: new Date().toISOString()
    };
    forum.posts.push(post);
    saveJSON(FORUM_FILE, forum);
    return sendJSON(res, 201, { post });
  }

  sendJSON(res, 404, { error: 'Маршрут не найден' });
}

// ---------- HTTP сервер ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
    return;
  }
  serveIndex(res);
});

server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log(`Форум "Лешуйск" запущен!`);
  console.log('');
  console.log(`  На этом компьютере: http://localhost:${PORT}`);
  const lanAddresses = getLocalNetworkAddresses();
  if (lanAddresses.length > 0) {
    console.log('');
    console.log('  По Wi-Fi с телефона/другого устройства в той же сети:');
    lanAddresses.forEach(addr => console.log(`    http://${addr}:${PORT}`));
  } else {
    console.log('');
    console.log('  Не найдено сетевых адресов — проверьте подключение к Wi-Fi/сети.');
  }
  console.log('');
  console.log('  Не закрывайте это окно, пока пользуетесь форумом.');
  console.log('========================================');
});
