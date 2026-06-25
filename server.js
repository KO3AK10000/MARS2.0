const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "0.0.0.0";
const root = __dirname;

const playerNames = ["ЮРКО", "РАЗБІК", "ВАЛЄРЧИК", "ДІДУСИК", "МАРКУСИК", "ЄВГЕН"];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

const state = {
  defaultSeconds: 35 * 60,
  playerCount: 5,
  activeIndex: -1,
  generation: 1,
  introCountdown: null,
  draftCountdown: null,
  sound: null,
  players: playerNames.slice(0, 5).map((name) => createPlayer(name, 35 * 60))
};

const clients = new Set();
let lastTick = Date.now();
let soundId = 0;

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

function broadcast() {
  const data = JSON.stringify(cloneState());
  for (const client of clients) {
    client.write(`event: state\ndata: ${data}\n\n`);
  }
}

function triggerSound(reason, playerName = null) {
  soundId += 1;
  state.sound = { id: soundId, reason, playerName };
}

function createPlayer(name, seconds) {
  return {
    id: name,
    name,
    seconds,
    running: false,
    ready: false,
    passed: false,
    warnedBelowTen: false,
    readyWindow: false
  };
}

function resetPlayersForCount(count) {
  const safeCount = Math.min(5, Math.max(1, count));
  state.playerCount = safeCount;
  state.activeIndex = -1;
  state.generation = 1;
  cancelCountdown("intro");
  cancelCountdown("draft");
  state.players = playerNames.slice(0, safeCount).map((name) => createPlayer(name, state.defaultSeconds));
}

function stopAllPlayers() {
  state.players.forEach((player) => {
    player.running = false;
    player.readyWindow = false;
  });
}

function cancelCountdown(type) {
  if (type === "intro") state.introCountdown = null;
  if (type === "draft") state.draftCountdown = null;
}

function isPrepPhaseActive() {
  return Boolean(state.introCountdown || state.draftCountdown);
}

function startAvailablePlayers() {
  state.activeIndex = -1;
  state.players.forEach((player) => {
    player.running = !player.ready && !player.passed;
    player.readyWindow = player.running;
  });
}

function findNextPlayableIndex(fromIndex) {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (fromIndex + step + state.players.length) % state.players.length;
    if (!state.players[index].passed) {
      return index;
    }
  }
  return -1;
}

function activateNextPlayer() {
  stopAllPlayers();
  const nextIndex = findNextPlayableIndex(state.activeIndex);
  if (nextIndex === -1) {
    state.activeIndex = -1;
  } else {
    state.activeIndex = nextIndex;
    state.players[nextIndex].running = true;
    state.players[nextIndex].readyWindow = false;
    triggerSound("player-active", state.players[nextIndex].name);
  }
}

function rotatePlayers() {
  const firstPlayer = state.players.shift();
  state.players.push(firstPlayer);
  state.generation += 1;
}

function getIndexFromAction(action) {
  if (Number.isInteger(action.index) && action.index >= 0 && action.index < state.players.length) {
    return action.index;
  }

  if (typeof action.id === "string") {
    return state.players.findIndex((player) => player.id === action.id);
  }

  if (typeof action.name === "string") {
    return state.players.findIndex((player) => player.name === action.name);
  }

  return -1;
}

