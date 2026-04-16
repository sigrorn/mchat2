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

export interface TraceFileSinkOptions {
  workingDir: string;
  sessionTimestamp: string;
  conversationId: string;
  slug: string;
}

export function makeTraceFileSink(opts: TraceFileSinkOptions): TraceSink {
  const filename = buildTraceFilename(opts.sessionTimestamp, opts.conversationId, opts.slug);
  const path = `${opts.workingDir}/${filename}`;
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
