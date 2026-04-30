import { useEffect, useState } from "react";

/**
 * Detects whether the app is running as an installed PWA
 * (added to home screen on iOS / installed on Android/desktop).
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const mql = window.matchMedia?.("(display-mode: standalone)");
    // iOS Safari exposes navigator.standalone
    const iosStandalone = (window.navigator as any).standalone === true;
    return !!mql?.matches || iosStandalone;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(display-mode: standalone)");
    const handler = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  return standalone;
}
