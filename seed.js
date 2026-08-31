// Скрипт наполнения форума: создаёт только 1 аккаунт мэра.
// Обычные пользователи регистрируются сами через форму на сайте.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FORUM_FILE = path.join(DATA_DIR, 'forum.json');
const CREDS_FILE = path.join(DATA_DIR, 'credentials.txt');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeUser({ phone, name, password, isMayor, tag }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: crypto.randomUUID(),
    phone,
    name,
    passwordHash: hashPassword(password, salt),
    salt,
    isMayor: !!isMayor,
    tag: tag || null,
    createdAt: new Date().toISOString()
  };
}

// Генератор сложного пароля мэра
function generateComplexPassword(length = 18) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*()-_=+?';
  const all = upper + lower + digits + symbols;
  let pass = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = pass.length; i < length; i++) {
    pass.push(all[crypto.randomInt(all.length)]);
  }
  for (let i = pass.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pass[i], pass[j]] = [pass[j], pass[i]];
  }
  return pass.join('');
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// Если аккаунт мэра уже существует — ничего не пересоздаём
let users = [];
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch (e) {
  users = [];
}

if (users.some(u => u.isMayor)) {
  console.log('Аккаунт мэра уже существует — пропускаю создание.');
} else {
  const mayorPassword = generateComplexPassword(18);
  const mayor = makeUser({
    phone: '+79291227003',
    name: 'Мэр города Лешуйска',
    password: mayorPassword,
    isMayor: true,
    tag: 'Мэр'
  });
  users.push(mayor);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

  const credsText =
    'ДАННЫЕ ДЛЯ ВХОДА — ФОРУМ "ЛЕШУЙСК"\n' +
    '========================================\n\n' +
    'АККАУНТ МЭРА (тег "Мэр"):\n' +
    `  Телефон: ${mayor.phone}\n` +
    `  Пароль:  ${mayorPassword}\n\n` +
    'Остальные пользователи регистрируются сами через форму\n' +
    '"Регистрация" на сайте — своим номером телефона и паролем.\n';
  fs.writeFileSync(CREDS_FILE, credsText, 'utf8');

  console.log('Готово! Создан аккаунт мэра.');
  console.log('Данные для входа сохранены в data/credentials.txt');
}

// ---------- Начальное содержимое форума (только разделы, без тем) ----------
let forum;
try {
  forum = JSON.parse(fs.readFileSync(FORUM_FILE, 'utf8'));
} catch (e) {
  forum = null;
}

if (!forum) {
  const categories = [
    { id: crypto.randomUUID(), name: 'Объявления мэрии', description: 'Официальные новости и объявления от администрации города' },
    { id: crypto.randomUUID(), name: 'Городская жизнь', description: 'Обсуждение новостей и событий Лешуйска' },
    { id: crypto.randomUUID(), name: 'ЖКХ и благоустройство', description: 'Вопросы дорог, коммунальных услуг и благоустройства' },
    { id: crypto.randomUUID(), name: 'Флудилка', description: 'Общение на любые темы' },
  ];
  fs.writeFileSync(FORUM_FILE, JSON.stringify({ categories, threads: [], posts: [] }, null, 2), 'utf8');
  console.log('Разделы форума созданы.');
} else {
  console.log('Разделы форума уже существуют — пропускаю.');
}
