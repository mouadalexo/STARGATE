import {
  ButtonInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { db } from "@stargate/db";
import { botConfigTable } from "@stargate/db";
import { eq } from "drizzle-orm";

interface VerifyPanelState {
  verificatorsRoleId?: string;
  requestsChannelId?: string;
  logsChannelId?: string;
  assistCategoryId?: string;
  verifiedRoleId?: string;
  unverifiedRoleId?: string;
  jailRoleId?: string;
  staffRoleIds?: string[];
  embedTitle?: string;
  embedDescription?: string;
}

export const verifyPanelState = new Map<string, VerifyPanelState>();

const DEFAULT_QUESTIONS = [
  "Wach nta mghribi ?",
  "Mnin dkhlti l server ?",
  "3lach dkhlti l server ?",
  "Ch7al f3mrk ?",
  "Chno lhaja libghiti tl9aha f server ?",
];

function buildVerifyPanelEmbed(state: VerifyPanelState) {
  const staffRolesStr = state.staffRoleIds?.length
    ? state.staffRoleIds.map((id) => `<@&${id}>`).join(", ")
    : "not set";
  const lines = [
    `**Verificators Role** — ${state.verificatorsRoleId ? `<@&${state.verificatorsRoleId}>` : "not set"}`,
    `**Staff Roles** — ${staffRolesStr}`,
    `**Requests Channel** — ${state.requestsChannelId ? `<#${state.requestsChannelId}>` : "not set"}`,
    `**Logs Channel** — ${state.logsChannelId ? `<#${state.logsChannelId}>` : "not set"}`,
    `**Verified Role** — ${state.verifiedRoleId ? `<@&${state.verifiedRoleId}>` : "not set"}`,
    `**Unverified Role** — ${state.unverifiedRoleId ? `<@&${state.unverifiedRoleId}>` : "not set"}`,
    `**Jail Role** — ${state.jailRoleId ? `<@&${state.jailRoleId}>` : "not set"}`,
  ];

  return new EmbedBuilder()
    .setColor(0x5000ff)
    .setTitle("Stargate — Verification Setup")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Stargate • Setup" });
}

function buildVerifyPanelComponents(state: VerifyPanelState) {
  const canSave = !!(state.verificatorsRoleId && state.requestsChannelId);

  const row1 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_verificators_role")
      .setPlaceholder(state.verificatorsRoleId ? "Verificators Role (set)" : "Verificators Role...")
      .setMinValues(1).setMaxValues(1)
  );

  const row2 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_requests_channel")
      .setPlaceholder(state.requestsChannelId ? "Requests Channel (set)" : "Requests Channel (where apps arrive)...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1).setMaxValues(1)
  );

  const row3 = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId("vp_roles_group")
      .setPlaceholder(
        [state.verifiedRoleId && "Verified", state.unverifiedRoleId && "Unverified", state.jailRoleId && "Jail"]
          .filter(Boolean).join(", ") + (state.verifiedRoleId || state.unverifiedRoleId || state.jailRoleId ? " (set)" : "")
        || "Verified / Unverified / Jail Roles..."
      )
      .setMinValues(1).setMaxValues(3)
  );

  const row4 = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("vp_logs_channel")
      .setPlaceholder(state.logsChannelId ? "Logs Channel (set)" : "Logs Channel (outcomes, optional)...")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0).setMaxValues(1)
  );

  const row5 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_save")
      .setLabel("Save")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId("vp_edit_questions")
      .setLabel("Questions")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vp_edit_embed")
      .setLabel(state.embedTitle ? "Embed (set)" : "Embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_deploy_verify")
      .setLabel("Post Panel")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vp_staff_roles_btn")
      .setLabel(state.staffRoleIds?.length ? `Staff Roles (${state.staffRoleIds.length})` : "Staff Roles")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3, row4, row5];
}

export async function openVerifyPanel(interaction: ButtonInteraction) {
  const userId = interaction.user.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, interaction.guild!.id))
    .limit(1);

  const existing = config[0];
  let staffRoleIds: string[] = [];
  try { staffRoleIds = existing?.staffRoleIds ? JSON.parse(existing.staffRoleIds) : []; } catch {}
  const state: VerifyPanelState = {
    verificatorsRoleId: existing?.verificatorsRoleId ?? undefined,
    requestsChannelId: existing?.verificationRequestsChannelId ?? existing?.verificationLogsChannelId ?? undefined,
    logsChannelId: existing?.verificationLogsChannelId ?? undefined,
    assistCategoryId: existing?.assistanceCategoryId ?? undefined,
    verifiedRoleId: existing?.verifiedRoleId ?? undefined,
    unverifiedRoleId: existing?.unverifiedRoleId ?? undefined,
    jailRoleId: existing?.jailRoleId ?? undefined,
    staffRoleIds: staffRoleIds.length ? staffRoleIds : undefined,
    embedTitle: existing?.panelEmbedTitle ?? undefined,
    embedDescription: existing?.panelEmbedDescription ?? undefined,
  };
  verifyPanelState.set(userId, state);

  const payload = {
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
}

