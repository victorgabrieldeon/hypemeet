import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { HomePage } from "./pages/HomePage";
import { DownloadPage } from "./pages/DownloadPage";
import { inDiscord } from "./lib/discord";

// livekit-client is most of the bundle; only fetch it when entering a room.
const RoomPage = lazy(() => import("./pages/RoomPage").then((m) => ({ default: m.RoomPage })));
// Inside Discord the page is the Activity (and only there does the Discord SDK get loaded).
const DiscordActivity = lazy(() => import("./pages/DiscordActivity").then((m) => ({ default: m.DiscordActivity })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {inDiscord ? (
        <Suspense fallback={null}>
          <DiscordActivity />
        </Suspense>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/baixar" element={<DownloadPage />} />
          <Route
            path="/r/:code"
            element={
              <Suspense fallback={null}>
                <RoomPage />
              </Suspense>
            }
          />
          <Route path="*" element={<HomePage />} />
        </Routes>
      )}
    </BrowserRouter>
  </StrictMode>,
);
