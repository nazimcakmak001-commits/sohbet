
let waiting = null;const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, "public", "index.html"));
const SYMS = ["🦊","🐼","🐯","🦉","🐙","🦄","🐸","🐧","🦁","🐳","🦋","🐺","🐨","🦖","🌵","🍀","⭐","🔥","🌙","⚡"];
const rnd = a => a[Math.floor(Math.random() * a.length)];

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
});
const wss = new WebSocketServer({ server });

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const broadcastCount = () => wss.clients.forEach(c => send(c, { t: "count", n: wss.clients.size }));

function unpair(ws) {
  if (waiting === ws) waiting = null;
  const p = ws.partner;
  ws.partner = null;
  if (p && p.partner === ws) { p.partner = null; send(p, { t: "left" }); }
}
function find(ws) {
  unpair(ws);
  if (waiting && waiting !== ws && waiting.readyState === 1) {
    const o = waiting; waiting = null;
    ws.partner = o; o.partner = ws;
    send(ws, { t: "paired", name: o.name, sym: o.sym });
    send(o, { t: "paired", name: ws.name, sym: ws.sym });
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
  send(ws, { t: "hello", name: ws.name, sym: ws.sym });
  broadcastCount();

  ws.on("message", raw => {
    const now = Date.now();
    ws.stamp = ws.stamp.filter(x => now - x < 3000);
    if (ws.stamp.length >= 12) return;      // hız sınırı
    ws.stamp.push(now);
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "find") find(ws);
    else if (m.t === "msg" && ws.partner) send(ws.partner, { t: "msg", text: String(m.text || "").slice(0, 500) });
    else if (m.t === "typing" && ws.partner) send(ws.partner, { t: "typing", v: !!m.v });
  });
  ws.on("close", () => { unpair(ws); broadcastCount(); });
});

setInterval(() => {
  wss.clients.forEach(c => { if (!c.alive) return c.terminate(); c.alive = false; c.ping(); });
}, 30000);

server.listen(PORT, () => console.log("Sohbet çalışıyor: " + PORT));
