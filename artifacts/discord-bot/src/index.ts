import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { registerVerificationModule } from "./modules/verification/index.js";
import { registerPanelCommands } from "./panels/index.js";

process.on("unhandledRejection", (reason) => {
  console.error("[Stargate] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Stargate] Uncaught exception:", err);
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error("[Stargate] ERROR: DISCORD_TOKEN is not set. Bot cannot connect.");
  process.exit(1);
}

console.log(`[Stargate] DISCORD_TOKEN present: ${!!token}`);
console.log(`[Stargate] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
  ],
});

setImmediate(() => {
  registerVerificationModule(client);
});

client.once("clientReady", async () => {
  console.log(`[Stargate] Online as ${client.user?.tag}`);
  console.log(`[Stargate] Serving ${client.guilds.cache.size} guild(s)`);

  try {
    client.user?.setPresence({
      activities: [{ name: "Stargate Verification", type: ActivityType.Watching }],
      status: "online",
    });
  } catch (err) {
    console.warn("[Stargate] Could not set presence:", err);
  }

  try {
    await registerPanelCommands(client);
    console.log("[Stargate] Commands registered successfully");
  } catch (err) {
    console.error("[Stargate] Error registering commands:", err);
  }
});

client.on("error", (err) => {
  console.error("[Stargate] Client error:", err);
});

client.on("warn", (msg) => {
  console.warn("[Stargate] Warning:", msg);
});

client.on("shardReconnecting" as any, () => {
  console.log("[Stargate] Reconnecting to Discord gateway...");
});

client.on("shardResume" as any, () => {
  console.log("[Stargate] Resumed Discord gateway connection.");
});

console.log("[Stargate] Attempting Discord login...");
client.login(token).catch((err) => {
  console.error("[Stargate] Login failed:", err?.code, err?.message ?? err);
  process.exit(1);
});

setTimeout(() => {
  if (!client.isReady()) {
    console.error("[Stargate] WARNING: Not connected after 30 seconds. Token may be invalid.");
  }
}, 30000);
