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
import { botConfigTable, verificationSessionsTable } from "@stargate/db";
import { eq, count, isNotNull } from "drizzle-orm";
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
    .setDescription("Show Stargate slash and text commands")
    .toJSON();

  const autoroleCommand = new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Set or view automatic roles for new members and bots")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Set the role given to new human members on join")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Role to give to new members").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("bot")
        .setDescription("Set the role given to new bots on join")
        .addRoleOption((opt) =>
          opt.setName("role").setDescription("Role to give to new bots").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("View current autorole settings")
    )
    .toJSON();

  const pingCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Stargate bot latency")
    .toJSON();

  const prefixCommand = new SlashCommandBuilder()
    .setName("prefix")
    .setDescription("View or change the bot text command prefix")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand((sub) => sub.setName("view").setDescription("Show the current prefix"))
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Change the text command prefix")
        .addStringOption((opt) =>
          opt.setName("prefix").setDescription("New prefix (e.g. ! . ?)").setRequired(true).setMaxLength(5)
        )
    )
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, helpCommand, autoroleCommand, pingCommand, prefixCommand],
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
      } else if (name === "prefix") {
        await handlePrefixCommand(interaction as ChatInputCommandInteraction);
      } else if (name === "help") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setTitle("Stargate — Commands")
              .addFields(
                {
                  name: "Setup (admin only)",
                  value: "`/setup verification` — Configure the verification system",
                  inline: false,
                },
                {
                  name: "Autorole (admin only)",
                  value: "`/autorole user <role>` — Set role given to new members on join\n`/autorole bot <role>` — Set role given to new bots on join\n`/autorole view` — See current autorole settings",
                  inline: false,
                },
                {
                  name: "Prefix (admin only)",
                  value: "`/prefix view` — Show current text command prefix\n`/prefix set <prefix>` — Change it",
                  inline: false,
                },
                {
                  name: "Text Commands (staff & verificators)",
                  value: '`"pending` — Repost all pending requests (red, request room only)\n`"tasks` — List your pending verifications',
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
        "vp_staff_roles_btn",
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
    if (customId.startsWith("vp_")) {
      await handleVerifyPanelSelect(interaction);
    }
  } catch (err) {
    console.error("[Stargate] Panel role select error:", err);
  }
}

async function handleAutoroleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "❌ You need **Administrator** permission.", ephemeral: true });
    return;
  }

  const guildId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "user") {
    const role = interaction.options.getRole("role", true);
    await db
      .insert(botConfigTable)
      .values({ guildId, autoroleRoleId: role.id })
      .onConflictDoUpdate({
        target: botConfigTable.guildId,
        set: { autoroleRoleId: role.id },
      });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Autorole Set — Members")
          .setDescription(`<@&${role.id}> will now be given to every new **member** who joins.`)
          .setFooter({ text: "Stargate • Autorole" }),
      ],
      ephemeral: true,
    });
  } else if (sub === "bot") {
    const role = interaction.options.getRole("role", true);
    await db
      .insert(botConfigTable)
      .values({ guildId, botAutoroleRoleId: role.id })
      .onConflictDoUpdate({
        target: botConfigTable.guildId,
        set: { botAutoroleRoleId: role.id },
      });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Autorole Set — Bots")
          .setDescription(`<@&${role.id}> will now be given to every new **bot** that joins.`)
          .setFooter({ text: "Stargate • Autorole" }),
      ],
      ephemeral: true,
    });
  } else if (sub === "view") {
    const config = await db
      .select()
      .from(botConfigTable)
      .where(eq(botConfigTable.guildId, guildId))
      .limit(1);
    const memberRoleId = config[0]?.autoroleRoleId;
    const botRoleId = config[0]?.botAutoroleRoleId;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Autorole Settings")
          .addFields(
            { name: "Member Role", value: memberRoleId ? `<@&${memberRoleId}>` : "Not set", inline: true },
            { name: "Bot Role", value: botRoleId ? `<@&${botRoleId}>` : "Not set", inline: true },
          )
          .setFooter({ text: "Stargate • Autorole" }),
      ],
      ephemeral: true,
    });
  }
}

async function handlePrefixCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: "❌ Administrator permission required.", ephemeral: true });
    return;
  }

  const guildId = interaction.guild!.id;
  const sub = interaction.options.getSubcommand();

  if (sub === "view") {
    const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
    const prefix = config[0]?.prefix ?? '"';
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setDescription(`Current text command prefix: \`${prefix}\`\nText commands: \`${prefix}pending\`, \`${prefix}tasks\``)
          .setFooter({ text: "Stargate • Verification Bot" }),
      ],
      ephemeral: true,
    });
  } else if (sub === "set") {
    const newPrefix = interaction.options.getString("prefix", true);
    await db
      .insert(botConfigTable)
      .values({ guildId, prefix: newPrefix })
      .onConflictDoUpdate({ target: botConfigTable.guildId, set: { prefix: newPrefix } });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Prefix Updated")
          .setDescription(`Text command prefix set to \`${newPrefix}\`\nText commands: \`${newPrefix}pending\`, \`${newPrefix}tasks\``)
          .setFooter({ text: "Stargate • Verification Bot" }),
      ],
      ephemeral: true,
    });
  }
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
