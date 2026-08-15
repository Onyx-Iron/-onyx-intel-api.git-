"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

type OpenAIAdsQueue = ((...args: unknown[]) => void) & {
  q?: unknown[][];
};

declare global {
  interface Window {
    oaiq?: OpenAIAdsQueue;
  }
}

const pixelId = process.env.NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID;
const sdkUrl = "https://bzrcdn.openai.com/sdk/oaiq.min.js";

let initializedPixelId: string | null = null;
let lastMeasuredPath: string | null = null;

function getOrCreateQueue() {
  if (window.oaiq) return window.oaiq;

  const queue = ((...args: unknown[]) => {
    queue.q?.push(args);
  }) as OpenAIAdsQueue;
  queue.q = [];
  window.oaiq = queue;

  const script = document.createElement("script");
  script.async = true;
  script.src = sdkUrl;
  document.head.appendChild(script);

  return queue;
}

export function OpenAIAdsPixel() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pixelId || !pathname) return;

    try {
      const oaiq = getOrCreateQueue();

      if (initializedPixelId !== pixelId) {
        oaiq("init", { pixelId });
        initializedPixelId = pixelId;
      }

      if (lastMeasuredPath === pathname) return;

      oaiq("measure", "page_viewed", {
        type: "contents",
        contents: [
          {
            id: pathname,
            name: document.title || pathname,
            content_type: "page",
          },
        ],
      });
      lastMeasuredPath = pathname;
    } catch {
      // Measurement must never interrupt the product flow.
    }
  }, [pathname]);

  return null;
}
