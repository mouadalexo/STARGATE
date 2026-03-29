import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonInteraction,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  TextChannel,
  ChannelType,
  RoleSelectMenuBuilder,
} from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import { db } from "@stargate/db";
import { botConfigTable } from "@stargate/db";
import { eq } from "drizzle-orm";
import {
  openVerifyPanel,
  verifyPanelState,
  handleVerifyPanelSelect,
  handleVerifyPanelSave,
  handleVerifyPanelReset,
  openEditQuestionsModal,
  handleEditQuestionsSubmit,
  openEmbedCustomizeModal,
  handleEmbedCustomizeSubmit,
  handleEmbedPreviewBack,
  buildStaffSubPanel,
  handleStaffPanelDone,
} from "./verification.js";
import { deployVerificationPanel } from "../modules/verification/index.js";

function buildDeployChannelSelect() {
  return {
    embed: new EmbedBuilder()
      .setColor(0x5000ff)
      .setTitle("📌 Post Verification Panel")
      .setDescription("Select the channel to post the verification button in.")
      .setFooter({ text: "Stargate • Setup" }),
    row: new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("deploy_verify_channel")
        .setPlaceholder("Select a channel...")
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
  };
}

function buildAutorolePanel(memberRoleId: string | null, botRoleId: string | null) {
  const embed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Autorole Settings")
    .setDescription("Use the menus below to set roles given automatically when someone joins.")
    .addFields(
      { name: "Member Role", value: memberRoleId ? `<@&${memberRoleId}>` : "Not set", inline: true },
      { name: "Bot Role", value: botRoleId ? `<@&${botRoleId}>` : "Not set", inline: true },
    )
    .setFooter({ text: "Stargate • Autorole" });

  const memberRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("autorole_member_role")
      .setPlaceholder(memberRoleId ? "Change member autorole..." : "Set member autorole...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  const botRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("autorole_bot_role")
      .setPlaceholder(botRoleId ? "Change bot autorole..." : "Set bot autorole...")
      .setMinValues(1)
      .setMaxValues(1)
  );

  return { embeds: [embed], components: [memberRow, botRow] };
}

export async function registerPanelCommands(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is missing");

  const setupCommand = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Stargate verification")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) =>
      sub.setName("verification").setDescription("Set up the Stargate verification system")
    )
    .toJSON();

  const helpCommand = new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show Stargate commands")
    .toJSON();

  const autoroleCommand = new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Set automatic roles for new members and bots on join")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

  const pingCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Stargate bot latency")
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, helpCommand, autoroleCommand, pingCommand],
      });
      console.log(`[Stargate] Registered commands for guild: ${guildName}`);
    } catch (err) {
      console.error(`[Stargate] Failed to register commands for guild ${guildName}:`, err);
    }
  };

  for (const guild of client.guilds.cache.values()) {
    await registerForGuild(guild.id, guild.name);
  }

  client.on("guildCreate", async (guild) => {
    await registerForGuild(guild.id, guild.name);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;
    if (!isMainGuild(interaction.guild.id)) return;

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (name === "setup") {
        await handleSetupCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "autorole") {
        await handleAutoroleCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "ping") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setDescription(`Latency: **${Math.round(interaction.client.ws.ping)}ms**`)
              .setFooter({ text: "Stargate • Verification Bot" }),
          ],
          ephemeral: true,
        });
      } else if (name === "help") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setTitle("Stargate — Commands")
              .addFields(
                {
                  name: "Admin",
                  value:
                    "`/setup verification` — Configure the verification system\n`/autorole` — Set roles given to new members and bots on join",
                  inline: false,
                },
                {
                  name: "Text Commands (staff & verificators)",
                  value:
                    '`"pending` — Repost all pending requests (request room only)\n`"case @member` — Show who verified a member and when\n`"vcount` — Leaderboard of how many members each verifier has verified\n\n_Prefix is set inside `/setup verification` → Embed & Prefix_',
                  inline: false,
                },
                {
                  name: "Utility",
                  value: "`/ping` — Check bot latency\n`/help` — This menu",
                  inline: false,
                }
              )
              .setFooter({ text: "Stargate • Verification Bot" }),
          ],
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.isButton()) {
      const panelIds = [
        "panel_deploy_verify",
        "vp_save", "vp_reset", "vp_edit_questions", "vp_edit_embed", "vp_embed_back",
        "vp_staff_roles_btn", "vp_staff_done",
      ];
      if (panelIds.includes(interaction.customId)) {
        await handleButtonInteraction(interaction as ButtonInteraction);
      }
      return;
    }

    if (interaction.isRoleSelectMenu()) {
      await handleRoleSelectInteraction(interaction as RoleSelectMenuInteraction);
      return;
    }

    if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectInteraction(interaction as ChannelSelectMenuInteraction);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "vp_questions_modal") {
        try { await handleEditQuestionsSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("[Stargate] questions modal error:", err); }
      } else if (interaction.customId === "vp_embed_modal") {
        try { await handleEmbedCustomizeSubmit(interaction as ModalSubmitInteraction); } catch (err) { console.error("[Stargate] embed modal error:", err); }
      }
    }
  });
}

