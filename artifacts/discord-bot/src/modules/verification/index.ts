import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonInteraction,
  ModalSubmitInteraction,
  Message,
  TextChannel,
  OverwriteType,
  ChannelType,
  PermissionsBitField,
} from "discord.js";
import { db } from "@stargate/db";
import { botConfigTable, verificationSessionsTable } from "@stargate/db";
import { eq, and, count } from "drizzle-orm";
import { isMainGuild } from "../../utils/guildFilter.js";

const BRAND = 0x5000ff;
const COLOR_PENDING = 0xffb347;
const COLOR_ACCEPT  = 0x57f287;
const COLOR_DENY    = 0xed4245;
const COLOR_JAIL    = 0x95a5a6;

const DEFAULT_QUESTIONS = [
  "Wach nta mghribi ?",
  "Mnin dkhlti l server ?",
  "3lach dkhlti l server ?",
  "Ch7al f3mrk ?",
  "Chno lhaja libghiti tl9aha f server ?",
];

async function getQuestions(guildId: string): Promise<string[]> {
  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  try {
    if (config[0]?.verificationQuestions) {
      return JSON.parse(config[0].verificationQuestions);
    }
  } catch {}
  return DEFAULT_QUESTIONS;
}

function formatEmbedDescription(raw: string): string {
  return raw;
}

export function buildVerificationPanelEmbed(title?: string | null, description?: string | null): EmbedBuilder[] {
  const resolvedTitle = title || "Stargate — Verification";
  const baseDesc =
    description ||
    "Welcome!\n\nClick the button below and answer the questions.\nA staff member will review your answers and verify you shortly.";

  const titleEmbed = new EmbedBuilder()
    .setColor(BRAND)
    .setDescription(`## ${resolvedTitle}`);

  const descEmbed = new EmbedBuilder()
    .setColor(BRAND)
    .setDescription(formatEmbedDescription(baseDesc))
    .setFooter({ text: "Stargate • Verification System" });

  return [titleEmbed, descEmbed];
}

function buildStartButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verification_start")
      .setLabel("Start Verification")
      .setStyle(ButtonStyle.Primary)
  );
}

async function buildVerificationModal(guildId: string) {
  const questions = await getQuestions(guildId);

  const modal = new ModalBuilder()
    .setCustomId("verification_modal")
    .setTitle("Stargate — Verification");

  for (let i = 0; i < 5; i++) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i + 1}`)
          .setLabel(questions[i] ?? `Question ${i + 1}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(300)
      )
    );
  }

  return modal;
}

function buildRequestEmbed(
  memberId: string,
  memberUsername: string,
  memberAvatarUrl: string | null,
  createdAt: number,
  joinedAt: number | null,
  answers: string[],
  questions: string[],
  applicationNumber: number
) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_PENDING)
    .setAuthor({ name: `Application #${applicationNumber}`, iconURL: memberAvatarUrl ?? undefined })
    .setTitle("🔔 New Verification Request")
    .addFields(
      {
        name: "👤 Member",
        value: `<@${memberId}>\n\`${memberUsername}\``,
        inline: true,
      },
      {
        name: "🆔 User ID",
        value: `\`${memberId}\``,
        inline: true,
      },
      {
        name: "📅 Account Age",
        value: `<t:${Math.floor(createdAt / 1000)}:R>`,
        inline: true,
      },
      {
        name: "🚪 Joined Server",
        value: joinedAt ? `<t:${Math.floor(joinedAt / 1000)}:R>` : "_Unknown_",
        inline: true,
      },
      { name: "\u200B", value: "**─── Answers ───**", inline: false },
      ...questions.map((q, i) => ({
        name: `${i + 1}. ${q}`,
        value: answers[i] ? `> ${answers[i]}` : "> _No answer_",
        inline: false,
      }))
    )
    .setFooter({ text: `Application #${applicationNumber} • Pending review` })
    .setTimestamp();

  if (memberAvatarUrl) {
    embed.setThumbnail(memberAvatarUrl);
  }

  return embed;
}

