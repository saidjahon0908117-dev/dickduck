import express from 'express';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';

const { BOT_TOKEN, GROQ_API_KEY, PORT = 3000, RENDER_EXTERNAL_URL, WEBAPP_URL } = process.env;
const BASE = WEBAPP_URL || RENDER_EXTERNAL_URL;
if (!BOT_TOKEN || !GROQ_API_KEY) { console.error('BOT_TOKEN va GROQ_API_KEY kerak'); process.exit(1); }

const FILE = 'users.json';
let users = {};
try { users = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.static('public'));

// oddiy limiter: IP boshiga daqiqasiga 30 so'rov
const hits = new Map();
setInterval(() => hits.clear(), 60000);
const limited = (ip) => { const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); return n > 30; };

app.get('/api/count', (_, res) => res.json({ count: Object.keys(users).length }));

app.post('/api/register', (req, res) => {
  const { id, name, native } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'bad request' });
  users[String(id)] = { name: String(name).slice(0, 40), native };
  fs.writeFile(FILE, JSON.stringify(users), () => {});
  res.json({ count: Object.keys(users).length });
});

app.get('/api/health', async (_, res) => {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 5, messages: [{ role: 'user', content: 'Hallo' }] })
    });
    const d = await r.json();
    res.json({ server: 'ok', groq: r.ok ? 'ok' : 'XATO', status: r.status, detail: r.ok ? d.choices[0].message.content : d?.error?.message });
  } catch (e) { res.json({ server: 'ok', groq: 'XATO', detail: e.message }); }
});

app.post('/api/ai', async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ error: 'too many requests' });
  try {
    const { messages = [], json = false } = req.body || {};
    const msgs = [messages[0], ...messages.slice(1).slice(-12)].filter(Boolean)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', messages: msgs, temperature: 0.6, max_tokens: 1000,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message || 'AI error');
    res.json({ text: d.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const bot = new Telegraf(BOT_TOKEN);
bot.start(ctx => ctx.reply(
  '🇩🇪 Willkommen!\nNemis tilini AI bilan o\'rganing.\nИзучайте немецкий с ИИ.\nLearn German with AI.',
  Markup.inlineKeyboard([[Markup.button.webApp('🇩🇪 Til o\'rganishni boshlash', BASE || 'https://example.com')]])
));

if (BASE) {
  app.use(bot.webhookCallback('/tg'));
  await bot.telegram.setWebhook(`${BASE}/tg`);
} else { bot.launch(); }

app.listen(PORT, () => console.log('Server:', PORT));
