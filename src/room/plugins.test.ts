import { expect, test } from "bun:test";
import type { PluginInfo } from "../lib/api";
import { PLUGIN_FRAME_ALLOW, pluginSandbox, usablePlugins } from "./pluginFrame";

const ORIGIN = "https://meet.example.com";
const draw: PluginInfo = { id: "drawspace", name: "Drawspace", description: "", icon: null, url: "https://draw.example.com/" };
const sameSite: PluginInfo = { id: "local", name: "Local", description: "", icon: null, url: `${ORIGIN}/thing/` };
const bt3: PluginInfo = { id: "bt3", name: "BT3", description: "", icon: "/plugins/bt3/icon.svg", url: "/plugins/bt3/", builtin: true };

test("the frame's permissions: controllers, sound, full screen, and the clipboard as before", () => {
  const allow = PLUGIN_FRAME_ALLOW.split(";").map((s) => s.trim());
  for (const feature of ["clipboard-read", "clipboard-write", "gamepad", "autoplay", "fullscreen"]) expect(allow).toContain(feature);
});

test("the sandbox: an opaque one never gets allow-same-origin", () => {
  expect(pluginSandbox(true).split(" ")).not.toContain("allow-same-origin");
  expect(pluginSandbox(false).split(" ")).toContain("allow-same-origin");
  for (const s of [pluginSandbox(true), pluginSandbox(false)]) expect(s).toContain("allow-scripts");
});

test("built-in plugins pass the same-origin filter, made absolute; external ones on the site's origin don't", async () => {
  const reached: string[] = [];
  const reach = async (p: PluginInfo) => {
    reached.push(p.id);
    return { ...p, url: `${ORIGIN}/plugins/${p.id}/` };
  };
  expect(await usablePlugins([draw, sameSite, bt3], ORIGIN, false, reach)).toEqual([
    draw,
    { ...bt3, url: `${ORIGIN}/plugins/bt3/`, icon: `${ORIGIN}/plugins/bt3/icon.svg` },
  ]);
  expect(reached).toEqual([]);
  // In Discord the external ones go through the proxy check; the built-in ones don't need it.
  const inDiscord = await usablePlugins([draw, bt3], ORIGIN, true, reach);
  expect(reached).toEqual(["drawspace"]);
  expect(inDiscord.map((p) => p.url)).toEqual([`${ORIGIN}/plugins/drawspace/`, `${ORIGIN}/plugins/bt3/`]);
  // Unreachable through the proxy: left out.
  expect(await usablePlugins([draw, bt3], ORIGIN, true, async () => null)).toEqual([
    { ...bt3, url: `${ORIGIN}/plugins/bt3/`, icon: `${ORIGIN}/plugins/bt3/icon.svg` },
  ]);
});
