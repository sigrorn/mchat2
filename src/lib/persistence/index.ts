// ------------------------------------------------------------------
// Component: Persistence barrel
// Responsibility: Public entry point for SQLite repositories
// ------------------------------------------------------------------

export { runMigrations, MIGRATIONS } from "./migrations";
export { newConversationId, newPersonaId, newMessageId } from "./ids";
export * as conversationsRepo from "./conversations";
export * as personasRepo from "./personas";
export * as messagesRepo from "./messages";
export * as settingsRepo from "./settings";
