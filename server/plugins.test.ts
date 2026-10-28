import { expect, test } from "bun:test";
import { parseManifest } from "./plugins";

const base = new URL("https://draw.example.com/app/");

test("manifest: entry and icon must stay on the plugin's origin", () => {
  expect(parseManifest({ id: "drawspace", name: "Drawspace", icon: "icon.svg" }, base)).toEqual({
    id: "drawspace",
    name: "Drawspace",
    description: "",
    icon: "https://draw.example.com/app/icon.svg",
    url: "https://draw.example.com/app/",
  });
  expect(parseManifest({ id: "x", name: "X", entry: "https://evil.example.com/" }, base)).toBeNull();
  expect(parseManifest({ id: "x", name: "X", icon: "https://evil.example.com/a.png" }, base)?.icon).toBeNull();
  expect(parseManifest({ id: "Bad Id", name: "X" }, base)).toBeNull();
  expect(parseManifest(null, base)).toBeNull();
});
