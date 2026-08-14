"use client";

import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 60_000;

export default function DeploymentVersionGuard({ version }: { version: string }) {
  const currentVersionRef = useRef(version);

  useEffect(() => {
    currentVersionRef.current = version;
  }, [version]);

  useEffect(() => {
    let cancelled = false;

    const checkVersion = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/version?ts=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({})) as { version?: string };
        const nextVersion = typeof data.version === "string" ? data.version : null;
        if (nextVersion && nextVersion !== currentVersionRef.current) {
          window.location.reload();
        }
      } catch {
        // Ignore transient polling failures.
      }
    };

    const interval = window.setInterval(() => {
      void checkVersion();
    }, POLL_INTERVAL_MS);

    const refreshOnFocus = () => void checkVersion();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, []);

  return null;
}
