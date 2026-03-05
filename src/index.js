import "dotenv/config";
import fs from "node:fs";
import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";

import { generateDependencyReport } from "@discordjs/voice";

import { PREFIX, STATUS_CHANNEL_ID, PORT, DEFAULT_VOICE_KEY } from "./config.js";
import { buildHelpEmbed } from "./help.js";
import { join, leave, getConnection, playMp3Buffer } from "./voice.js";

console.log("[boot] index.js started");

// ✅ Dependency report
try {
  console.log(generateDependencyReport());
} catch (e) {
  console.warn("[voice] generateDependencyReport failed:", e?.message || e);
}

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

// --- Google creds bootstrap ---
if (process.env.GOOGLE_CREDENTIALS && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  fs.writeFileSync("/tmp/gcp.json", process.env.GOOGLE_CREDENTIALS, "utf8");
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp.json";
  console.log("[gcp] credentials written to /tmp/gcp.json");
}

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN manquant.");
  process.exit(1);
}

// --- Keepalive HTTP ---
const app = express();
app.get("/", (_req, res) => res.status(200).send("ok"));
app.listen(PORT, () => console.log(`[keepalive] listening on :${PORT}`));

// --- Import TTS ---
const { loadVoicePresets, synthesizeMp3 } = await import("./tts.js");

// 🎤 VOIX PAR UTILISATEUR
const userVoiceChoice = new Map(); // userId -> voiceKey

let voicePresets = { f1: "", f2: "", f3: "", h1: "", h2: "", h3: "" };

function getStatusChannel(client) {
  if (!STATUS_CHANNEL_ID) return null;
  return client.channels.cache.get(STATUS_CHANNEL_ID) || null;
}

function isInSameVoice(member, conn) {
  const myChannelId = conn?.joinConfig?.channelId;
  const userChannelId = member?.voice?.channelId;
  return Boolean(myChannelId && userChannelId && myChannelId === userChannelId);
}

function replaceMentionsWithNames(message, text) {
  for (const [id, user] of message.mentions.users) {
    const member = message.guild?.members.cache.get(id);
    const name = member?.displayName || user.username;
    text = text.replaceAll(new RegExp(`<@!?${id}>`, "g"), name);
  }
  for (const [id, role] of message.mentions.roles) {
    text = text.replaceAll(new RegExp(`<@&${id}>`, "g"), role.name);
  }
  text = text.replaceAll(/@everyone/g, "tout le monde").replaceAll(/@here/g, "ici");
  return text;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

client.on("ready", async () => {
  console.log(`✅ Connecté: ${client.user.tag}`);

  try {
    voicePresets = await loadVoicePresets();
    console.log("🎙️ Voice presets:", voicePresets);
  } catch (e) {
    console.warn("⚠️ Impossible de charger les voix Google.", e?.message || e);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const [cmdRaw, ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    const argsText = rest.join(" ").trim();

    if (cmd === "help") {
      return message.reply({ embeds: [buildHelpEmbed(PREFIX)] });
    }

    if (cmd === "join") {
      try {
        const conn = await join(message.member);
        return message.reply("✅ J’ai rejoint le vocal. Utilise `!v <texte>` pour parler.");
      } catch (e) {
        console.error("[join] failed:", e);
        return message.reply(`❌ Join failed: ${e?.message ?? e}`);
      }
    }

    if (cmd === "leave") {
      const conn = getConnection(message.guild.id);
      if (!conn) return message.reply("Je ne suis pas en vocal.");

      if (!isInSameVoice(message.member, conn)) {
        return message.reply("❌ Tu dois être dans **le même vocal que moi**.");
      }

      leave(message.guild.id);
      return message.reply("👋 Je quitte le vocal.");
    }

    const conn = getConnection(message.guild.id);

    if (cmd === "vuse") {
      if (!conn) return message.reply("❌ Je ne suis pas en vocal. Fais `!join` d’abord.");
      if (!isInSameVoice(message.member, conn)) return message.reply("❌ Tu dois être dans le même vocal.");

      const key = (rest[0] || "").toLowerCase();

      if (!["f1","f2","f3","h1","h2","h3"].includes(key)) {
        return message.reply("Usage: `!vuse f1|f2|f3|h1|h2|h3`");
      }

      // 🔊 voix personnelle
      userVoiceChoice.set(message.author.id, key);

      return message.reply(`🎤 Ta voix personnelle est maintenant **${key}**`);
    }

    if (cmd === "v") {
      if (!conn) return message.reply("❌ Je ne suis pas en vocal. Fais `!join` d’abord.");
      if (!isInSameVoice(message.member, conn)) return message.reply("❌ Tu dois être dans le même vocal.");
      if (!argsText) return message.reply(`Usage: \`${PREFIX}v <texte>\``);

      const cleanText = replaceMentionsWithNames(message, argsText);

      // 🔊 récupérer la voix personnelle
      const voiceKey = userVoiceChoice.get(message.author.id) || DEFAULT_VOICE_KEY;
      const voiceName = voicePresets?.[voiceKey] || "";

      const mp3 = await synthesizeMp3(cleanText, voiceName);
      await playMp3Buffer(message.guild.id, mp3);
      return;
    }

    return message.reply({ embeds: [buildHelpEmbed(PREFIX)] });

  } catch (e) {
    console.error(e);
    try { await message.reply(`❌ Erreur: ${e?.message ?? e}`); } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);