function buildActionButtons(disabled = false) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_accept")
      .setLabel("Accept")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_deny")
      .setLabel("Deny")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_jail")
      .setLabel("Jail")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("verify_ticket")
      .setLabel("Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function buildOutcomeLogEmbed(
  action: "accept" | "deny" | "jail" | "ticket",
  memberId: string,
  memberUsername: string,
  memberAvatarUrl: string | null,
  staffName: string,
  staffId: string,
  applicationNumber: number,
  ticketChannelName?: string
) {
  const configs: Record<typeof action, { color: number; icon: string; label: string }> = {
    accept: { color: COLOR_ACCEPT, icon: "✅", label: "Accepted" },
    deny:   { color: COLOR_DENY,   icon: "❌", label: "Denied" },
    jail:   { color: COLOR_JAIL,   icon: "🔒", label: "Jailed" },
    ticket: { color: BRAND,        icon: "🎫", label: "Ticket Opened" },
  };

  const { color, icon, label } = configs[action];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: `Application #${applicationNumber}`, iconURL: memberAvatarUrl ?? undefined })
    .setTitle(`${icon} Verification ${label}`)
    .addFields(
      {
        name: "👤 Member",
        value: `<@${memberId}> \`${memberUsername}\``,
        inline: true,
      },
      {
        name: "🛡️ Staff",
        value: `<@${staffId}> \`${staffName}\``,
        inline: true,
      }
    )
    .setTimestamp()
    .setFooter({ text: "Stargate • Verification Logs" });

  if (action === "ticket" && ticketChannelName) {
    embed.addFields({ name: "📋 Ticket", value: `#${ticketChannelName}`, inline: true });
  }

  return embed;
}

async function getConfig(guildId: string) {
  const result = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);
  return result[0] ?? null;
}

export async function deployVerificationPanel(channel: TextChannel) {
  const config = await getConfig(channel.guild.id);
  const title = config?.panelEmbedTitle ?? null;
  const desc = config?.panelEmbedDescription ?? null;
  await channel.send({
    embeds: buildVerificationPanelEmbed(title, desc),
    components: [buildStartButton()],
  });
}

export function registerVerificationModule(client: Client) {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.guild) return;
    if (!isMainGuild(interaction.guild.id)) return;

    if (interaction.isButton() && interaction.customId === "verification_start") {
      const existingPending = await db
        .select()
        .from(verificationSessionsTable)
        .where(
          and(
            eq(verificationSessionsTable.guildId, interaction.guild!.id),
            eq(verificationSessionsTable.memberId, interaction.user.id),
            eq(verificationSessionsTable.status, "submitted")
          )
        )
        .limit(1);

      if (existingPending.length > 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(BRAND)
              .setDescription("Your verification request is already submitted.\nPlease wait for a staff member to review it.")
              .setFooter({ text: "Stargate • Verification" }),
          ],
          ephemeral: true,
        });
        return;
      }

      const modal = await buildVerificationModal(interaction.guild.id);
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "verification_modal") {
      await handleVerificationSubmit(interaction as ModalSubmitInteraction);
      return;
    }

    if (interaction.isButton()) {
      const validIds = ["verify_accept", "verify_deny", "verify_jail", "verify_ticket"];
      if (validIds.includes(interaction.customId)) {
        await handleVerificationAction(interaction as ButtonInteraction);
      }
    }
  });
}

async function handleVerificationSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guild!.id;
  const user = interaction.user;

  const answers = [
    interaction.fields.getTextInputValue("q1"),
    interaction.fields.getTextInputValue("q2"),
    interaction.fields.getTextInputValue("q3"),
    interaction.fields.getTextInputValue("q4"),
    interaction.fields.getTextInputValue("q5"),
  ];

  const existing = await db
    .select()
    .from(verificationSessionsTable)
    .where(
      and(
        eq(verificationSessionsTable.guildId, guildId),
        eq(verificationSessionsTable.memberId, user.id)
      )
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(verificationSessionsTable)
      .set({
        channelId: "modal",
        currentQuestion: 5,
        answer1: answers[0],
        answer2: answers[1],
        answer3: answers[2],
        answer4: answers[3],
        answer5: answers[4],
        status: "submitted",
      })
      .where(
        and(
          eq(verificationSessionsTable.guildId, guildId),
          eq(verificationSessionsTable.memberId, user.id)
        )
      );
  } else {
    await db.insert(verificationSessionsTable).values({
      guildId,
      memberId: user.id,
      channelId: "modal",
      currentQuestion: 5,
      answer1: answers[0],
      answer2: answers[1],
      answer3: answers[2],
      answer4: answers[3],
      answer5: answers[4],
      status: "submitted",
    });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_PENDING)
        .setTitle("📨 Answers Submitted")
        .setDescription(
          "Your answers have been sent to the staff for review.\nPlease wait — you will be verified shortly."
        )
        .setFooter({ text: "Stargate • Verification System" }),
    ],
  });

  const config = await getConfig(guildId);
  const requestsChannelId =
    config?.verificationRequestsChannelId ?? config?.verificationLogsChannelId;
  if (!requestsChannelId) return;

  const requestsChannel = interaction.guild!.channels.cache.get(requestsChannelId) as
    | TextChannel
    | undefined;
  if (!requestsChannel) return;

  const countResult = await db
    .select({ total: count() })
    .from(verificationSessionsTable)
    .where(eq(verificationSessionsTable.guildId, guildId));
  const applicationNumber = countResult[0]?.total ?? 1;

  const questions = await getQuestions(guildId);
  const avatarUrl = user.displayAvatarURL({ size: 128 });
  const joinedAt = (interaction.member as import("discord.js").GuildMember)?.joinedTimestamp ?? null;

  const requestEmbed = buildRequestEmbed(
    user.id,
    user.username,
    avatarUrl,
    user.createdTimestamp,
    joinedAt,
    answers,
    questions,
    applicationNumber
  );

  await requestsChannel.send({
    content: config?.verificatorsRoleId ? `<@&${config.verificatorsRoleId}>` : undefined,
    embeds: [requestEmbed],
    components: [buildActionButtons(false)],
  });
}

