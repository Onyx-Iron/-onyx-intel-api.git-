"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  canvasChannelName,
  peersFromPresenceState,
  peerColorForKey,
  type CanvasCollabEvent,
  type CanvasCollabKind,
  type CanvasPeer,
} from "./canvas-realtime";

type Options = {
  projectId: string;
  pageId: string;
  displayName?: string;
  enabled?: boolean;
  onRemoteEvent: (event: CanvasCollabEvent) => void;
};

export type CanvasRealtimeStatus = "off" | "connecting" | "live" | "error";

/**
 * Supabase Realtime broadcast + presence for multi-estimator sheet canvas.
 * Channel: canvas:{projectId}:{pageId}
 */
export function useCanvasRealtime({
  projectId,
  pageId,
  displayName = "Estimator",
  enabled = true,
  onRemoteEvent,
}: Options) {
  const active = Boolean(enabled && projectId && pageId);
  const [peers, setPeers] = useState<CanvasPeer[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    Exclude<CanvasRealtimeStatus, "off">
  >("connecting");
  // Bumped on channel CLOSE/ERROR so the effect tears down and resubscribes.
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRemoteRef = useRef(onRemoteEvent);
  // Stable per-mount presence key — lazy useState avoids impure useMemo/refs-during-render.
  const [senderId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `est-${Math.random().toString(36).slice(2, 10)}`,
  );

  useEffect(() => {
    onRemoteRef.current = onRemoteEvent;
  }, [onRemoteEvent]);

  const color = useMemo(() => peerColorForKey(senderId), [senderId]);
  const status: CanvasRealtimeStatus = active ? connectionStatus : "off";

  const broadcast = useCallback(
    (kind: CanvasCollabKind, payload: unknown) => {
      const channel = channelRef.current;
      if (!channel) return;
      const event: CanvasCollabEvent = {
        kind,
        senderId,
        payload,
        ts: Date.now(),
      };
      void channel.send({
        type: "broadcast",
        event: "canvas",
        payload: event,
      });
    },
    [senderId],
  );

  const trackCursor = useCallback(
    (x: number, y: number) => {
      const channel = channelRef.current;
      if (!channel) return;
      void channel.track({
        name: displayName,
        color,
        x,
        y,
        updatedAt: Date.now(),
      });
    },
    [color, displayName],
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: number | null = null;

    try {
      const supabase = createBrowserSupabaseClient();
      const topic = canvasChannelName(projectId, pageId);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset connection phase when (re)joining the channel
      setConnectionStatus("connecting");

      channel = supabase.channel(topic, {
        config: {
          broadcast: { self: false },
          presence: { key: senderId },
        },
      });

      channel
        .on("broadcast", { event: "canvas" }, ({ payload }) => {
          const event = payload as CanvasCollabEvent;
          if (!event || event.senderId === senderId) return;
          onRemoteRef.current(event);
        })
        .on("presence", { event: "sync" }, () => {
          if (!channel) return;
          setPeers(peersFromPresenceState(channel.presenceState(), senderId));
        })
        .subscribe(async (subStatus) => {
          if (cancelled) return;
          if (subStatus === "SUBSCRIBED") {
            channelRef.current = channel;
            setConnectionStatus("live");
            await channel!.track({
              name: displayName,
              color,
              updatedAt: Date.now(),
            });
          } else if (
            subStatus === "CHANNEL_ERROR" ||
            subStatus === "TIMED_OUT" ||
            subStatus === "CLOSED"
          ) {
            // Drop the dead channel so broadcast/trackCursor no-op instead of
            // silently sending into a closed socket; reconnect after a short backoff.
            channelRef.current = null;
            setConnectionStatus("error");
            if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
            reconnectTimer = window.setTimeout(() => {
              if (cancelled) return;
              setReconnectNonce((n) => n + 1);
            }, 2000) as unknown as number;
          }
        });
    } catch {
      if (!cancelled) setConnectionStatus("error");
    }

    return () => {
      cancelled = true;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      channelRef.current = null;
      if (channel) {
        void createBrowserSupabaseClient().removeChannel(channel);
      }
      setPeers([]);
      setConnectionStatus("connecting");
    };
  }, [active, color, displayName, pageId, projectId, reconnectNonce, senderId]);

  return { peers, status, senderId, color, broadcast, trackCursor };
}
