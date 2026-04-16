// ------------------------------------------------------------------
// Component: Trace file sink
// Responsibility: Concrete TraceSink that appends rows to
//                 ${appData}/traces/{slug}.txt. Created on demand by
//                 useSend when the debug.tracePersonas setting is on.
// Collaborators: streamRunner (consumer), tauri/filesystem (writer).
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import type { TraceSink } from "../orchestration/streamRunner";

export interface TraceFileSinkOptions {
  // Identifier used as the filename. Pass persona.nameSlug when
  // available; falls back to the persona key for bare-provider sends.
  slug: string;
}

let cachedDir: Promise<string> | null = null;

async function tracesDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  cachedDir = (async () => {
    const { appDataDir } = await import("@tauri-apps/api/path");
    const { mkdir, exists } = await import("@tauri-apps/plugin-fs");
    const root = await appDataDir();
    const dir = `${root}/traces`;
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  })();
  return cachedDir;
}

export async function makeTraceFileSink(opts: TraceFileSinkOptions): Promise<TraceSink> {
  const dir = await tracesDir();
  const path = `${dir}/${opts.slug}.txt`;
  return {
    async outbound(rows) {
      if (rows.length === 0) return;
      await fs.appendText(path, rows.join("\n") + "\n");
    },
    async inbound(rows) {
      if (rows.length === 0) return;
      await fs.appendText(path, rows.join("\n") + "\n");
    },
  };
}