async function handleVerificationAction(interaction: ButtonInteraction) {
  await interaction.deferUpdate();

  const guildId = interaction.guild!.id;
  const config = await getConfig(guildId);
  if (!config) return;

  const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;

  const memberRoles = interaction.member?.roles;
  const hasRole = (roleId: string): boolean => {
    if (!roleId) return false;
    if (Array.isArray(memberRoles)) return memberRoles.includes(roleId);
    return (memberRoles as any)?.cache?.has(roleId) ?? false;
  };

  const hasVerificatorRole = config.verificatorsRoleId ? hasRole(config.verificatorsRoleId) : false;
  let actionStaffRoleIdsArr: string[] = [];
  try { actionStaffRoleIdsArr = config.staffRoleIds ? JSON.parse(config.staffRoleIds) : []; } catch {}
  const hasStaffRole = (config.staffRoleId ? hasRole(config.staffRoleId) : false)
    || actionStaffRoleIdsArr.some((id) => hasRole(id));

  if (!isAdmin && !hasVerificatorRole && !hasStaffRole) {
    await interaction.followUp({
      content: "You do not have permission to use these buttons.",
      ephemeral: true,
    });
    return;
  }

  const embed = interaction.message.embeds[0];
  const idField = embed?.fields?.find((f) => f.name === "🆔 User ID");
  const memberId = idField?.value?.replace(/`/g, "").trim();
  if (!memberId) return;

  const ticketChIdFromEmbed = embed?.fields?.find((f) => f.name === "🎫 Ticket")?.value;

  const targetMember = await interaction.guild!.members.fetch(memberId).catch(() => null);
  const disabledRow = buildActionButtons(true);
  const { customId } = interaction;
  const staffName = interaction.user.username;
  const staffId = interaction.user.id;
  const memberUsername = targetMember?.user.username ?? memberId;
  const memberAvatarUrl = targetMember?.user.displayAvatarURL({ size: 128 }) ?? null;

  const authorData = embed?.author;
  const appNumMatch = authorData?.name?.match(/#(\d+)/);
  const applicationNumber = appNumMatch ? parseInt(appNumMatch[1]) : 0;

  let actionType: "accept" | "deny" | "jail" | "ticket" = "deny";
  let ticketChannelName: string | undefined;

  if (customId === "verify_accept") {
    actionType = "accept";
    if (config.verifiedRoleId && targetMember) {
      await targetMember.roles.add(config.verifiedRoleId).catch((e: any) => {
        console.error("[Stargate] ROLE ADD (verified) failed:", e?.message ?? e);
      });
    } else {
      console.warn("[Stargate] verify_accept — verifiedRoleId:", config.verifiedRoleId, "targetMember:", !!targetMember);
    }
    if (config.unverifiedRoleId && targetMember) {
      await targetMember.roles.remove(config.unverifiedRoleId).catch((e: any) => {
        console.error("[Stargate] ROLE REMOVE (unverified) failed:", e?.message ?? e);
      });
    }
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_ACCEPT)
            .setTitle("✅ Verification Accepted")
            .setDescription("You are now verified! You have full access to the server."),
        ],
      })
      .catch(() => {});

    if (ticketChIdFromEmbed) {
      await interaction.guild!.channels.fetch(ticketChIdFromEmbed).then((ch) => ch?.delete()).catch(() => {});
    }
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(COLOR_ACCEPT)
          .setFooter({ text: `✅ Accepted by ${staffName}` })
          .setFields((embed.fields ?? []).filter((f) => f.name !== "🎫 Ticket")),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_deny") {
    actionType = "deny";
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_DENY)
            .setTitle("❌ Verification Denied")
            .setDescription("You have been denied from Night Stars verification."),
        ],
      })
      .catch(() => {});

    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(COLOR_DENY)
          .setFooter({ text: `❌ Denied by ${staffName}` }),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_jail") {
    actionType = "jail";
    if (config.jailRoleId && targetMember) {
      await targetMember.roles.add(config.jailRoleId).catch((e: any) => {
        console.error("[Stargate] ROLE ADD (jail) failed:", e?.message ?? e);
      });
    } else {
      console.warn("[Stargate] verify_jail — jailRoleId:", config.jailRoleId, "targetMember:", !!targetMember);
    }
    if (config.unverifiedRoleId && targetMember) {
      await targetMember.roles.remove(config.unverifiedRoleId).catch((e: any) => {
        console.error("[Stargate] ROLE REMOVE (unverified/jail) failed:", e?.message ?? e);
      });
    }
    await targetMember
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_JAIL)
            .setTitle("🔒 Verification — Jailed")
            .setDescription(
              "Your verification request was flagged."
            ),
        ],
      })
      .catch(() => {});

    if (ticketChIdFromEmbed) {
      await interaction.guild!.channels.fetch(ticketChIdFromEmbed).then((ch) => ch?.delete()).catch(() => {});
    }
    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setColor(COLOR_JAIL)
          .setFooter({ text: `🔒 Jailed by ${staffName}` })
          .setFields((embed.fields ?? []).filter((f) => f.name !== "🎫 Ticket")),
      ],
      components: [disabledRow],
    });
  } else if (customId === "verify_ticket") {
    actionType = "ticket";

    const ticketOverwrites: import("discord.js").OverwriteResolvable[] = [
      { id: interaction.guild!.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: interaction.guild!.members.me!.id,
        type: OverwriteType.Member,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ];

    if (config.verificatorsRoleId) {
      ticketOverwrites.push({
        id: config.verificatorsRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      });
    }

    for (const roleId of actionStaffRoleIdsArr) {
      if (roleId !== config.verificatorsRoleId) {
        ticketOverwrites.push({
          id: roleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
          ],
        });
      }
    }

    if (targetMember) {
      ticketOverwrites.push({
        id: targetMember.id,
        type: OverwriteType.Member,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
        ],
      });
    }

    const session = await db
      .select()
      .from(verificationSessionsTable)
      .where(
        and(
          eq(verificationSessionsTable.guildId, guildId),
          eq(verificationSessionsTable.memberId, memberId)
        )
      )
      .limit(1);

    const requestsChId = config.verificationRequestsChannelId ?? config.verificationLogsChannelId;
    const requestsCh = requestsChId
      ? (interaction.guild!.channels.cache.get(requestsChId) as import("discord.js").TextChannel | undefined)
      : undefined;
    const ticketParentId = requestsCh?.parentId ?? undefined;

    const ticketChannel = await interaction.guild!.channels.create({
      name: `ticket-${targetMember?.user.username ?? memberId}`,
      type: ChannelType.GuildText,
      parent: ticketParentId,
      permissionOverwrites: ticketOverwrites,
    });

    ticketChannelName = ticketChannel.name;

    const answers = session[0]
      ? [
          session[0].answer1 ?? "",
          session[0].answer2 ?? "",
          session[0].answer3 ?? "",
          session[0].answer4 ?? "",
          session[0].answer5 ?? "",
        ]
      : [];

    const questions = await getQuestions(guildId);

    await ticketChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND)
          .setTitle("🎫 Assistance Ticket")
          .setDescription(
            `Ticket for <@${memberId}> — opened by <@${interaction.user.id}>`
          )
          .addFields({
            name: "Verification Answers",
            value: answers.length
              ? answers
                  .map(
                    (a, i) =>
                      `**${questions[i] ?? `Q${i + 1}`}**\n> ${a || "_No answer_"}`
                  )
                  .join("\n\n")
              : "_Not available_",
          })
          .setFooter({ text: "Stargate • Ticket" })
          .setTimestamp(),
      ],
    });

    const afterTicketRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("verify_accept").setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("verify_deny").setLabel("Deny").setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(true),
      new ButtonBuilder().setCustomId("verify_jail").setLabel("Jail").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("verify_ticket").setLabel("Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary).setDisabled(true),
    );

    await interaction.message.edit({
      embeds: [
        EmbedBuilder.from(embed)
          .setFooter({ text: `🎫 Ticket opened by ${staffName} → #${ticketChannel.name}` })
          .addFields({ name: "🎫 Ticket", value: ticketChannel.id }),
      ],
      components: [afterTicketRow],
    });
  }

  // Small confirmation embed for the staff member — auto-deletes after 5s
  try {
    const confirmColor =
      actionType === "accept" ? COLOR_ACCEPT :
      actionType === "jail"   ? COLOR_JAIL   : COLOR_DENY;
    const confirmText =
      actionType === "accept" ? `${memberUsername} has been verified.` :
      actionType === "deny"   ? `${memberUsername}'s verification was denied.` :
      actionType === "jail"   ? `${memberUsername} has been jailed.` :
                                `Ticket opened for ${memberUsername}.`;
    const confirmMsg = await interaction.followUp({
      embeds: [new EmbedBuilder().setColor(confirmColor).setDescription(confirmText)],
      ephemeral: false,
    });
    setTimeout(() => confirmMsg.delete().catch(() => {}), 5000);
  } catch {}

  if (customId !== "verify_ticket") {
    await db
      .update(verificationSessionsTable)
      .set({
        status: customId.replace("verify_", ""),
      })
      .where(
        and(
          eq(verificationSessionsTable.guildId, guildId),
          eq(verificationSessionsTable.memberId, memberId)
        )
      );
  }

  const requestsChannelId =
    config.verificationRequestsChannelId ?? config.verificationLogsChannelId;
  const logsChannelId = config.verificationLogsChannelId;

  if (logsChannelId && logsChannelId !== requestsChannelId) {
    const logsChannel = interaction.guild!.channels.cache.get(logsChannelId) as
      | TextChannel
      | undefined;
    if (logsChannel) {
      const logEmbed = buildOutcomeLogEmbed(
        actionType,
        memberId,
        memberUsername,
        memberAvatarUrl,
        staffName,
        staffId,
        applicationNumber,
        ticketChannelName
      );
      await logsChannel.send({ embeds: [logEmbed] });
    }
  }
}