async function handleSetupCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("❌ You need **Administrator** permission to use this.")],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();
  if (sub === "verification") {
    await openVerifyPanel(interaction as unknown as ButtonInteraction);
  }
}

async function handleAutoroleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "❌ You need **Administrator** permission.", ephemeral: true });
    return;
  }

  const guildId = interaction.guild!.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  const memberRoleId = config[0]?.autoroleRoleId ?? null;
  const botRoleId = config[0]?.botAutoroleRoleId ?? null;

  await interaction.reply({
    ...buildAutorolePanel(memberRoleId, botRoleId),
    ephemeral: true,
  });
}

async function handleButtonInteraction(interaction: ButtonInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "panel_deploy_verify") {
      const { embed, row } = buildDeployChannelSelect();
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    } else if (customId === "vp_save") {
      await handleVerifyPanelSave(interaction);
    } else if (customId === "vp_reset") {
      await handleVerifyPanelReset(interaction);
    } else if (customId === "vp_edit_questions") {
      await openEditQuestionsModal(interaction);
    } else if (customId === "vp_edit_embed") {
      await openEmbedCustomizeModal(interaction);
    } else if (customId === "vp_embed_back") {
      await handleEmbedPreviewBack(interaction);
    } else if (customId === "vp_staff_roles_btn") {
      const userId = interaction.user.id;
      const state = verifyPanelState.get(userId) ?? {};
      await interaction.reply({ ...buildStaffSubPanel(state), ephemeral: true });
    } else if (customId === "vp_staff_done") {
      await handleStaffPanelDone(interaction);
    }
  } catch (err) {
    console.error("[Stargate] Panel button error:", err);
  }
}

async function handleRoleSelectInteraction(interaction: RoleSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "autorole_member_role" || customId === "autorole_bot_role") {
      await handleAutoroleRoleSelect(interaction);
    } else if (customId.startsWith("vp_")) {
      await handleVerifyPanelSelect(interaction);
    }
  } catch (err) {
    console.error("[Stargate] Panel role select error:", err);
  }
}

async function handleAutoroleRoleSelect(interaction: RoleSelectMenuInteraction) {
  const guildId = interaction.guild!.id;
  const roleId = interaction.values[0];
  const isMember = interaction.customId === "autorole_member_role";

  await db
    .insert(botConfigTable)
    .values({
      guildId,
      ...(isMember ? { autoroleRoleId: roleId } : { botAutoroleRoleId: roleId }),
    })
    .onConflictDoUpdate({
      target: botConfigTable.guildId,
      set: isMember ? { autoroleRoleId: roleId } : { botAutoroleRoleId: roleId },
    });

  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  const memberRoleId = config[0]?.autoroleRoleId ?? null;
  const botRoleId = config[0]?.botAutoroleRoleId ?? null;

  await interaction.update(buildAutorolePanel(memberRoleId, botRoleId));
}

async function handleChannelSelectInteraction(interaction: ChannelSelectMenuInteraction) {
  const { customId } = interaction;
  try {
    if (customId === "deploy_verify_channel") {
      const channelId = interaction.values[0];
      const channel = interaction.guild!.channels.cache.get(channelId) as TextChannel | undefined;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Invalid channel selected.", ephemeral: true });
        return;
      }
      await deployVerificationPanel(channel);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5000ff)
            .setTitle("✅ Verification Panel Posted")
            .setDescription(`Panel posted in <#${channelId}>. Members will see the Start Verification button there.`)
            .setFooter({ text: "Stargate • Setup" }),
        ],
        components: [],
      });
    } else if (customId.startsWith("vp_")) {
      await handleVerifyPanelSelect(interaction);
    }
  } catch (err) {
    console.error("[Stargate] Panel channel select error:", err);
  }
}
