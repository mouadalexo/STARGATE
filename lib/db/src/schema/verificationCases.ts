import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const verificationCasesTable = pgTable("verification_cases", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  memberId: text("member_id").notNull(),
  verifierId: text("verifier_id").notNull(),
  verifierUsername: text("verifier_username").notNull(),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
});

export type VerificationCase = typeof verificationCasesTable.$inferSelect;
export type InsertVerificationCase = typeof verificationCasesTable.$inferInsert;
