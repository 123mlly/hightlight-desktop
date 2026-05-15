import type { DesktopApi } from "../preload/preload";

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
