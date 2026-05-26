const playerColors = {
  "ЮРКО": "#0c63ce",
  "РАЗБІК": "#ffd735",
  "ВАЛЄРЧИК": "#20a64a",
  "ДІДУСИК": "#dd2f2f",
  "МАРКУСИК": "#050505"
};

const params = new URLSearchParams(location.search);
const playerNames = ["ЮРКО", "РАЗБІК", "ВАЛЄРЧИК", "ДІДУСИК", "МАРКУСИК"];
const playerIndex = Number.parseInt(params.get("p"), 10);
const myName = params.get("name") || playerNames[playerIndex] || "";

const mobileGeneration = document.querySelector("#mobileGeneration");
const mobileName = document.querySelector("#mobileName");
const mobileIntro = document.querySelector("#mobileIntro");
const mobileDraft = document.querySelector("#mobileDraft");
const mobilePlayerCard = document.querySelector("#mobilePlayerCard");
const mobileTimer = document.querySelector("#mobileTimer");
const mobileStatus = document.querySelector("#mobileStatus");
const mobileReadyBtn = document.querySelector("#mobileReadyBtn");
const mobilePassBtn = document.querySelector("#mobilePassBtn");
const mobileNextBtn = document.querySelector("#mobileNextBtn");
const mobileMessage = document.querySelector("#mobileMessage");

const mobile = {
  state: null,
  player: null,
  lastSoundId: 0
};

function formatSeconds(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return "--:--";
  const negative = totalSeconds < 0;
  const absolute = Math.abs(Math.trunc(totalSeconds));
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${negative ? "-" : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function makeBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(0.001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.75);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.8);
  } catch (error) {
    console.warn("Не вдалося відтворити звук", error);
  }
}

async function sendAction(type, payload = {}) {
  await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, name: myName, ...payload })
  });
}

function render() {
  if (!mobile.state) return;

  mobile.player = mobile.state.players.find((player) => player.name === myName);
  mobileName.textContent = myName || "ГРАВЕЦЬ";
  mobileGeneration.textContent = `ПОКОЛІННЯ ${mobile.state.generation}`;
  mobileIntro.textContent = mobile.state.introCountdown
    ? formatSeconds(mobile.state.introCountdown.secondsLeft)
    : "ПОЧАТОК";
  mobileDraft.textContent = mobile.state.draftCountdown
    ? formatSeconds(mobile.state.draftCountdown.secondsLeft)
    : "ДРАФТ";

  if (!mobile.player) {
    mobileTimer.textContent = "--:--";
    mobileStatus.textContent = "Цього імені зараз немає у грі. Перевір посилання або список у ведучого.";
    mobileReadyBtn.disabled = true;
    mobilePassBtn.disabled = true;
    mobileNextBtn.disabled = true;
    return;
  }

  mobileReadyBtn.disabled = false;
  mobilePassBtn.disabled = mobile.player.passed;
  mobileNextBtn.disabled = false;
  mobileTimer.textContent = formatSeconds(mobile.player.seconds);
  mobileTimer.classList.toggle("timer-yurko", mobile.player.name === "ЮРКО");
  mobilePlayerCard.classList.toggle("is-active", mobile.player.running);
  mobilePlayerCard.style.background = playerColors[mobile.player.name] || "#fff";
  mobilePlayerCard.style.color = mobile.player.name === "МАРКУСИК" ? "#fff" : "#17141f";

  const labels = [];
  if (mobile.player.running) labels.push("ЗАРАЗ ТВОЯ ЧЕРГА");
  if (mobile.player.ready) labels.push("ГОТОВ");
  if (mobile.player.passed) labels.push("ПАС ДО НАСТУПНОГО ДРАФТУ");
  mobileStatus.textContent = labels.join(" / ");

  playServerSound();
}

function playServerSound() {
  const sound = mobile.state.sound;
  if (!sound || sound.id === mobile.lastSoundId) return;
  mobile.lastSoundId = sound.id;

  if (sound.reason === "intro" || sound.reason === "draft") {
    makeBeep();
  }

  if (sound.reason === "player-ten" && sound.playerName === myName) {
    makeBeep();
  }
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("state", (event) => {
    mobile.state = JSON.parse(event.data);
    render();
  });
  events.addEventListener("error", () => {
    mobileMessage.textContent = "З'єднання з сервером тимчасово втрачено.";
  });
}

async function loadInitialState() {
  const response = await fetch("/api/state");
  mobile.state = await response.json();
  mobile.lastSoundId = mobile.state.sound ? mobile.state.sound.id : 0;
  render();
  connectEvents();
}

mobileReadyBtn.addEventListener("click", () => sendAction("toggleReady"));
mobilePassBtn.addEventListener("click", () => sendAction("playerPass"));
mobileNextBtn.addEventListener("click", () => sendAction("next"));

loadInitialState().catch((error) => {
  mobileMessage.textContent = "Не вдалося підключитися. Перевір, чи запущений сервер на ноутбуці ведучого.";
  console.error(error);
});
