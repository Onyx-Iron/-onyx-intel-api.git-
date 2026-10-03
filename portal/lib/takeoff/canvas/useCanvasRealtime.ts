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
  const [peers, setPeers] = useState<CanvasPeer[]>([]);
  const [status, setStatus] = useState<CanvasRealtimeStatus>("off");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRemoteRef = useRef(onRemoteEvent);
  onRemoteRef.current = onRemoteEvent;

  const senderId = useMemo(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `est-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const color = useMemo(() => peerColorForKey(senderId), [senderId]);

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
    if (!enabled || !projectId || !pageId) {
      setStatus("off");
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    try {
      const supabase = createBrowserSupabaseClient();
      const topic = canvasChannelName(projectId, pageId);
      setStatus("connecting");

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
          const state = channel.presenceState() as Record<
            string,
            { metas?: Array<Record<string, unknown>> }
          >;
          setPeers(peersFromPresenceState(state, senderId));
        })
        .subscribe(async (subStatus) => {
          if (cancelled) return;
          if (subStatus === "SUBSCRIBED") {
            channelRef.current = channel;
            setStatus("live");
            await channel!.track({
              name: displayName,
              color,
              updatedAt: Date.now(),
            });
          } else if (
            subStatus === "CHANNEL_ERROR" ||
            subStatus === "TIMED_OUT"
          ) {
            setStatus("error");
          }
        });
    } catch {
      if (!cancelled) setStatus("error");
    }

    return () => {
      cancelled = true;
      channelRef.current = null;
      if (channel) {
        void createBrowserSupabaseClient().removeChannel(channel);
      }
      setPeers([]);
      setStatus("off");
    };
  }, [color, displayName, enabled, pageId, projectId, senderId]);

  return { peers, status, senderId, color, broadcast, trackCursor };
}
