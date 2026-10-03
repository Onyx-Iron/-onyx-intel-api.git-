// Shared ambient declarations for the Google JS globals (Drive Picker, GIS
// OAuth2, Places Autocomplete) that get loaded via <script> tags rather than
// npm packages. Consolidated here because TypeScript requires every
// `declare global { interface Window }` augmentation across the project to
// merge into one identical shape -- having two components independently
// declare `Window.google` with different (non-overlapping) properties is a
// compile error, not just a lint nit.

interface GooglePickerBuilder {
  addView(view: GoogleDocsView): GooglePickerBuilder;
  enableFeature(feature: string): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setCallback(cb: (data: GooglePickerResponse) => void): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  build(): { setVisible: (v: boolean) => void };
}

interface GoogleDocsView {
  setMimeTypes(types: string): GoogleDocsView;
}

interface GooglePickerResponse {
  action: string;
  docs?: Array<{ id: string; name: string; mimeType: string; sizeBytes?: number }>;
}

interface GooglePlacesAutocomplete {
  addListener: (event: string, cb: () => void) => void;
  getPlace: () => {
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    geometry?: { location?: { lat: () => number; lng: () => number } };
    formatted_address?: string;
  };
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
            /** GIS defaults to true; set false so prior grants are not merged. */
            include_granted_scopes?: boolean;
            callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (overrides?: { prompt?: string }) => void };
        };
      };
      picker?: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new () => GoogleDocsView;
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
      };
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: { types?: string[]; componentRestrictions?: { country?: string | string[] } },
          ) => GooglePlacesAutocomplete;
        };
      };
    };
    __gapiLoaded?: boolean;
    __gisLoaded?: boolean;
  }
}

export type { GooglePickerBuilder, GoogleDocsView, GooglePickerResponse, GooglePlacesAutocomplete };
