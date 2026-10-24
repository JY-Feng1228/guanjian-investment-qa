import { sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const records = sqliteTable("qa_records", {
  sandbox: text("sandbox").notNull(),
  id: text("id").notNull(),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({columns:[table.sandbox,table.id]}),index("qa_sandbox_kind").on(table.sandbox,table.kind)]);
