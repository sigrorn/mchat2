// ------------------------------------------------------------------
// Component: Trace file sink
// Responsibility: Concrete TraceSink that appends rows to the user's
//                 working-dir-based trace file (#46 redesign).
//                 Filename format:
//                   {sessionTs}-{conversationId}-{personaSlug}.txt
// Collaborators: streamRunner (consumer), tauri/filesystem (writer).
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import type { TraceSink } from "../orchestration/streamRunner";
import { buildTraceFilename } from "./traceFilename";
import { resolveTraceBaseDir } from "./traceBaseDir";

export interface TraceFileSinkOptions {
  // null/undefined = no explicit working dir → fall back to app-data
  // dir (#305). Resolved lazily on first write so the Tauri path call
  // never happens for sessions that produce no trace rows.
  workingDir: string | null;
  sessionTimestamp: string;
  conversationId: string;
  slug: string;
}

export function makeTraceFileSink(opts: TraceFileSinkOptions): TraceSink {
  const filename = buildTraceFilename(opts.sessionTimestamp, opts.conversationId, opts.slug);
  let ready: { path: string } | null = null;
  // Resolve the base dir + mkdir exactly once, on the first row written.
  const ensureReady = async (): Promise<{ path: string }> => {
    if (ready) return ready;
    const base = await resolveTraceBaseDir(opts.workingDir);
    const debugDir = `${base}/debug`;
    await fs.mkdir(debugDir);
    ready = { path: `${debugDir}/${filename}` };
    return ready;
  };
  return {
    async outbound(rows) {
      if (rows.length === 0) return;
      const { path } = await ensureReady();
      await fs.appendText(path, rows.join("\n") + "\n");
    },
    async inbound(rows) {
      if (rows.length === 0) return;
      const { path } = await ensureReady();
      await fs.appendText(path, rows.join("\n") + "\n");
    },
  };
}