export function registerTextCommands(client: Client) {
  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!isMainGuild(message.guild.id)) return;

    const config = await getConfig(message.guild.id);
    const prefix = config?.prefix ?? '"';

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = args[0]?.toLowerCase();

    if (command === "pending") {
      await handlePending(message, config);
    } else if (command === "tasks") {
      await handleTasks(message, config);
    }
  });
}

async function handlePending(message: Message, config: Awaited<ReturnType<typeof getConfig>>) {
  if (!config) return;

  const member = message.member;
  if (!member) return;

  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  const hasVerif = config.verificatorsRoleId ? member.roles.cache.has(config.verificatorsRoleId) : false;
  let staffRoleIdsArr: string[] = [];
  try { staffRoleIdsArr = config.staffRoleIds ? JSON.parse(config.staffRoleIds) : []; } catch {}
  const hasStaff = (config.staffRoleId ? member.roles.cache.has(config.staffRoleId) : false)
    || staffRoleIdsArr.some((id) => member.roles.cache.has(id));

  if (!isAdmin && !hasVerif && !hasStaff) {
    const deny = await message.reply({ content: "You do not have permission to use this command." });
    setTimeout(() => deny.delete().catch(() => {}), 5000);
    return;
  }

  const requestsChannelId = config.verificationRequestsChannelId ?? config.verificationLogsChannelId;
  if (!requestsChannelId) {
    const err = await message.reply({ content: "Verification requests channel not configured." });
    setTimeout(() => err.delete().catch(() => {}), 5000);
    return;
  }

  if (message.channelId !== requestsChannelId) {
    const err = await message.reply({
      content: `This command can only be used in the verification requests channel: <#${requestsChannelId}>`,
    });
    setTimeout(() => err.delete().catch(() => {}), 5000);
    return;
  }

  const pending = await db
    .select()
    .from(verificationSessionsTable)
    .where(
      and(
        eq(verificationSessionsTable.guildId, message.guild!.id),
        eq(verificationSessionsTable.status, "submitted")
      )
    );

  if (pending.length === 0) {
    const reply = await message.reply({ content: "No pending verification requests." });
    setTimeout(() => reply.delete().catch(() => {}), 5000);
    return;
  }

  const requestsChannel = message.guild!.channels.cache.get(requestsChannelId) as TextChannel | undefined;
  if (!requestsChannel) {
    const err = await message.reply({ content: "Verification requests channel not found." });
    setTimeout(() => err.delete().catch(() => {}), 5000);
    return;
  }

  const questions = await getQuestions(message.guild!.id);
  let reposted = 0;

  for (const session of pending) {
    try {
      const targetMember = await message.guild!.members.fetch(session.memberId).catch(() => null);
      const username = targetMember?.user.username ?? session.memberId;
      const avatarUrl = targetMember?.user.displayAvatarURL({ size: 128 }) ?? null;
      const createdTimestamp = targetMember?.user.createdTimestamp ?? Date.now();
      const joinedAt = targetMember?.joinedTimestamp ?? null;

      const answers = [
        session.answer1 ?? "",
        session.answer2 ?? "",
        session.answer3 ?? "",
        session.answer4 ?? "",
        session.answer5 ?? "",
      ];

      const requestEmbed = buildRequestEmbed(
        session.memberId,
        username,
        avatarUrl,
        createdTimestamp,
        joinedAt,
        answers,
        questions,
        session.id
      );

      const pendingEmbed = EmbedBuilder.from(requestEmbed)
        .setColor(COLOR_DENY)
        .setFooter({ text: `Application #${session.id} • PENDING — Reposted by ${message.author.username}` });

      await requestsChannel.send({
        content: config.verificatorsRoleId ? `<@&${config.verificatorsRoleId}>` : undefined,
        embeds: [pendingEmbed],
        components: [buildActionButtons(false)],
      });

      reposted++;
    } catch (e) {
      console.error("[Stargate] Failed to repost pending for", session.memberId, e);
    }
  }

  const reply = await message.reply({ content: `Reposted **${reposted}** pending verification request(s).` });
  setTimeout(() => reply.delete().catch(() => {}), 8000);
}


