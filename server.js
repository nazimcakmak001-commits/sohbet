const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const page = fs.readFileSync(path.join(__dirname, "public", "index.html"));
const SYMS = ["🦊","🐼","🐯","🦉","🐙","🦄","🐸","🐧","🦁","🐳","🦋","🐺","🐨","🦖","🌵","🍀","⭐","🔥","🌙","⚡","🦙","🐱","🦅","🐬"];
const rnd = a => a[Math.floor(Math.random() * a.length)];

const stats = { start: Date.now(), visits: 0, peak: 0, pairs: 0, msgs: 0 };
const ADMIN_PASS = process.env.ADMIN_PASS || "";

function adminPage() {
  const mins = Math.floor((Date.now() - stats.start) / 60000);
  const rows = [
    ["Şu an çevrimiçi", wss.clients.size],
    ["En yüksek eşzamanlı kişi", stats.peak],
    ["Toplam bağlantı (ziyaret)", stats.visits],
    ["Kurulan eşleşme", stats.pairs],
    ["Gönderilen mesaj sayısı", stats.msgs],
    ["Sayaç başlangıcından beri (dk)", mins]
  ].map(r => "<tr><td>" + r[0] + "</td><td><b>" + r[1] + "</b></td></tr>").join("");
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yönetim</title><style>body{font:16px system-ui;max-width:480px;margin:24px auto;padding:0 16px}table{width:100%;border-collapse:collapse}td{padding:10px;border-bottom:1px solid #8884}small{color:#888}</style></head><body><h2>📊 İstatistikler</h2><table>' + rows + '</table><p><small>Sayılar sunucu yeniden başlayınca (uyku, güncelleme) sıfırlanır. Mesaj içerikleri tutulmaz.</small></p></body></html>';
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/yonetim")) {
    const key = new URL(req.url, "http://x").searchParams.get("key") || "";
    if (!ADMIN_PASS || key !== ADMIN_PASS) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(adminPage());
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
});
const wss = new WebSocketServer({ server });
let waiting = null;

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcastCount = () => { stats.peak = Math.max(stats.peak, wss.clients.size); wss.clients.forEach(c => send(c, { t: "count", n: wss.clients.size })); };

