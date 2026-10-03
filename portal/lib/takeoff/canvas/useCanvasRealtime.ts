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

type AuthPayload = {
  ok: boolean;
  topic: string;
  displayName: string;
  senderId: string;
  token: string | null;
  privateChannel: boolean;
};

/**
 * Supabase Realtime broadcast + presence for multi-estimator sheet canvas.
 * Channel: canvas:{projectId}:{pageId}
 *
 * Joins only after Clerk-authenticated preflight. When the API returns a
 * JWT, the channel is opened as private (Realtime Authorization).
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
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [resolvedName, setResolvedName] = useState(displayName);
  const [senderId, setSenderId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `est-${Math.random().toString(36).slice(2, 10)}`,
  );
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onRemoteRef = useRef(onRemoteEvent);

  useEffect(() => {
    onRemoteRef.current = onRemoteEvent;
  }, [onRemoteEvent]);

  useEffect(() => {
    setResolvedName(displayName);
  }, [displayName]);

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
        name: resolvedName,
        color,
        x,
        y,
        updatedAt: Date.now(),
      });
    },
    [color, resolvedName],
  );

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: number | null = null;

    async function join() {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset connection phase when (re)joining
      setConnectionStatus("connecting");

      let auth: AuthPayload | null = null;
      try {
        const res = await fetch("/api/takeoff/canvas/realtime-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, page_id: pageId }),
        });
        if (!res.ok) throw new Error(`realtime-auth ${res.status}`);
        auth = (await res.json()) as AuthPayload;
      } catch {
        if (!cancelled) setConnectionStatus("error");
        return;
      }
      if (cancelled || !auth?.ok) {
        if (!cancelled) setConnectionStatus("error");
        return;
      }

      setResolvedName(auth.displayName || displayName);
      setSenderId(auth.senderId);
      const presenceKey = auth.senderId;
      const peerName = auth.displayName || displayName;

      try {
        const supabase = createBrowserSupabaseClient();
        if (auth.token) {
          await supabase.realtime.setAuth(auth.token);
        }

        const topic = auth.topic || canvasChannelName(projectId, pageId);
        channel = supabase.channel(topic, {
          config: {
            broadcast: { self: false },
            presence: { key: presenceKey },
            private: Boolean(auth.privateChannel && auth.token),
          },
        });

        channel
          .on("broadcast", { event: "canvas" }, ({ payload }) => {
            const event = payload as CanvasCollabEvent;
            if (!event || event.senderId === presenceKey) return;
            onRemoteRef.current(event);
          })
          .on("presence", { event: "sync" }, () => {
            if (!channel) return;
            setPeers(peersFromPresenceState(channel.presenceState(), presenceKey));
          })
          .subscribe(async (subStatus) => {
            if (cancelled) return;
            if (subStatus === "SUBSCRIBED") {
              channelRef.current = channel;
              setConnectionStatus("live");
              await channel!.track({
                name: peerName,
                color: peerColorForKey(presenceKey),
                updatedAt: Date.now(),
              });
            } else if (
              subStatus === "CHANNEL_ERROR" ||
              subStatus === "TIMED_OUT" ||
              subStatus === "CLOSED"
            ) {
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
    }

    void join();

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
  }, [active, displayName, pageId, projectId, reconnectNonce]);

  return { peers, status, senderId, color, broadcast, trackCursor };
}
