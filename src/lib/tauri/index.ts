// ------------------------------------------------------------------
// Component: Tauri barrel
// Responsibility: Re-export the Tauri abstraction surface. Anything
//                 outside lib/tauri/ imports from here or from the
//                 named modules — never from @tauri-apps/* directly.
// Collaborators: every module that touches native capabilities.
// ------------------------------------------------------------------

export { streamSSE, request, HttpError } from "./http";
export type {
  SSEEvent,
  StreamSSEOptions,
  HttpRequestOptions,
  HttpResponse,
  HttpImpl,
} from "./http";
export { keychain } from "./keychain";
export type { KeychainImpl } from "./keychain";
export { sql } from "./sql";
export type { SqlImpl } from "./sql";
export { fs } from "./filesystem";
export type { FsImpl, SaveDialogOptions, OpenDialogOptions } from "./filesystem";
export { lifecycle } from "./lifecycle";
export type { LifecycleImpl } from "./lifecycle";
