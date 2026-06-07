const playerNames = ["ЮРКО", "РАЗБІК", "ВАЛЄРЧИК", "ДІДУСИК", "МАРКУСИК", "ЄВГЕН"];
const playerColors = {
  "ЮРКО": "#0c63ce",
  "РАЗБІК": "#ffd735",
  "ВАЛЄРЧИК": "#20a64a",
  "ДІДУСИК": "#dd2f2f",
  "МАРКУСИК": "#050505",
  "ЄВГЕН": "linear-gradient(135deg, #ffe15a 0%, #2fbf62 100%)"
};

const playersEl = document.querySelector("#players");
const minutesInput = document.querySelector("#minutesInput");
const playerCountSelect = document.querySelector("#playerCountSelect");
const setMinutesBtn = document.querySelector("#setMinutesBtn");
const introBtn = document.querySelector("#introBtn");
const draftBtn = document.querySelector("#draftBtn");
const globalStopBtn = document.querySelector("#globalStopBtn");
const nextBtn = document.querySelector("#nextBtn");
const generationEl = document.querySelector("#generation");
const phoneLinksEl = document.querySelector("#phoneLinks");

const admin = {
  state: null,
  refs: [],
  lastSoundId: 0,
  phoneBaseUrl: `${location.protocol}//${location.host}`,
  renderedPhoneBaseUrl: "",
  visibleQrIndex: -1
};

function formatSeconds(totalSeconds) {
  const negative = totalSeconds < 0;
  const absolute = Math.abs(Math.trunc(totalSeconds));
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${negative ? "-" : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function sendAction(type, payload = {}) {
  await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, ...payload })
  });
}

function buildPlayers() {
  playersEl.innerHTML = "";
  admin.refs = [];

  admin.state.players.forEach((player, index) => {
    const playerEl = document.createElement("article");
    playerEl.className = "player";

    const select = document.createElement("select");
    select.setAttribute("aria-label", `Гравець ${index + 1}`);
    playerNames.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    });
    select.addEventListener("change", () => {
      sendAction("selectName", { index, name: select.value });
    });

    const timer = document.createElement("div");
    timer.className = "timer";

    const runRow = document.createElement("div");
    runRow.className = "button-row single";
    runRow.append(
      makeButton("старт", "start", () => sendAction("startPlayer", { index }))
    );

    const stateRow = document.createElement("div");
    stateRow.className = "button-row";
    const readyBtn = makeButton("готов", "ready", () => sendAction("toggleReady", { index }));
    const passBtn = makeButton("ПАС", "pass", () => sendAction("adminTogglePass", { index }));
    stateRow.append(
      readyBtn,
      passBtn
    );

    const adjustRow = document.createElement("div");
    adjustRow.className = "button-row";
    adjustRow.append(
      makeButton("+ 1 хв", "adjust", () => sendAction("adjustPlayer", { index, amount: 60 })),
      makeButton("- 1 хв", "adjust", () => sendAction("adjustPlayer", { index, amount: -60 }))
    );

    const status = document.createElement("div");
    status.className = "status";

    playerEl.append(select, timer, runRow, stateRow, adjustRow, status);
    playersEl.append(playerEl);
    admin.refs[index] = { playerEl, select, timer, readyBtn, passBtn, status };
  });
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function render() {
  if (!admin.state) return;

  if (admin.refs.length !== admin.state.players.length) {
    buildPlayers();
  }

  if (document.activeElement !== minutesInput) {
    minutesInput.value = Math.round(admin.state.defaultSeconds / 60);
  }
  if (playerCountSelect && document.activeElement !== playerCountSelect) {
    playerCountSelect.value = String(admin.state.playerCount || admin.state.players.length);
  }
  generationEl.textContent = `ПОКОЛІННЯ ${admin.state.generation}`;
  renderCountdownButtons();
  renderPlayers();
  renderPhoneLinks();
}

function renderPlayers() {
  admin.state.players.forEach((player, index) => {
    const ref = admin.refs[index];
    ref.playerEl.classList.toggle("is-active", player.running);
    ref.playerEl.style.background = playerColors[player.name] || "#fff";
    ref.playerEl.style.color = player.name === "МАРКУСИК" ? "#fff" : "#17141f";
    ref.select.value = player.name;
    ref.timer.textContent = formatSeconds(player.seconds);
    ref.timer.classList.toggle("timer-yurko", player.name === "ЮРКО");
    ref.readyBtn.classList.toggle("is-on", player.ready);
    ref.passBtn.classList.toggle("is-on", player.passed);

    const labels = [];
    if (player.ready) labels.push("ГОТОВ");
    if (player.passed) labels.push("ПАС");
    if (player.running) labels.push("ХІД");
    ref.status.innerHTML = labels.length ? `<span>${labels.join(" / ")}</span>` : "";
  });
}

