import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull().unique(),
  unverifiedRoleId: text("unverified_role_id"),
  verifiedRoleId: text("verified_role_id"),
  jailRoleId: text("jail_role_id"),
  verificatorsRoleId: text("verificators_role_id"),
  verificationLogsChannelId: text("verification_logs_channel_id"),
  verificationRequestsChannelId: text("verification_requests_channel_id"),
  assistanceCategoryId: text("assistance_category_id"),
  staffRoleId: text("staff_role_id"),
  verificationQuestions: text("verification_questions"),
  panelEmbedTitle: text("panel_embed_title"),
  panelEmbedDescription: text("panel_embed_description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type BotConfig = typeof botConfigTable.$inferSelect;
export type InsertBotConfig = typeof botConfigTable.$inferInsert;