export async function openEditQuestionsModal(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;
  const config = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);
  let questions = DEFAULT_QUESTIONS;
  try {
    if (config[0]?.verificationQuestions) {
      questions = JSON.parse(config[0].verificationQuestions);
    }
  } catch {}

  const modal = new ModalBuilder()
    .setCustomId("vp_questions_modal")
    .setTitle("Edit Verification Questions");

  for (let i = 0; i < 5; i++) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(`vq${i + 1}`)
          .setLabel(`Question ${i + 1}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(questions[i] ?? "")
      )
    );
  }

  await interaction.showModal(modal);
}

export async function handleEditQuestionsSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guild!.id;

  const questions = [
    interaction.fields.getTextInputValue("vq1").trim(),
    interaction.fields.getTextInputValue("vq2").trim(),
    interaction.fields.getTextInputValue("vq3").trim(),
    interaction.fields.getTextInputValue("vq4").trim(),
    interaction.fields.getTextInputValue("vq5").trim(),
  ];

  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificationQuestions: JSON.stringify(questions),
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificationQuestions: JSON.stringify(questions),
    });
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setTitle("Questions Updated")
        .setDescription(questions.map((q, i) => `**Q${i + 1}** — ${q}`).join("\n"))
        .setFooter({ text: "Stargate • Setup" }),
    ],
    ephemeral: true,
  });
}

export async function openEmbedCustomizeModal(interaction: ButtonInteraction) {
  const guildId = interaction.guild!.id;

  const config = await db
    .select()
    .from(botConfigTable)
    .where(eq(botConfigTable.guildId, guildId))
    .limit(1);

  const saved = config[0];
  const state = verifyPanelState.get(interaction.user.id) ?? {};

  const currentTitle =
    state.embedTitle ??
    saved?.panelEmbedTitle ??
    "Stargate — Verification";

  const currentDesc =
    state.embedDescription ??
    saved?.panelEmbedDescription ??
    "Welcome!\n\nClick the button below and answer the questions.\nA staff member will review your answers and verify you shortly.";

  if (saved?.panelEmbedTitle && !state.embedTitle) {
    state.embedTitle = saved.panelEmbedTitle;
    verifyPanelState.set(interaction.user.id, state);
  }
  if (saved?.panelEmbedDescription && !state.embedDescription) {
    state.embedDescription = saved.panelEmbedDescription;
    verifyPanelState.set(interaction.user.id, state);
  }

  const modal = new ModalBuilder()
    .setCustomId("vp_embed_modal")
    .setTitle("Customize Verification Panel Embed");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("vp_embed_title")
        .setLabel("Title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(256)
        .setValue(currentTitle.slice(0, 256))
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("vp_embed_desc")
        .setLabel("Description (use <:name:id> for emojis)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
        .setPlaceholder("<:name:id> static | <a:name:id> animated")
        .setValue(currentDesc.slice(0, 2000))
    )
  );

  await interaction.showModal(modal);
}

export async function handleEmbedCustomizeSubmit(interaction: ModalSubmitInteraction) {
  await interaction.deferUpdate();

  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  state.embedTitle = interaction.fields.getTextInputValue("vp_embed_title").trim();
  state.embedDescription = interaction.fields
    .getTextInputValue("vp_embed_desc")
    .trim()
    .replace(/\\</g, "<")
    .replace(/\\>/g, ">");

  verifyPanelState.set(userId, state);

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  if (existing.length) {
    await db.update(botConfigTable).set({
      panelEmbedTitle: state.embedTitle,
      panelEmbedDescription: state.embedDescription,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      panelEmbedTitle: state.embedTitle,
      panelEmbedDescription: state.embedDescription,
    });
  }

  const resolvedTitle = state.embedTitle || "Stargate — Verification";
  const rawDesc = state.embedDescription ||
    "Welcome!\n\nClick the button below and answer the questions.\nA staff member will review your answers and verify you shortly.";

  const formattedPreviewDesc = rawDesc.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '\u200b' || trimmed === '\u200b\u200b') return line;
    if (/^[#>\-\*\`\|]/.test(trimmed)) return line;
    return `## ${line}`;
  }).join('\n');

  const previewTitleEmbed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setDescription(`## ${resolvedTitle}`);

  const previewDescEmbed = new EmbedBuilder()
    .setColor(0x5000ff)
    .setDescription('\u200b\n' + formattedPreviewDesc)
    .setFooter({ text: "Stargate • Verification System" });

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("vp_embed_back")
      .setLabel("Back to Setup")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    embeds: [previewTitleEmbed, previewDescEmbed],
    components: [backRow],
  });
}

