"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/common/Toast";

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

declare global {
  interface Window {
    gapi?: {
      load: (api: string, cb: () => void) => void;
    };
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (opts: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (overrides?: { prompt?: string }) => void };
        };
      };
      picker?: {
        PickerBuilder: new () => PickerBuilder;
        DocsView: new () => DocsView;
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
      };
    };
    __gapiLoaded?: boolean;
    __gisLoaded?: boolean;
  }
}

interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  build(): { setVisible: (v: boolean) => void };
}

interface DocsView {
  setMimeTypes(types: string): DocsView;
}

interface PickerResponse {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string; sizeBytes?: number }>;
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY   = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
// drive.file (not drive.readonly): recommended for the Picker, NOT a restricted
// scope — so Workspace orgs that block restricted scopes don't auto-close consent.
// Grants the app access only to the files the user actually picks.
const SCOPES    = "https://www.googleapis.com/auth/drive.file";

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

    const view = new pickerApi.DocsView()
      .setMimeTypes(ALLOWED_MIMES);

    const picker = new pickerApi.PickerBuilder()
      .addView(view)
      .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setTitle("Select plan files")
      .setCallback((data: PickerResponse) => {
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
  }, []);

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
            // Load picker API then open
            window.gapi?.load("picker", () => openPicker(resp.access_token!));
          } else if (resp.error) {
            setLoading(false);
            toast({ title: String(`Google sign-in failed: ${resp.error}. If it closes immediately, your Google Workspace may be blocking app access — tell me and I'll walk you through trusting the app.`), kind: "error" });
          }
          setLoading(false);
        },
        error_callback: (err: { type?: string; message?: string }) => {
          setLoading(false);
          if (err?.type !== "popup_closed") {
            toast({ title: String(`Google Drive connection error: ${err?.message ?? err?.type ?? "unknown"}.`), kind: "error" });
          }
        },
      });
    }
    tokenClientRef.current?.requestAccessToken();
  }, [openPicker]);

  // Preload Google's scripts on mount. The OAuth popup must open synchronously
  // inside the click event — if we instead load scripts on click and open the
  // popup from their async onload, the browser blocks it (silently). Preloading
  // means the scripts are ready by click time, so the popup opens in the gesture.
  useEffect(() => {
    loadScript("https://apis.google.com/js/api.js", () => { window.__gapiLoaded = true; });
    loadScript("https://accounts.google.com/gsi/client", () => { window.__gisLoaded = true; });
  }, []);

  const handleClick = useCallback(() => {
    if (disabled || loading) return;

    // Already have a token → just (re)open the picker.
    if (accessTokenRef.current && window.gapi) {
      setLoading(true);
      window.gapi.load("picker", () => openPicker(accessTokenRef.current!));
      return;
    }

    // Scripts not ready yet (clicked within a split-second of page load).
    if (!window.google?.accounts?.oauth2) {
      toast({ title: String("Still connecting to Google Drive — give it a second and click again."), kind: "info" });
      return;
    }

    // Request the token NOW, synchronously, so the sign-in popup isn't blocked.
    setLoading(true);
    requestToken();
  }, [disabled, loading, openPicker, requestToken]);

  return (
    <div onClick={handleClick} className="contents cursor-pointer">
      {children}
    </div>
  );
}
