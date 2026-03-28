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
} from "discord.js";
import { isMainGuild } from "../utils/guildFilter.js";
import {
  openVerifyPanel,
  handleVerifyPanelSelect,
  handleVerifyPanelSave,
  handleVerifyPanelReset,
  openEditQuestionsModal,
  handleEditQuestionsSubmit,
  openEmbedCustomizeModal,
  handleEmbedCustomizeSubmit,
  handleEmbedPreviewBack,
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
    .setDescription("Show Stargate commands")
    .addSubcommand((sub) =>
      sub.setName("all").setDescription("Show all Stargate commands")
    )
    .toJSON();

  const rest = new REST().setToken(token);

  const registerForGuild = async (guildId: string, guildName: string) => {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), {
        body: [setupCommand, helpCommand],
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
      } else if (name === "help") {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5000ff)
              .setTitle("🌟 Stargate — Commands")
              .addFields(
                {
                  name: "⚙️ Setup (admin only)",
                  value: "`/setup verification` — Configure the verification system",
                  inline: false,
                },
                {
                  name: "📋 Help",
                  value: "`/help all` — This menu",
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
