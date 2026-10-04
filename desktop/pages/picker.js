const grid = document.getElementById("grid");
const share = document.getElementById("share");
const audio = document.getElementById("audio");
const audioOn = document.getElementById("audio-on");
const tabs = [...document.querySelectorAll("[role=tab]")];

let sources = [];
let kind = "screen";
let selected = null;

const done = (choice) => window.desktop.pick(choice);
const confirm = () => selected && done({ id: selected, audio: !audio.hidden && audioOn.checked });

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
  });
  button.addEventListener("dblclick", confirm);
  return button;
}

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
  if (event.key === "Enter" && !event.target.closest?.("button, input")) confirm();
});

window.desktop.pickerSources().then((result) => {
  if (!result) return done(null);
  sources = result.sources;
  if (result.audio) {
    audio.hidden = false;
    audioOn.checked = result.audio.default;
    document.getElementById("audio-hint").textContent = result.audio.excludesSelf
      ? "Tudo que toca no PC, menos o som desta chamada."
      : "Inclui o som desta chamada: quem fala vai se ouvir de volta. Use só com a sala em silêncio.";
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
