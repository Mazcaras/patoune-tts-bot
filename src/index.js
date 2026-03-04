import "dotenv/config";
import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { PREFIX, STATUS_CHANNEL_ID, PORT, DEFAULT_VOICE_KEY } from "./config.js";
import { buildHelpEmbed } from "./help.js";
import { join, leave, getConnection, playMp3Buffer } from "./voice.js";
import { loadVoicePresets, synthesizeMp3 } from "./tts.js";

import fs from "node:fs";

console.log("[boot] index.js started");

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));

if (process.env.GOOGLE_CREDENTIALS) {
  fs.writeFileSync("/tmp/gcp.json", process.env.GOOGLE_CREDENTIALS);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp.json";
}

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN manquant.");
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn("⚠️ Google creds: mets GOOGLE_APPLICATION_CREDENTIALS_JSON (recommandé) ou GOOGLE_APPLICATION_CREDENTIALS.");
}

const app = express();
app.get("/", (_req, res) => res.status(200).send("ok"));
app.listen(PORT, () => console.log(`[keepalive] listening on :${PORT}`));

// voix par guild
const guildVoiceChoice = new Map(); // guildId -> "f1" | "h2" etc
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

// remplace les mentions <@id> par le displayName serveur, pas l’ID
function replaceMentionsWithNames(message, text) {
  // Remplace mentions utilisateurs
  for (const [id, user] of message.mentions.users) {
    const member = message.guild?.members.cache.get(id);
    const name = member?.displayName || user.username;
    text = text.replaceAll(new RegExp(`<@!?${id}>`, "g"), name);
  }
  // Remplace mentions rôles
  for (const [id, role] of message.mentions.roles) {
    text = text.replaceAll(new RegExp(`<@&${id}>`, "g"), role.name);
  }
  // Mention everyone/here
  text = text.replaceAll(/@everyone/g, "tout le monde").replaceAll(/@here/g, "ici");
  return text;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

async function announce(client, content) {
  const ch = getStatusChannel(client);
  if (ch && ch.isTextBased()) {
    try { await ch.send(content); } catch {}
  }
}

client.on("ready", async () => {
  console.log(`✅ Connecté: ${client.user.tag}`);
  await announce(client, `✅ **Connecté** en tant que **${client.user.tag}**`);

  // charge les presets de voix Google
  try {
    voicePresets = await loadVoicePresets();
    console.log("🎙️ Voice presets:", voicePresets);
  } catch (e) {
    console.warn("⚠️ Impossible de charger les voix Google (listVoices). On continuera avec voice neutral fr-FR.", e?.message || e);
  }
});

client.on("shardDisconnect", async () => {
  console.warn("⚠️ shardDisconnect");
  await announce(client, "⚠️ **Déconnecté** (shardDisconnect).");
});

client.on("shardResume", async () => {
  console.log("🔁 shardResume");
  await announce(client, "🔁 **Reconnexion** (shardResume).");
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
      // L’utilisateur doit être en vocal
      await join(message.member);
      return message.reply("✅ J’ai rejoint le vocal. Utilise `!v <texte>` pour parler.");
    }

    if (cmd === "leave") {
      const conn = getConnection(message.guild.id);
      if (!conn) return message.reply("Je ne suis pas en vocal.");

      // Restriction : seulement si même vocal
      if (!isInSameVoice(message.member, conn)) {
        return message.reply("❌ Tu dois être dans **le même vocal que moi** pour me faire quitter.");
      }

      leave(message.guild.id);
      return message.reply("👋 Je quitte le vocal.");
    }

    // commandes vocales: bot doit être en vocal, et user dans le même vocal
    const conn = getConnection(message.guild.id);
    if (cmd === "vuse") {
      if (!conn) return message.reply("❌ Je ne suis pas en vocal. Fais `!join` d’abord.");
      if (!isInSameVoice(message.member, conn)) return message.reply("❌ Tu dois être dans **le même vocal que moi**.");

      const key = (rest[0] || "").toLowerCase();
      if (!["f1","f2","f3","h1","h2","h3"].includes(key)) {
        return message.reply("Usage: `!vuse f1|f2|f3|h1|h2|h3`");
      }

      guildVoiceChoice.set(message.guild.id, key);
      return message.reply(`✅ Voix sélectionnée: **${key}**`);
    }

    if (cmd === "v") {
      if (!conn) return message.reply("❌ Je ne suis pas en vocal. Fais `!join` d’abord.");
      if (!isInSameVoice(message.member, conn)) return message.reply("❌ Tu dois être dans **le même vocal que moi**.");

      if (!argsText) return message.reply(`Usage: \`${PREFIX}v <texte>\``);

      // Remplace les mentions par des noms de serveur
      const cleanText = replaceMentionsWithNames(message, argsText);

      // Ne pas dire "X dit:", on lit directement le message
      const voiceKey = guildVoiceChoice.get(message.guild.id) || DEFAULT_VOICE_KEY;
      const voiceName = voicePresets?.[voiceKey] || "";

      const mp3 = await synthesizeMp3(cleanText, voiceName);
      await playMp3Buffer(message.guild.id, mp3);

      return; // pas obligé de spammer un "ok" en texte
    }

    // commande inconnue
    return message.reply({ embeds: [buildHelpEmbed(PREFIX)] });

  } catch (e) {
    console.error(e);
    try {
      await message.reply(`❌ Erreur: ${e?.message ?? e}`);
    } catch {}
  }
});

client.login(process.env.DISCORD_TOKEN);