import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import "./index.css";
import { AppShell } from "./components/AppShell";
import { HomePage } from "./pages/HomePage";
import { DownloadPage } from "./pages/DownloadPage";
import { normalizeCode } from "./lib/code";
import { inDiscord } from "./lib/discord";

// livekit-client is most of the bundle; only fetch it when entering a room.
const RoomPage = lazy(() => import("./pages/RoomPage").then((m) => ({ default: m.RoomPage })));
const CastPage = lazy(() => import("./pages/CastPage").then((m) => ({ default: m.CastPage })));
// Inside Discord the page is the Activity (and only there does the Discord SDK get loaded).
const DiscordActivity = lazy(() => import("./pages/DiscordActivity").then((m) => ({ default: m.DiscordActivity })));

// The sidebar moves between rooms without leaving the route: a fresh RoomPage per code drops the last call at once.
// Keyed by the normalized code, so /r/abc-def → /r/ABCDEF (the same room) keeps the call.
function RoomRoute() {
  const { code } = useParams();
  return <RoomPage key={normalizeCode(code ?? "")} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {inDiscord ? (
        <Suspense fallback={null}>
          <DiscordActivity />
        </Suspense>
      ) : (
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/r/:code"
              element={
                <Suspense fallback={null}>
                  <RoomRoute />
                </Suspense>
              }
            />
            <Route path="*" element={<HomePage />} />
          </Route>
          <Route path="/baixar" element={<DownloadPage />} />
          <Route
            path="/transmitir"
            element={
              <Suspense fallback={null}>
                <CastPage />
              </Suspense>
            }
          />
        </Routes>
      )}
    </BrowserRouter>
  </StrictMode>,
);
