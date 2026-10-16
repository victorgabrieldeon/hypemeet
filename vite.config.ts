import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// LAN=1 serves over HTTPS (self-signed) so other devices on the network get camera/screen access,
// which browsers only allow on localhost or HTTPS.
const lan = process.env.LAN === "1";

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(lan ? [basicSsl()] : [])],
  server: {
    host: true,
    // Testing the Discord Activity: Discord's proxy reaches the dev server through a cloudflared tunnel.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": "http://localhost:3001",
      // LiveKit signaling rides the page's own origin (ws:// or wss://), so it works from any device
      // without mixed-content errors or exposing port 7880. Media still flows over UDP 7882.
      "/rtc": { target: "http://localhost:7880", ws: true },
    },
  },
});