async function handleTasks(message: Message, config: Awaited<ReturnType<typeof getConfig>>) {
  if (!config) return;

  const member = message.member;
  if (!member) return;

  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  const hasVerif = config.verificatorsRoleId ? member.roles.cache.has(config.verificatorsRoleId) : false;
  let taskStaffRoleIdsArr: string[] = [];
  try { taskStaffRoleIdsArr = config.staffRoleIds ? JSON.parse(config.staffRoleIds) : []; } catch {}
  const hasStaff = (config.staffRoleId ? member.roles.cache.has(config.staffRoleId) : false)
    || taskStaffRoleIdsArr.some((id) => member.roles.cache.has(id));

  if (!isAdmin && !hasVerif && !hasStaff) {
    const deny = await message.reply({ content: "You do not have permission to use this command." });
    setTimeout(() => deny.delete().catch(() => {}), 5000);
    return;
  }

  const pending = await db
    .select()
    .from(verificationSessionsTable)
    .where(
      and(
        eq(verificationSessionsTable.guildId, message.guild!.id),
        eq(verificationSessionsTable.status, "submitted")
      )
    )
    .orderBy(verificationSessionsTable.createdAt);

  const prefix = config.prefix ?? '"';

  if (pending.length === 0) {
    const reply = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5000ff)
          .setTitle("Verification Tasks")
          .setDescription("No pending verifications right now.")
          .setFooter({ text: `Stargate • Use ${prefix}pending to repost requests` }),
      ],
    });
    setTimeout(() => reply.delete().catch(() => {}), 15000);
    return;
  }

  const now = Date.now();
  const lines = pending.map((s, i) => {
    const waitMs = now - (s.createdAt?.getTime() ?? now);
    const waitMin = Math.floor(waitMs / 60000);
    const waitHr = Math.floor(waitMin / 60);
    const timeStr = waitHr > 0
      ? `${waitHr}h ${waitMin % 60}m`
      : `${waitMin}m`;
    return `**${i + 1}.** <@${s.memberId}> — waiting **${timeStr}**`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle(`Verification Tasks — ${pending.length} pending`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Stargate • Use ${prefix}pending to repost all to the channel` })
    .setTimestamp();

  const reply = await message.reply({ embeds: [embed] });
  setTimeout(() => reply.delete().catch(() => {}), 30000);
}
