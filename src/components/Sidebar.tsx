// ------------------------------------------------------------------
// Component: Sidebar
// Responsibility: Conversation list + new-conversation button. Pure
//                 presentation — drives the conversationsStore.
// ------------------------------------------------------------------

import { useConversationsStore } from "@/stores/conversationsStore";

export function Sidebar(): JSX.Element {
  const conversations = useConversationsStore((s) => s.conversations);
  const currentId = useConversationsStore((s) => s.currentId);
  const select = useConversationsStore((s) => s.select);
  const create = useConversationsStore((s) => s.create);

  const onNew = async (): Promise<void> => {
    await create({
      title: "New conversation",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
    });
  };

  return (
    <aside className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50">
      <button
        onClick={onNew}
        className="m-2 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700"
      >
        New conversation
      </button>
      <ul className="flex-1 overflow-auto">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => select(c.id)}
              className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-neutral-200 ${
                currentId === c.id ? "bg-neutral-200 font-medium" : ""
              }`}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
