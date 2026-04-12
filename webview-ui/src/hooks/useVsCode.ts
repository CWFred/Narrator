interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function useVsCode(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}
