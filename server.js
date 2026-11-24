const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const htmlPath = fs.existsSync(path.join(__dirname, "public", "index.html"))
  ? path.join(__dirname, "public", "index.html")
  : path.join(__dirname, "index.html");
const rawPage = fs.readFileSync(htmlPath, "utf8");

const CLIENT_WS_SCRIPT = `
  <script>
    (function initRealtimeSocket() {
      if (window.__hadikonusWsInit) return;
      window.__hadikonusWsInit = true;
      window.__disableMessageQuote = true;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = protocol + "//" + window.location.host;
      let socket = null;
      let reconnectTimer = null;

      function applyOnlineCount(n) {
        if (typeof n !== "number" || Number.isNaN(n)) return;
        const safeCount = Math.max(0, Math.floor(n));
        if (typeof onlineCount !== "undefined") {
          try { onlineCount = safeCount; } catch (e) {}
        }
        window.onlineCount = safeCount;
        if (typeof setOnlineCount === "function") {
          try { setOnlineCount(safeCount); } catch (e) {}
        }
        const candidates = [
          document.getElementById("online-count"),
          document.getElementById("onlineCount"),
          document.getElementById("active-users-count"),
          ...document.querySelectorAll("[data-online-count], .online-count")
        ];
        candidates.forEach((el) => {
          if (!el) return;
          if (/çevrimiçi|online/i.test(el.textContent) && el.children.length === 0) {
            el.textContent = safeCount + " çevrimiçi";
          } else if (el.children.length === 0) {
            el.textContent = String(safeCount);
          }
        });
      }

      // Mesaja sağ tıkla ve tıklayarak alıntıla özelliğini devre dışı bırak
      document.addEventListener("contextmenu", (e) => {
        const msgEl = e.target.closest(".message, .chat-msg, .msg, [data-msg-id], [data-quote], .quote-btn, .reply-btn");
        if (msgEl) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);

      document.addEventListener("click", (e) => {
        const quoteTrigger = e.target.closest("[data-quote], [data-reply], .quote-btn, .reply-btn, .message-quote, .alinti-btn");
        if (quoteTrigger) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);

      // Penaltı oyununda top ve eldiven hareket motoru
      function initPenaltyMotion() {
        let ballX = 0.5;
        let ballY = 0.78;
        let ballVx = 0.008;
        let ballVy = -0.006;
        let gloveX = 0.5;
        let gloveDir = 1;
        let kickActive = false;
        let kickProgress = 0;

        function triggerKick() {
          kickActive = true;
          kickProgress = 0;
          const targets = [-0.28, 0, 0.28];
          const chosen = targets[Math.floor(Math.random() * targets.length)];
          ballVx = chosen * 0.032;
          ballVy = -0.028;
        }

        document.addEventListener("click", (e) => {
          if (e.target.closest("#penalty-shoot-btn, .penalty-shoot, .shoot-btn, [data-penalty-shoot]")) {
            triggerKick();
          }
        });

        function stepPenalty() {
          // Kaleci eldiveni sürekli sağa-sola hareket eder
          gloveX += gloveDir * 0.012;
          if (gloveX > 0.82) { gloveX = 0.82; gloveDir = -1; }
          if (gloveX < 0.18) { gloveX = 0.18; gloveDir = 1; }

          if (kickActive) {
            kickProgress += 0.04;
            ballX += ballVx;
            ballY += ballVy;
            if (ballX < 0.12 || ballX > 0.88) ballVx *= -1;
            if (kickProgress >= 1 || ballY < 0.2) {
              kickActive = false;
              kickProgress = 0;
              ballX = 0.5;
              ballY = 0.78;
            }
          } else {
            // Top bekleme modunda hafif canlı hareket eder
            ballX = 0.5 + Math.sin(Date.now() / 450) * 0.04;
            ballY = 0.78 + Math.cos(Date.now() / 600) * 0.015;
          }

          const ballEl = document.getElementById("penalty-ball") || document.querySelector(".penalty-ball, .ball, [data-ball]");
          const gloveEl = document.getElementById("penalty-glove") || document.querySelector(".penalty-glove, .glove, .goalkeeper-glove, [data-glove]");

          if (ballEl) {
            ballEl.style.position = ballEl.style.position || "relative";
            ballEl.style.left = ((ballX - 0.5) * 220) + "px";
            ballEl.style.top = ((ballY - 0.78) * 180) + "px";
            ballEl.style.transform = "rotate(" + (kickProgress * 360) + "deg)";
          }

          if (gloveEl) {
            gloveEl.style.position = gloveEl.style.position || "relative";
            gloveEl.style.left = ((gloveX - 0.5) * 220) + "px";
            gloveEl.style.transform = "rotate(" + (gloveDir * 14) + "deg)";
          }

          const canvas = document.getElementById("penalty-canvas") || document.querySelector("canvas[data-game='penalty'], canvas#penalty");
          if (canvas && canvas.getContext) {
            const ctx = canvas.getContext("2d");
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            // Kale çizgisi
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 3;
            ctx.strokeRect(w * 0.2, h * 0.14, w * 0.6, h * 0.22);

            // Kaleci eldiveni
            const gx = gloveX * w;
            const gy = h * 0.28;
            ctx.fillStyle = "#f59e0b";
            ctx.beginPath();
            ctx.arc(gx, gy, 16, 0, Math.PI * 2);
            ctx.fill();

            // Top
            const bx = ballX * w;
            const by = ballY * h;
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(bx, by, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#111827";
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          requestAnimationFrame(stepPenalty);
        }

        requestAnimationFrame(stepPenalty);
      }

      initPenaltyMotion();

      function updateStatusDot(connected) {
        const dot = document.getElementById("status-dot");
        if (!dot) return;
        dot.style.backgroundColor = connected ? "#22C55E" : "#F59E0B";
      }

      function sendWs(payload) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      }

      function syncProfileToServer() {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const cleanName = String((typeof currentUser !== "undefined" && currentUser.name) || "Hızlı Baykuş")
          .replace(/#.*$/, "")
          .trim()
          .replace(/[^\\p{L}\\p{N}_ -]/gu, "")
          .slice(0, 18) || "Hızlı Baykuş";
        const savedToken = localStorage.getItem("hadikonus_ws_token") || "";
        sendWs({
          t: "login",
          name: cleanName,
          sym: (typeof currentUser !== "undefined" && currentUser.emoji) || "🦉",
          token: savedToken
        });
      }

      function connect() {
        try {
          socket = new WebSocket(wsUrl);
        } catch (e) {
          scheduleReconnect();
          return;
        }

        socket.addEventListener("open", () => {
          updateStatusDot(true);
          syncProfileToServer();
          sendWs({ t: "count" });
        });

        socket.addEventListener("message", (event) => {
          let msg = null;
          try {
            msg = JSON.parse(event.data);
          } catch (e) {
            return;
          }
          if (!msg || !msg.t) return;

          if (msg.t === "count" && typeof msg.n === "number") {
            applyOnlineCount(msg.n);
          } else if (msg.t === "hello") {
            if (msg.token) localStorage.setItem("hadikonus_ws_token", msg.token);
            if (msg.name && msg.name.includes("#")) {
              const parts = msg.name.split("#");
              if (typeof userTagId !== "undefined") userTagId = "#" + parts.pop();
              localStorage.setItem("hadikonus_userid", "#" + msg.name.split("#").pop());
              const tagEl = document.getElementById("user-tag-id");
              if (tagEl) tagEl.textContent = "#" + msg.name.split("#").pop();
            }
          } else if (msg.t === "searching") {
            const tEl = document.getElementById("matching-status-title");
            const dEl = document.getElementById("matching-status-desc");
            const liveNum = typeof window.onlineCount === "number" ? window.onlineCount : 1;
            if (tEl) tEl.textContent = "Rakip bekleniyor...";
            if (dEl) dEl.textContent = "Şu an " + liveNum + " kişi çevrimiçi. Başka bir kullanıcı eşleşme aradığında otomatik bağlanacaksın.";
          } else if (msg.t === "paired") {
            window.currentOpponent = {
              name: msg.name || "Rakip",
              emoji: msg.sym || "👤",
              isFavorite: false,
              isFriend: false
            };
            if (typeof currentOpponent !== "undefined") currentOpponent = window.currentOpponent;
            if (typeof showToast === "function") showToast("Eşleşme bulundu: " + window.currentOpponent.name);
            if (typeof matchMode !== "undefined" && matchMode === "direct") {
              sendWs({ t: "skipgame" });
              if (typeof selectedQuestionCards !== "undefined") selectedQuestionCards = [];
              if (typeof enterChatRoom === "function") enterChatRoom(false);
            } else {
              if (typeof setupGameArena === "function") setupGameArena();
              if (typeof switchView === "function") switchView("view-game");
            }
          } else if (msg.t === "msg") {
            if (typeof msg.text === "string" && msg.text.trim() && typeof addChatMessage === "function") {
              addChatMessage(msg.text, "other");
            }
          } else if (msg.t === "left") {
            if (typeof showToast === "function") showToast("Karşı taraf sohbetten ayrıldı.");
            if (typeof addSystemMessage === "function") addSystemMessage("Karşı taraf odadan ayrıldı.");
          } else if (msg.t === "roomwait") {
            if (typeof showToast === "function") showToast("Oda " + msg.code + " açıldı, arkadaşın bekleniyor...");
          } else if (msg.t === "roomerr") {
            if (typeof showToast === "function") showToast("Oda kodu 4-8 karakter (harf/rakam) olmalı.");
          }
        });

        socket.addEventListener("close", () => {
          updateStatusDot(false);
          applyOnlineCount(Math.max(0, (typeof window.onlineCount === "number" ? window.onlineCount : 1) - 1));
          scheduleReconnect();
        });

        socket.addEventListener("error", () => {
          updateStatusDot(false);
        });
      }

      function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 2000);
      }

      if (typeof window.startMatchmaking === "function") {
        const origStartMatchmaking = window.startMatchmaking;
        window.startMatchmaking = function (mode) {
          origStartMatchmaking(mode);
          sendWs({
            t: "find",
            mode: mode,
            game: typeof selectedGame !== "undefined" ? selectedGame : "rps",
            pref: typeof matchPref !== "undefined" ? matchPref : "global",
            coords: (typeof matchPref !== "undefined" && matchPref === "nearby" && typeof userCoords !== "undefined") ? userCoords : null
          });
        };
      }

      if (typeof window.cancelMatchmaking === "function") {
        const origCancelMatchmaking = window.cancelMatchmaking;
        window.cancelMatchmaking = function () {
          sendWs({ t: "idle" });
          origCancelMatchmaking();
        };
      }

      if (typeof window.sendChatMessage === "function") {
        const origSendChatMessage = window.sendChatMessage;
        window.sendChatMessage = function () {
          const input = document.getElementById("chat-input");
          const text = input ? input.value.trim() : "";
          if (!text) return;
          sendWs({ t: "msg", text });
          origSendChatMessage();
        };
      }

      if (typeof window.saveCustomUsername === "function") {
        const origSaveCustomUsername = window.saveCustomUsername;
        window.saveCustomUsername = function () {
          origSaveCustomUsername();
          syncProfileToServer();
        };
      }

      const rerollBtn = document.getElementById("reroll-btn");
      if (rerollBtn) {
        rerollBtn.addEventListener("click", () => {
          setTimeout(syncProfileToServer, 0);
        });
      }

      if (typeof window.joinExistingRoom === "function") {
        const origJoinExistingRoom = window.joinExistingRoom;
        window.joinExistingRoom = function () {
          const input = document.getElementById("join-room-input");
          const code = input ? input.value.trim().toUpperCase() : "";
          origJoinExistingRoom();
          if (code) {
            sendWs({ t: "room", code });
          }
        };
      }

      connect();
    })();
  </script>
`;

