const grid = document.getElementById("grid");
const share = document.getElementById("share");
const audio = document.getElementById("audio");
const audioOn = document.getElementById("audio-on");
const audioPick = document.getElementById("audio-pick");
const audioTarget = document.getElementById("audio-target");
const audioPickHint = document.getElementById("audio-pick-hint");
const tabs = [...document.querySelectorAll("[role=tab]")];

let sources = [];
let kind = "screen";
let selected = null;
let audioOnly = false;
/** Per-app audio (Linux): everything listed while the picker is open, so a paused tab stays pickable. */
const audioApps = new Map();
let audioBusy = false;

const done = (choice) => window.desktop.pick(choice);
const chosenAudio = () => (!audioPick.hidden ? audioTarget.value : !audio.hidden && audioOn.checked);
const confirm = () => (selected || audioOnly) && done({ id: selected, audio: chosenAudio() });

function render() {
  for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.kind === kind));
  const visible = sources.filter((s) => s.kind === kind);
  grid.replaceChildren(
    ...(visible.length
      ? visible.map(card)
      : [Object.assign(document.createElement("p"), { className: "empty soft", textContent: "Nada para mostrar aqui." })]),
  );
}

function card(source) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "source";
  button.setAttribute("aria-pressed", String(source.id === selected));

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (source.thumbnail) thumb.style.backgroundImage = `url("${source.thumbnail}")`;

  const label = document.createElement("div");
  label.className = "label";
  if (source.icon) label.append(Object.assign(document.createElement("img"), { src: source.icon, alt: "" }));
  label.append(Object.assign(document.createElement("span"), { textContent: source.name, title: source.name }));

  button.append(thumb, label);
  button.addEventListener("click", () => {
    selected = source.id;
    share.disabled = false;
    for (const other of grid.querySelectorAll(".source")) other.setAttribute("aria-pressed", String(other === button));
    if (source.kind === "window") matchWindowAudio(source.name);
  });
  button.addEventListener("dblclick", confirm);
  return button;
}

// ---- Per-app audio ----

const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });

function renderAudioTargets() {
  const keep = audioTarget.value;
  const groups = new Map();
  for (const target of audioApps.values()) {
    const list = groups.get(target.app) ?? [];
    list.push(target);
    groups.set(target.app, list);
  }
  const items = [option("none", "Sem áudio")];
  if (!audioBusy) {
    for (const [app, targets] of groups) {
      const whole = targets.find((t) => !t.title);
      const titled = targets.filter((t) => t.title);
      if (!titled.length) {
        if (whole) items.push(option(whole.id, app));
        continue;
      }
      const group = Object.assign(document.createElement("optgroup"), { label: app });
      if (whole) group.append(option(whole.id, `Todo o som do ${app}`));
      for (const t of titled) group.append(option(t.id, t.title));
      items.push(group);
    }
    if (!groups.size) {
      items.push(Object.assign(option("", "Nenhum app tocando agora"), { disabled: true }));
    }
    items.push(option("system", "Todo o som do PC"));
  }
  audioTarget.replaceChildren(...items);
  audioTarget.value = [...audioTarget.options].some((o) => o.value === keep && !o.disabled) ? keep : "none";
  renderAudioHint();
}

function renderAudioHint() {
  const value = audioTarget.value;
  audioPickHint.textContent = audioBusy
    ? "Outra tela já está mandando o som de um app. Pare ela pra escolher o áudio desta."
    : value === "system"
      ? "Tudo que toca no PC, menos o som desta chamada."
      : value.startsWith("tab:")
        ? "Só o som dessa aba, mesmo com outras tocando."
        : value.startsWith("app:")
          ? "Só o som desse app."
          : "Dê play no que quer mandar e escolha aqui.";
}

/** A window was picked: preselect the tab or app whose sound most likely comes from it. */
function matchWindowAudio(name) {
  if (audioPick.hidden || audioBusy) return;
  const windowName = name.toLowerCase();
  const targets = [...audioApps.values()];
  // Firefox-like browsers title the window after the active tab, and the tab's stream after it too.
  const tab = targets
    .filter((t) => t.title && windowName.includes(t.title.toLowerCase()))
    .sort((a, b) => b.title.length - a.title.length)[0];
  const app = targets.find((t) => !t.title && t.app.length >= 3 && windowName.includes(t.app.toLowerCase()));
  const match = tab ?? app;
  if (!match) return;
  audioTarget.value = match.id;
  renderAudioHint();
}

function applyAudioOptions(options) {
  if (!options || options.mode !== "apps") return;
  audioBusy = options.busy;
  for (const target of options.apps) audioApps.set(target.id, target);
  // Don't swap the options out from under an open dropdown.
  if (document.activeElement !== audioTarget) renderAudioTargets();
}

audioTarget.addEventListener("change", renderAudioHint);

// ---- Wiring ----

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    kind = tab.dataset.kind;
    render();
  });
}
share.addEventListener("click", confirm);
document.getElementById("cancel").addEventListener("click", () => done(null));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") done(null);
  if (event.key === "Enter" && !event.target.closest?.("button, input, select")) confirm();
});

window.desktop.pickerSources().then((result) => {
  if (!result) return done(null);
  sources = result.sources;
  audioOnly = result.audioOnly;
  if (result.audio?.mode === "apps") {
    audioPick.hidden = false;
    applyAudioOptions(result.audio);
    audioTarget.value = audioBusy ? "none" : "system";
    renderAudioHint();
    setInterval(() => window.desktop.pickerAudio().then(applyAudioOptions), 2000);
  } else if (result.audio) {
    audio.hidden = false;
    audioOn.checked = result.audio.default;
    document.getElementById("audio-hint").textContent = result.audio.excludesSelf
      ? "Tudo que toca no PC, menos o som desta chamada."
      : "Inclui o som desta chamada: quem fala vai se ouvir de volta. Use só com a sala em silêncio.";
  }
  if (audioOnly) {
    document.body.classList.add("audio-only");
    document.querySelector("h1").textContent = "Mandar o som de quê junto com a tela?";
    share.disabled = false;
    share.focus();
    return;
  }
  // Single-monitor setups land straight on the only screen.
  const screens = sources.filter((s) => s.kind === "screen");
  if (screens.length === 1) {
    selected = screens[0].id;
    share.disabled = false;
  }
  render();
  share.focus();
});
