const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, "public", "index.html"));
const SYMS = ["🦊","🐼","🐯","🦉","🐙","🦄","🐸","🐧","🦁","🐳","🦋","🐺","🐨","🦖","🌵","🍀","⭐","🔥","🌙","⚡"];
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

function unpair(ws) {
  if (waiting === ws) waiting = null;
  const p = ws.partner;
  ws.partner = null;
  if (p && p.partner === ws) { p.partner = null; send(p, { t: "left" }); }
}
function pair(a, b) {
  a.partner = b; b.partner = a; stats.pairs++;
  send(a, { t: "paired", name: b.name, sym: b.sym });
  send(b, { t: "paired", name: a.name, sym: a.sym });
}
const lc = x => String(x || "").toLocaleLowerCase("tr");
function setName(ws, m) {
  const name = String(m.name || "").trim().replace(/\s+/g, " ");
  const sym = SYMS.includes(m.sym) ? m.sym : rnd(SYMS);
  if (name.length < 3 || name.length > 14 || !/^[\p{L}\p{N}_ -]+$/u.test(name))
    return send(ws, { t: "nameerr", why: "Ad 3-14 karakter olmalı (harf, rakam, boşluk, _ ve -)." });
  for (const c of wss.clients) if (c !== ws && lc(c.name) === lc(name))
    return send(ws, { t: "nameerr", why: "Bu ad şu an kullanımda." });
  ws.name = name; ws.sym = sym;
  send(ws, { t: "hello", name, sym });
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
    else if (m.t === "setname") setName(ws, m);
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
