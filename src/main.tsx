import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ensureSWRegistered } from "@/lib/push";

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker (only outside iframe/preview).
// Safe to call repeatedly — internally guards.
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    ensureSWRegistered();
  });
}