const page = rawPage.includes("initRealtimeSocket")
  ? rawPage
  : rawPage.replace("</body>", CLIENT_WS_SCRIPT + "\n</body>");

const SYMS = ["🦊","🐼","🐯","🦉","🐙","🦄","🐸","🐧","🦁","🐳","🦋","🐺","🐨","🦖","🌵","🍀","⭐","🔥","🌙","⚡","🦙","🐱","🦅","🐬"];
const rnd = a => a[Math.floor(Math.random() * a.length)];

const stats = { start: Date.now(), visits: 0, peak: 0, pairs: 0, msgs: 0 };
const ADMIN_PASS = process.env.ADMIN_PASS || "";

function adminPage() {
  const mins = Math.floor((Date.now() - stats.start) / 60000);
  const rows = [
    ["Şu an çevrimiçi", activeCount()],
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
const activeCount = () => {
  let n = 0;
  wss.clients.forEach(c => { if (c.readyState === 1) n++; });
  return n;
};
const broadcastCount = () => {
  const n = activeCount();
  stats.peak = Math.max(stats.peak, n);
  wss.clients.forEach(c => { if (c.readyState === 1) send(c, { t: "count", n }); });
};

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
    if (m.t === "count") send(ws, { t: "count", n: activeCount() });
    else if (m.t === "find") find(ws);
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
    else if (m.t === "penalty" && ws.partner) send(ws.partner, { t: "penalty", dir: m.dir });
    else if (m.t === "msg" && ws.partner) { stats.msgs++; send(ws.partner, { t: "msg", text: String(m.text || "").slice(0, 500) }); }
    else if (m.t === "typing" && ws.partner) send(ws.partner, { t: "typing", v: !!m.v });
  });
  ws.on("close", () => { unpair(ws); broadcastCount(); });
});

setInterval(() => {
  let dropped = false;
  wss.clients.forEach(c => {
    if (!c.alive) { c.terminate(); dropped = true; return; }
    c.alive = false;
    c.ping();
  });
  if (dropped) broadcastCount();
}, 30000);

server.listen(PORT, () => console.log("Sohbet çalışıyor: " + PORT));
