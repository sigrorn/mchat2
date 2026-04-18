// ------------------------------------------------------------------
// Component: Filesystem
// Responsibility: Read/write user-facing files (exports, imports) and
//                 app-data files (config). Routes all FS I/O through
//                 Tauri's fs plugin so scope/capabilities are enforced.
// Collaborators: rendering/htmlExport.ts, config.ts, import/export UI.
// ------------------------------------------------------------------

export interface FsImpl {
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  appendText(path: string, contents: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, contents: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  copyFile(src: string, dst: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  saveDialog(opts: SaveDialogOptions): Promise<string | null>;
  openDialog(opts: OpenDialogOptions): Promise<string | null>;
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface OpenDialogOptions {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

const defaultImpl: FsImpl = {
  async readText(path) {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs.readTextFile(path);
  },
  async writeText(path, contents) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeTextFile(path, contents);
  },
  async appendText(path, contents) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeTextFile(path, contents, { append: true });
  },
  async readBinary(path) {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs.readFile(path);
  },
  async writeBinary(path, contents) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeFile(path, contents);
  },
  async exists(path) {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs.exists(path);
  },
  async mkdir(path) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.mkdir(path, { recursive: true });
  },
  async copyFile(src, dst) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.copyFile(src, dst);
  },
  async removeFile(path) {
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.remove(path);
  },
  async saveDialog(opts) {
    const d = await import("@tauri-apps/plugin-dialog");
    const o: Parameters<typeof d.save>[0] = {};
    if (opts.defaultPath !== undefined) o.defaultPath = opts.defaultPath;
    if (opts.filters !== undefined) o.filters = opts.filters;
    const r = await d.save(o);
    return r ?? null;
  },
  async openDialog(opts) {
    const d = await import("@tauri-apps/plugin-dialog");
    const o: Parameters<typeof d.open>[0] = { multiple: false, directory: false };
    if (opts.defaultPath !== undefined) o.defaultPath = opts.defaultPath;
    if (opts.filters !== undefined) o.filters = opts.filters;
    const r = await d.open(o);
    return typeof r === "string" ? r : null;
  },
};

let impl: FsImpl = defaultImpl;

export const fs = {
  readText: (p: string) => impl.readText(p),
  writeText: (p: string, c: string) => impl.writeText(p, c),
  appendText: (p: string, c: string) => impl.appendText(p, c),
  readBinary: (p: string) => impl.readBinary(p),
  writeBinary: (p: string, c: Uint8Array) => impl.writeBinary(p, c),
  exists: (p: string) => impl.exists(p),
  mkdir: (p: string) => impl.mkdir(p),
  copyFile: (s: string, d: string) => impl.copyFile(s, d),
  removeFile: (p: string) => impl.removeFile(p),
  saveDialog: (o: SaveDialogOptions) => impl.saveDialog(o),
  openDialog: (o: OpenDialogOptions) => impl.openDialog(o),
};

export function __setImpl(mock: FsImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