function renderCountdownButtons() {
  if (admin.state.introCountdown) {
    introBtn.textContent = formatSeconds(admin.state.introCountdown.secondsLeft);
    introBtn.classList.add("is-counting");
  } else {
    introBtn.textContent = "START";
    introBtn.classList.remove("is-counting");
  }

  if (admin.state.draftCountdown) {
    draftBtn.textContent = formatSeconds(admin.state.draftCountdown.secondsLeft);
    draftBtn.classList.add("is-counting");
  } else {
    draftBtn.textContent = "ДРАФТ";
    draftBtn.classList.remove("is-counting");
  }
}

function renderPhoneLinks() {
  if (!phoneLinksEl) return;

  const baseUrl = admin.phoneBaseUrl;
  const phoneRenderKey = `${baseUrl}|${admin.state.players.map((player) => `${player.id}:${player.name}`).join("|")}`;
  if (admin.renderedPhoneBaseUrl === phoneRenderKey) return;
  admin.renderedPhoneBaseUrl = phoneRenderKey;
  phoneLinksEl.innerHTML = "";

  admin.state.players.forEach((player, index) => {
    const name = player.name;
    const url = `${baseUrl}/player.html?id=${encodeURIComponent(player.id || player.name)}`;
    const card = document.createElement("article");
    const qr = document.createElement("img");
    const button = document.createElement("button");
    const link = document.createElement("a");

    card.className = "qr-card";
    qr.className = "qr-code";
    qr.src = `/qr?url=${encodeURIComponent(url)}`;
    qr.alt = `QR ${name}`;
    button.type = "button";
    button.className = "qr-name";
    button.textContent = name;
    button.addEventListener("click", () => {
      admin.visibleQrIndex = admin.visibleQrIndex === index ? -1 : index;
      updateQrVisibility();
    });
    link.href = url;
    link.textContent = "Відкрити";
    link.target = "_blank";

    card.append(button, qr, link);
    phoneLinksEl.append(card);
  });

  updateQrVisibility();
}

function updateQrVisibility() {
  const cards = phoneLinksEl.querySelectorAll(".qr-card");
  cards.forEach((card, index) => {
    card.classList.toggle("is-open", index === admin.visibleQrIndex);
  });
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("state", (event) => {
    admin.state = JSON.parse(event.data);
    render();
  });
  events.addEventListener("error", () => {
    console.warn("З'єднання з сервером тимчасово втрачено");
  });
}

async function loadInitialState() {
  await loadNetworkAddress();
  const response = await fetch("/api/state");
  admin.state = await response.json();
  admin.lastSoundId = admin.state.sound ? admin.state.sound.id : 0;
  buildPlayers();
  render();
  connectEvents();
}

async function loadNetworkAddress() {
  try {
    const response = await fetch("/api/network");
    const network = await response.json();
    const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (isLocalhost && network.addresses && network.addresses.length > 0) {
      admin.phoneBaseUrl = `${location.protocol}//${network.addresses[0]}:${network.port}`;
    }
  } catch (error) {
    console.warn("Не вдалося отримати адресу для телефонів", error);
  }
}

setMinutesBtn.addEventListener("click", () => {
  const minutes = Number.parseInt(minutesInput.value, 10);
  sendAction("setDefaultMinutes", { minutes });
});
if (playerCountSelect) {
  playerCountSelect.addEventListener("change", () => {
    sendAction("setPlayerCount", { count: Number.parseInt(playerCountSelect.value, 10) });
    admin.visibleQrIndex = -1;
    admin.renderedPhoneBaseUrl = "";
  });
}
introBtn.addEventListener("click", () => sendAction("intro"));
draftBtn.addEventListener("click", () => sendAction("draft"));
globalStopBtn.addEventListener("click", () => sendAction("globalStop"));
nextBtn.addEventListener("click", () => sendAction("next"));

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
  if (event.code === "Space" && !isTyping) {
    event.preventDefault();
    sendAction("next");
  }
});

loadInitialState().catch((error) => {
  playersEl.innerHTML = `<p class="connection-error">Запустіть сервер командою node server.js і відкрийте http://localhost:5173</p>`;
  console.error(error);
});