const rooms = new Map();
function joinRoom(ws, code) {
  code = String(code || "").toUpperCase().trim();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return send(ws, { t: "roomerr" });
  unpair(ws);
  const o = rooms.get(code);
  if (o && o !== ws && o.readyState === 1 && !o.partner) { rooms.delete(code); o.room = null; pair(ws, o); }
  else { rooms.set(code, ws); ws.room = code; send(ws, { t: "roomwait", code }); }
}
function unpair(ws) {
  if (waiting === ws) waiting = null;
  if (ws.room && rooms.get(ws.room) === ws) rooms.delete(ws.room);
  ws.room = null;
  if (ws.game) { const g = ws.game; g.a.game = g.b.game = null; }
  const p = ws.partner;
  ws.partner = null;
  if (p && p.partner === ws) { p.partner = null; send(p, { t: "left" }); }
}
const QUESTIONS = ["En son ne zaman çok güldün?","Bir süper gücün olsa ne olurdu?","En sevdiğin yemek ne?","Hayatında yaptığın en çılgın şey neydi?","Sınırsız paran olsa ilk ne yapardın?","Hangi şehirde yaşamak isterdin?","En sevdiğin film ya da dizi hangisi?","Bir gün için görünmez olsan ne yapardın?","Çocukken ne olmak istiyordun?","Son izlediğin şey seni nasıl etkiledi?","Kendini üç kelimeyle anlat.","Seni en çok ne mutlu eder?","Hiç gitmediğin ama gitmek istediğin yer neresi?","En sevdiğin şarkı hangisi?","Sabah insanı mısın gece insanı mı?","Bir gün başka biri olsan kim olurdun?","En komik anın neydi?","Hayvan olsan ne olurdun, neden?","Bugün seni en çok ne gülümsetti?","Tek bir şeyi öğrenmek için sınırsız zamanın olsa ne öğrenirdin?"];
const BEAT = { r: "s", p: "r", s: "p" };
const shuf = a => [...a].sort(() => Math.random() - 0.5);
function startGame(a, b) {
  const g = { a, b, pick: new Map(), score: new Map([[a, 0], [b, 0]]), round: 1, winner: null, cards: [], done: false };
  a.game = b.game = g;
  send(a, { t: "gamestart" }); send(b, { t: "gamestart" });
}
function rps(ws, c) {
  const g = ws.game;
  if (!g || g.done || g.winner || !["r", "p", "s"].includes(c)) return;
  g.pick.set(ws, c);
  if (g.pick.size < 2) return;
  const pa = g.pick.get(g.a), pb = g.pick.get(g.b);
  g.pick.clear();
  let w = null;
  if (pa !== pb) w = BEAT[pa] === pb ? g.a : g.b;
  if (w) g.score.set(w, g.score.get(w) + 1);
  const sa = g.score.get(g.a), sb = g.score.get(g.b);
  const fin = sa === 2 || sb === 2 || (g.round >= 3 && sa !== sb);
  [[g.a, pa, pb, sa, sb], [g.b, pb, pa, sb, sa]].forEach(([me, pm, po, sm, so]) =>
    send(me, { t: "rpsres", mine: pm, theirs: po, res: !w ? "draw" : w === me ? "win" : "lose", me: sm, opp: so, round: g.round }));
  if (fin) {
    g.winner = sa > sb ? g.a : g.b;
    g.cards = shuf(QUESTIONS).slice(0, 6);
    send(g.winner, { t: "cards", list: g.cards });
    send(g.winner === g.a ? g.b : g.a, { t: "waitcards" });
  } else g.round++;
}
function pickCards(ws, idx) {
  const g = ws.game;
  if (!g || g.winner !== ws || g.done || !Array.isArray(idx)) return;
  const u = [...new Set(idx.map(Number))].filter(i => Number.isInteger(i) && i >= 0 && i < g.cards.length);
  if (u.length !== 2) return;
  g.done = true; g.a.game = g.b.game = null;
  const list = u.map(i => g.cards[i]);
  [g.a, g.b].forEach(c => send(c, { t: "questions", list, by: ws.name }));
}
function skipGame(ws) {
  const g = ws.game;
  if (!g) return;
  g.done = true; g.a.game = g.b.game = null;
  [g.a, g.b].forEach(c => send(c, { t: "gameend" }));
}
function pair(a, b) {
  a.partner = b; b.partner = a; stats.pairs++;
  send(a, { t: "paired", name: b.name, sym: b.sym });
  send(b, { t: "paired", name: a.name, sym: a.sym });
  startGame(a, b);
}
const lc = x => String(x || "").toLocaleLowerCase("tr");
const mac = b => crypto.createHmac("sha256", SECRET).update(b).digest("base64url");
const sign = o => { const b = Buffer.from(JSON.stringify(o)).toString("base64url"); return b + "." + mac(b); };
function unsign(t) {
  try { const [b, m] = String(t).split("."); if (!b || m !== mac(b)) return null;
    const o = JSON.parse(Buffer.from(b, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
function login(ws, m) {
  const base = String(m.name || "").trim().replace(/\s+/g, " ");
  const sym = SYMS.includes(m.sym) ? m.sym : rnd(SYMS);
  if (base.length < 3 || base.length > 18 || !/^[\p{L}\p{N}_ -]+$/u.test(base))
    return send(ws, { t: "nameerr", why: "Ad 3-18 karakter olmalı (harf, rakam, boşluk, _ ve -)." });
  const o = unsign(m.token);
  const tag = o && /^\d{5}$/.test(o.tag) ? o.tag : String(10000 + crypto.randomInt(90000));
  const name = base + "#" + tag;
  for (const c of wss.clients) if (c !== ws && lc(c.name) === lc(name))
    return send(ws, { t: "nameerr", why: "Bu ad şu an başka yerde açık (kullanımda), kısa süre sonra tekrar dene." });
  ws.name = name; ws.sym = sym; ws.tag = tag;
  send(ws, { t: "hello", name, sym, token: sign({ tag, exp: Date.now() + 365 * 864e5 }) });
}
function byName(name, skip) {
  let t = null;
  wss.clients.forEach(c => { if (c !== skip && c.readyState === 1 && lc(c.name) === lc(name)) t = c; });
  return t;
}
function searchUsers(ws, q) {
  q = lc(q).trim();
  const list = [];
  if (q.length >= 2) wss.clients.forEach(c => { if (c !== ws && c.tag && list.length < 8 && lc(c.name).includes(q)) list.push({ name: c.name, sym: c.sym, free: c === waiting }); });
  send(ws, { t: "results", list });
}
function invite(ws, name) {
  const t = byName(name, ws);
  if (!t || !t.tag || !ws.tag) return send(ws, { t: "invfail" });
  ws.inviteTo = t;
  send(t, { t: "invite", from: ws.name, sym: ws.sym });
  send(ws, { t: "invsent", name: t.name });
}
function accept(ws, name) {
  const c = byName(name, ws);
  if (!c || c.inviteTo !== ws) return send(ws, { t: "invfail" });
  c.inviteTo = null; unpair(ws); unpair(c); pair(c, ws);
}
function decline(ws, name) {
  const c = byName(name, ws);
  if (c && c.inviteTo === ws) { c.inviteTo = null; send(c, { t: "invdecl", name: ws.name }); }
}
function sendStatus(ws, names) {
  if (!Array.isArray(names)) return;
  const want = new Set(names.slice(0, 50).map(lc)), on = [], free = [];
  wss.clients.forEach(c => { if (c !== ws && want.has(lc(c.name))) { on.push(c.name); if (c === waiting) free.push(c.name); } });
  send(ws, { t: "online", on, free });
}
function dm(ws, name) {
  let t = null;
  wss.clients.forEach(c => { if (c !== ws && lc(c.name) === lc(name)) t = c; });
  if (!t || t !== waiting) return send(ws, { t: "dmfail" });
  unpair(ws); waiting = null; pair(ws, t);
}
function find(ws) {
  unpair(ws);
  if (waiting && waiting !== ws && waiting.readyState === 1) {
    const o = waiting; waiting = null;
    pair(ws, o);
  } else {
    waiting = ws;
    send(ws, { t: "searching" });
  }
}

wss.on("connection", ws => {
  ws.name = "Anonim " + (1000 + Math.floor(Math.random() * 9000));
  ws.sym = rnd(SYMS);
  ws.partner = null; ws.alive = true; ws.stamp = [];
  ws.on("pong", () => { ws.alive = true; });
  stats.visits++;
  broadcastCount();

  ws.on("message", raw => {
    const now = Date.now();
    ws.stamp = ws.stamp.filter(x => now - x < 3000);
    if (ws.stamp.length >= 12) return;      // hız sınırı
    ws.stamp.push(now);
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "find") find(ws);
    else if (m.t === "login") login(ws, m);
    else if (m.t === "room") joinRoom(ws, m.code);
    else if (m.t === "idle") unpair(ws);
    else if (m.t === "rps") rps(ws, m.c);
    else if (m.t === "pickcards") pickCards(ws, m.idx);
    else if (m.t === "skipgame") skipGame(ws);
    else if (m.t === "search") searchUsers(ws, m.q);
    else if (m.t === "invite") invite(ws, m.name);
    else if (m.t === "accept") accept(ws, m.name);
    else if (m.t === "decline") decline(ws, m.name);
    else if (m.t === "status") sendStatus(ws, m.names);
    else if (m.t === "dm") dm(ws, m.name);
    else if (m.t === "msg" && ws.partner) { stats.msgs++; send(ws.partner, { t: "msg", text: String(m.text || "").slice(0, 500) }); }
    else if (m.t === "typing" && ws.partner) send(ws.partner, { t: "typing", v: !!m.v });
  });
  ws.on("close", () => { unpair(ws); broadcastCount(); });
});

setInterval(() => {
  wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); });
}, 30000);

server.listen(PORT, () => console.log("Sohbet çalışıyor: " + PORT));
