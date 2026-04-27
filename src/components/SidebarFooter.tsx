// ------------------------------------------------------------------
// Component: SidebarFooter
// Responsibility: The fixed bottom of Sidebar — Settings · General,
//                 Settings · Providers, the streaming response toggle,
//                 and the debug-session toggle. Extracted from Sidebar
//                 in #167 so the parent stays focused on the
//                 conversation list and high-level layout. The
//                 Settings · Providers button (#170) opens the unified
//                 native + openai-compat configuration dialog.
// Collaborators: Sidebar (parent), uiStore, SettingsDialog,
//                SettingsGeneralDialog.
// ------------------------------------------------------------------

import { useState } from "react";
import { useUiStore } from "@/stores/uiStore";
import { SettingsDialog } from "./SettingsDialog";
import { SettingsGeneralDialog } from "./SettingsGeneralDialog";
import { OutlineButton } from "@/components/ui/Button";

export function SidebarFooter(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  return (
    <>
      <OutlineButton
        onClick={() => setGeneralOpen(true)}
        size="md"
        className="mx-2 mt-2 !text-xs"
      >
        Settings · General
      </OutlineButton>
      <OutlineButton
        onClick={() => setSettingsOpen(true)}
        size="md"
        className="mx-2 mt-1 !text-xs"
      >
        Settings · Providers
      </OutlineButton>
      <StreamToggle />
      <DebugToggle />
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {generalOpen ? <SettingsGeneralDialog onClose={() => setGeneralOpen(false)} /> : null}
    </>
  );
}

function StreamToggle(): JSX.Element {
  const streaming = useUiStore((s) => s.streamResponses);
  const toggle = useUiStore((s) => s.toggleStreamResponses);
  const label = streaming ? "Responses · STREAM" : "Responses · BUFFER";
  return (
    <button
      onClick={toggle}
      title={
        streaming
          ? "Tokens appear live as they arrive. Click to buffer full responses before showing."
          : "Full responses appear once complete. Click to stream tokens live."
      }
      className={`mx-2 mt-1 rounded border px-3 py-1.5 text-xs ${
        streaming
          ? "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
          : "border-amber-600 text-amber-700 hover:bg-amber-50"
      }`}
    >
      {label}
    </button>
  );
}

function DebugToggle(): JSX.Element {
  const workingDir = useUiStore((s) => s.workingDir);
  const debug = useUiStore((s) => s.debugSession);
  const toggle = useUiStore((s) => s.toggleDebug);
  const disabled = !workingDir;
  const label = disabled
    ? "Debug · (set working directory first)"
    : debug.enabled
      ? `Debug · ON (${debug.sessionTimestamp})`
      : "Debug · OFF";
  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`mx-2 mb-2 mt-1 rounded border px-3 py-1.5 text-xs ${
        debug.enabled
          ? "border-green-600 text-green-700 hover:bg-green-50"
          : disabled
            ? "border-neutral-200 text-neutral-400"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}