export async function handleEmbedPreviewBack(interaction: ButtonInteraction) {
  const state = verifyPanelState.get(interaction.user.id) ?? {};
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export async function handleVerifyPanelSelect(
  interaction: RoleSelectMenuInteraction | ChannelSelectMenuInteraction
) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (interaction.customId === "vp_verificators_role") {
    state.verificatorsRoleId = (interaction as RoleSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_requests_channel") {
    state.requestsChannelId = (interaction as ChannelSelectMenuInteraction).values[0];
  } else if (interaction.customId === "vp_logs_channel") {
    state.logsChannelId = (interaction as ChannelSelectMenuInteraction).values[0] ?? undefined;
  } else if (interaction.customId === "vp_roles_group") {
    const values = (interaction as RoleSelectMenuInteraction).values;
    if (values.length >= 1) state.verifiedRoleId = values[0];
    if (values.length >= 2) state.unverifiedRoleId = values[1];
    if (values.length >= 3) state.jailRoleId = values[2];
  } else if (interaction.customId === "vp_staff_roles") {
    state.staffRoleIds = (interaction as RoleSelectMenuInteraction).values;
    verifyPanelState.set(userId, state);
    await interaction.update(buildStaffSubPanel(state));
    return;
  }

  verifyPanelState.set(userId, state);

  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export async function handleVerifyPanelSave(interaction: ButtonInteraction) {
  const userId = interaction.user.id;
  const state = verifyPanelState.get(userId) ?? {};

  if (!state.verificatorsRoleId || !state.requestsChannelId) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(0x5000ff).setDescription("Verificators Role and Requests Channel are required.")],
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guild!.id;
  const existing = await db.select().from(botConfigTable).where(eq(botConfigTable.guildId, guildId)).limit(1);

  const staffRoleIdsJson = state.staffRoleIds?.length ? JSON.stringify(state.staffRoleIds) : null;

  if (existing.length) {
    await db.update(botConfigTable).set({
      verificatorsRoleId: state.verificatorsRoleId,
      staffRoleIds: staffRoleIdsJson,
      verificationRequestsChannelId: state.requestsChannelId,
      verificationLogsChannelId: state.logsChannelId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
      updatedAt: new Date(),
    }).where(eq(botConfigTable.guildId, guildId));
  } else {
    await db.insert(botConfigTable).values({
      guildId,
      verificatorsRoleId: state.verificatorsRoleId,
      staffRoleIds: staffRoleIdsJson,
      verificationRequestsChannelId: state.requestsChannelId,
      verificationLogsChannelId: state.logsChannelId ?? null,
      assistanceCategoryId: state.assistCategoryId ?? null,
      verifiedRoleId: state.verifiedRoleId ?? null,
      unverifiedRoleId: state.unverifiedRoleId ?? null,
      jailRoleId: state.jailRoleId ?? null,
    });
  }

  verifyPanelState.delete(userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Stargate Saved")
        .setDescription(
          [
            `**Verificators Role** — <@&${state.verificatorsRoleId}>`,
            `**Requests Channel** — <#${state.requestsChannelId}>`,
            `**Logs Channel** — ${state.logsChannelId ? `<#${state.logsChannelId}>` : "not set"}`,
            `**Verified Role** — ${state.verifiedRoleId ? `<@&${state.verifiedRoleId}>` : "not set"}`,
            `**Unverified Role** — ${state.unverifiedRoleId ? `<@&${state.unverifiedRoleId}>` : "not set"}`,
            `**Jail Role** — ${state.jailRoleId ? `<@&${state.jailRoleId}>` : "not set"}`,
          ].join("\n")
        )
        .setFooter({ text: "Stargate • Setup" }),
    ],
    components: [],
  });
}

export async function handleVerifyPanelReset(interaction: ButtonInteraction) {
  const state: VerifyPanelState = {};
  verifyPanelState.set(interaction.user.id, state);
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}

export function buildStaffSubPanel(state: VerifyPanelState) {
  const staffPlaceholder = state.staffRoleIds?.length
    ? `${state.staffRoleIds.length} role(s) selected`
    : "Select staff roles...";
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5000ff)
        .setDescription(
          "**Staff Roles** — members with these roles can use verification commands and buttons.\n\nClick **Back to Setup** when done."
        )
        .setFooter({ text: "Stargate • Staff Roles" }),
    ],
    components: [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId("vp_staff_roles")
          .setPlaceholder(staffPlaceholder)
          .setMinValues(0)
          .setMaxValues(25)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("vp_staff_done")
          .setLabel("Back to Setup")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

export async function handleStaffPanelDone(interaction: ButtonInteraction) {
  const state = verifyPanelState.get(interaction.user.id) ?? {};
  await interaction.update({
    embeds: [buildVerifyPanelEmbed(state)],
    components: buildVerifyPanelComponents(state),
  });
}
