"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/common/Toast";
import type { GooglePickerResponse } from "@/lib/google/window";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

interface Props {
  onFilesSelected: (files: DriveFile[], accessToken: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
// drive.file (not drive.readonly): recommended for the Picker, not a restricted
// scope, so Workspace orgs that block restricted scopes don't auto-close consent.
// Grants the app access only to the files the user actually picks.
const SCOPES = "https://www.googleapis.com/auth/drive.file";

const ALLOWED_MIMES = [
  "application/pdf",
  "image/tiff",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/json",
].join(",");

function loadScript(src: string, onLoad: () => void) {
  if (document.querySelector(`script[src="${src}"]`)) {
    onLoad();
    return;
  }
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.defer = true;
  s.onload = onLoad;
  document.head.appendChild(s);
}

export default function GoogleDrivePicker({ onFilesSelected, disabled, children }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const tokenClientRef = useRef<{ requestAccessToken: (overrides?: { prompt?: string }) => void } | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const onFilesRef = useRef(onFilesSelected);

  useEffect(() => {
    onFilesRef.current = onFilesSelected;
  }, [onFilesSelected]);

  const openPicker = useCallback((token: string) => {
    const pickerApi = window.google?.picker;
    if (!pickerApi) {
      setLoading(false);
      toast({ title: String("Google Drive picker is still loading. Try again in a second."), kind: "info" });
      return;
    }

    const view = new pickerApi.DocsView().setMimeTypes(ALLOWED_MIMES);
    const picker = new pickerApi.PickerBuilder()
      .addView(view)
      .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setTitle("Select plan files")
      .setCallback((data: GooglePickerResponse) => {
        if (data.action === pickerApi.Action.PICKED && data.docs?.length) {
          onFilesRef.current(
            data.docs.map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes })),
            token,
          );
        }
      })
      .build();

    picker.setVisible(true);
    setLoading(false);
  }, [toast]);

  const requestToken = useCallback(() => {
    if (!tokenClientRef.current) {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        setLoading(false);
        toast({ title: String("Google sign-in is still loading. Try again in a second."), kind: "info" });
        return;
      }

      tokenClientRef.current = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.access_token) {
            accessTokenRef.current = resp.access_token;
            window.gapi?.load("picker", () => openPicker(resp.access_token!));
          } else if (resp.error) {
            setLoading(false);
            toast({
              title: String(`Google sign-in failed: ${resp.error}.`),
              description: "Click Connect Google in the project header or Documents tab, then open Import from Drive again.",
              kind: "error",
            });
          }
          setLoading(false);
        },
        error_callback: (err: { type?: string; message?: string }) => {
          setLoading(false);
          if (err?.type !== "popup_closed") {
            toast({
              title: String(`Google Drive connection error: ${err?.message ?? err?.type ?? "unknown"}.`),
              description: "Click Connect Google in the project header or Documents tab, then open Import from Drive again.",
              kind: "error",
            });
          }
        },
      });
    }
    tokenClientRef.current?.requestAccessToken();
  }, [openPicker, toast]);

  useEffect(() => {
    loadScript("https://apis.google.com/js/api.js", () => { window.__gapiLoaded = true; });
    loadScript("https://accounts.google.com/gsi/client", () => { window.__gisLoaded = true; });
  }, []);

  const handleClick = useCallback(() => {
    if (disabled || loading) return;

    if (accessTokenRef.current && window.gapi) {
      setLoading(true);
      window.gapi.load("picker", () => openPicker(accessTokenRef.current!));
      return;
    }

    if (!window.google?.accounts?.oauth2) {
      toast({
        title: String("Still connecting to Google Drive."),
        description: "Give it a second, then click Connect Google or Import from Drive again.",
        kind: "info",
      });
      return;
    }

    setLoading(true);
    requestToken();
  }, [disabled, loading, openPicker, requestToken, toast]);

  return <div onClick={handleClick} className="contents cursor-pointer">{children}</div>;
}
