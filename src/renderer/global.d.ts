export {};

declare global {
  interface Window {
    api: import("../preload/preload").DesktopApi;
  }
}
