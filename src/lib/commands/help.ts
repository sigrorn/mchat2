// ------------------------------------------------------------------
// Component: Help text
// Responsibility: Return the full //help output listing all commands.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

export function formatHelp(): string {
  return `Message targeting
  @name message        Send to a specific persona
  @all message         Send to all personas
  @others message      Send to non-selected personas
  (no prefix)          Send to currently selected personas
  +name                Add persona to current selection
  -name                Remove persona from current selection

Available commands (prefixed with //):

Context & limits
  //limit N            Hide messages before user message #N
  //limit 0            Hide all current messages
  //limit NONE         Clear the limit
  //limitsize          Auto-set token budget to tightest provider
  //limitsize N        Set token budget to N thousand tokens

Pins
  //pin @name text     Pin a message for a persona
  //pin @all text      Pin a message for all personas
  //pins               List all pinned messages
  //pins name          List pins for a specific persona
  //unpin N            Unpin user message #N
  //unpin ALL          Remove all pins

Editing
  //edit               Edit the last user message
  //edit N             Edit user message #N
  //edit -N            Edit the Nth-from-last user message
  //pop                Remove the last user message and its responses
  //retry              Retry the last failed response

Display
  //lines              Line-by-line display (default)
  //cols               Side-by-side column display
  //visibility         Show current visibility settings
  //visibility full    All personas see all responses
  //visibility separated  Each persona sees only its own responses
  //visibility default Reset to persona visibility defaults

Selection
  //select name, ...   Set selection to listed personas
  //select ALL         Select all personas

Info
  //order              Show DAG execution order
  //personas           List active personas with details
  //stats              Show conversation token statistics
  //help               Show this help text
  //version            Show build version info

Maintenance
  //compact            Summarize conversation for each persona
  //autocompact N      Auto-compact when context reaches N k-tokens
  //autocompact N%     Auto-compact at N% of tightest model
  //autocompact off    Disable auto-compaction (default)
  //vacuum             Compact the SQLite database

Keyboard shortcuts
  Ctrl+F               Find in chat
  Ctrl+/-/0            Zoom in/out/reset
  Enter                Send message
  Shift+Enter          New line`;
}
