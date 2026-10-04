const form = document.getElementById("form");
const input = document.getElementById("server");
const error = document.getElementById("error");
const fingerprint = document.getElementById("fingerprint");
const submit = document.getElementById("submit");
const back = document.getElementById("back");
const trust = document.getElementById("trust");

/** Fingerprint of the self-signed certificate the server presented, if that's what failed. */
let offered = null;

async function connect(server, trustFingerprint) {
  submit.disabled = back.disabled = trust.disabled = true;
  submit.textContent = "Conectando…";
  error.textContent = "";
  const result = await window.desktop.connect(server, trustFingerprint);
  // On success main navigates away (or relaunches); only failures come back here.
  if (!result?.error) return;
  error.textContent = result.error;
  offered = result.certificate ?? null;
  trust.hidden = fingerprint.hidden = !offered;
  fingerprint.textContent = offered ? `Impressão digital: ${offered}` : "";
  submit.disabled = back.disabled = trust.disabled = false;
  submit.textContent = "Conectar";
  input.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  connect(input.value);
});
input.addEventListener("input", () => {
  offered = null;
  trust.hidden = fingerprint.hidden = true;
});
trust.addEventListener("click", () => offered && connect(input.value, offered));

window.desktop.setupState().then((state) => {
  if (!state) return;
  if (state.server) {
    input.value = state.server;
    back.hidden = false;
    back.addEventListener("click", () => connect(state.server));
  }
  error.textContent = state.error ?? "";
  input.select();
});