function applyAction(action) {
  switch (action.type) {
    case "setDefaultMinutes": {
      const minutes = Number.parseInt(action.minutes, 10);
      if (!Number.isFinite(minutes) || minutes <= 0) return;

      state.defaultSeconds = minutes * 60;
      state.activeIndex = -1;
      state.players.forEach((player) => {
        player.seconds = state.defaultSeconds;
        player.running = false;
        player.warnedBelowTen = state.defaultSeconds < 10 * 60;
      });
      break;
    }

    case "setPlayerCount": {
      const count = Number.parseInt(action.count, 10);
      if (!Number.isFinite(count)) return;
      resetPlayersForCount(count);
      break;
    }

    case "selectName": {
      const index = getIndexFromAction(action);
      if (index !== -1 && playerNames.includes(action.name)) {
        state.players[index].id = action.name;
        state.players[index].name = action.name;
      }
      break;
    }

    case "startPlayer": {
      const index = getIndexFromAction(action);
      if (index === -1 || state.players[index].passed) return;

      state.players.forEach((player, playerIndex) => {
        player.running = playerIndex === index;
        player.readyWindow = false;
      });
      state.activeIndex = index;
      triggerSound("player-active", state.players[index].name);
      break;
    }

    case "stopPlayer": {
      const index = getIndexFromAction(action);
      if (index !== -1) {
        state.players[index].running = false;
        state.players[index].readyWindow = false;
      }
      break;
    }

    case "toggleReady": {
      const index = getIndexFromAction(action);
      if (index === -1) return;
      if ((typeof action.id === "string" || typeof action.name === "string") && !isPrepPhaseActive() && !state.players[index].readyWindow) return;

      const player = state.players[index];
      player.ready = !player.ready;
      if (player.ready) {
        player.running = false;
        player.readyWindow = false;
      }
      break;
    }

    case "playerPass": {
      const index = getIndexFromAction(action);
      if (index === -1) return;
      if (index !== state.activeIndex || !state.players[index].running) return;
      if (state.players[index].readyWindow) return;

      state.players[index].passed = true;
      state.players[index].running = false;
      state.players[index].readyWindow = false;
      activateNextPlayer();
      break;
    }

    case "adminTogglePass": {
      const index = getIndexFromAction(action);
      if (index === -1) return;

      const player = state.players[index];
      player.passed = !player.passed;
      if (player.passed) {
        player.running = false;
      }
      break;
    }

    case "adjustPlayer": {
      const index = getIndexFromAction(action);
      const amount = Number.parseInt(action.amount, 10);
      if (index === -1 || !Number.isFinite(amount)) return;

      state.players[index].seconds += amount;
      if (state.players[index].seconds >= 10 * 60) {
        state.players[index].warnedBelowTen = false;
      }
      break;
    }

    case "globalStop": {
      stopAllPlayers();
      state.players.forEach((player) => {
        player.ready = false;
      });
      state.activeIndex = -1;
      cancelCountdown("intro");
      cancelCountdown("draft");
      break;
    }

    case "intro": {
      if (state.introCountdown) {
        cancelCountdown("intro");
      } else {
        state.introCountdown = { secondsLeft: 10 * 60 };
      }
      break;
    }

    case "draft": {
      if (state.draftCountdown) {
        cancelCountdown("draft");
      } else {
        rotatePlayers();
        state.players.forEach((player) => {
          player.ready = false;
        player.passed = false;
        player.running = false;
        player.readyWindow = false;
      });
        state.activeIndex = -1;
        state.draftCountdown = { secondsLeft: 3 * 60 };
      }
      break;
    }

    case "next": {
      if (state.players.some((player) => player.readyWindow)) return;

      if (typeof action.id === "string" || typeof action.name === "string") {
        const requestingIndex = getIndexFromAction(action);
        if (requestingIndex === -1 || requestingIndex !== state.activeIndex) return;
      }

      activateNextPlayer();
      break;
    }
  }
}

function tickCountdown(type, delta) {
  const countdown = type === "intro" ? state.introCountdown : state.draftCountdown;
  if (!countdown) return false;

  countdown.secondsLeft -= delta;
  if (countdown.secondsLeft > 0) return true;

  cancelCountdown(type);
  triggerSound(type);
  startAvailablePlayers();
  return true;
}

function tick() {
  const now = Date.now();
  const delta = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;

  let changed = false;
  state.players.forEach((player) => {
    if (!player.running) return;

    const before = player.seconds;
    player.seconds -= delta;
    changed = true;

    if (!player.warnedBelowTen && before >= 10 * 60 && player.seconds < 10 * 60) {
      player.warnedBelowTen = true;
      triggerSound("player-ten", player.name);
    }
  });

  changed = tickCountdown("intro", delta) || changed;
  changed = tickCountdown("draft", delta) || changed;

  if (changed) {
    broadcast();
  }
}

function getLocalAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();

  for (const networkInterface of Object.values(interfaces)) {
    for (const address of networkInterface || []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.push(address.address);
      }
    }
  }

  return addresses;
}

function serveStatic(request, response, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/state") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(cloneState()));
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/network") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ port, addresses: getLocalAddresses() }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/qr") {
    const qrUrl = url.searchParams.get("url") || "";
    try {
      const svg = await QRCode.toString(qrUrl, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 3,
        width: 260,
        color: {
          dark: "#000000",
          light: "#ffffff"
        }
      });
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(svg);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("QR error");
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(`event: state\ndata: ${JSON.stringify(cloneState())}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/action") {
    try {
      const body = await readRequestBody(request);
      applyAction(JSON.parse(body || "{}"));
      broadcast();
      response.writeHead(204);
      response.end();
    } catch (error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
    }
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response, url);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

setInterval(tick, 250);

function startKeepAlive() {
  const keepAliveUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  const disabled = process.env.KEEP_ALIVE === "false";
  if (disabled || !keepAliveUrl) return;

  const healthUrl = `${keepAliveUrl.replace(/\/$/, "")}/health`;
  const intervalMs = Number.parseInt(process.env.KEEP_ALIVE_INTERVAL_MS || String(10 * 60 * 1000), 10);

  setInterval(() => {
    fetch(healthUrl).catch(() => {});
  }, intervalMs).unref?.();
}

server.listen(port, host, () => {
  console.log(`Game timer host page: http://localhost:${port}`);
  getLocalAddresses().forEach((address) => {
    console.log(`Phones in the same Wi-Fi can open: http://${address}:${port}`);
  });
  startKeepAlive();
});
