import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from "@discordjs/voice";

import fs from "node:fs";

if (process.env.GOOGLE_CREDENTIALS) {
  fs.writeFileSync("/tmp/gcp.json", process.env.GOOGLE_CREDENTIALS);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp.json";
}

import prism from "prism-media";
import { Readable } from "node:stream";

// File d’attente simple par guild (pour éviter de parler en même temps)
const queues = new Map(); // guildId -> Promise chain

// 1 player par guild
const players = new Map();
function getPlayer(guildId) {
  if (!players.has(guildId)) players.set(guildId, createAudioPlayer());
  return players.get(guildId);
}

export function getConnection(guildId) {
  return getVoiceConnection(guildId) || null;
}

export async function join(member) {
  const channel = member?.voice?.channel;
  if (!channel) throw new Error("Tu dois être dans un salon vocal pour utiliser !join.");

  const existing = getVoiceConnection(channel.guild.id);
  if (existing) return existing;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // recommandé
    selfMute: false,
  });

  // Logs d'état + gestion reconnect quand Disconnected
  connection.on("stateChange", async (oldState, newState) => {
    console.log(`[voice] ${channel.guild.id} ${oldState.status} -> ${newState.status}`);

    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn("[voice] Disconnected, trying to reconnect...");
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        console.log("[voice] Recovered from disconnect.");
      } catch {
        console.warn("[voice] Reconnect failed, destroying connection.");
        try { connection.destroy(); } catch {}
      }
    }
  });

  // (optionnel mais utile) erreurs de connexion
  connection.on("error", (err) => {
    console.error("[voice] connection error:", err);
  });

  // Attend que la connexion soit prête
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 45_000);
  } catch (e) {
    console.error("[voice] Ready timeout. Destroying connection.", e?.message || e);
    try { connection.destroy(); } catch {}
    throw new Error("Connexion vocale impossible (timeout). Vérifie permissions + région Discord.");
  }

  // Subscribe seulement une fois Ready
  const player = getPlayer(channel.guild.id);
  connection.subscribe(player);

  return connection;
}

export function leave(guildId) {
  const conn = getVoiceConnection(guildId);
  if (conn) conn.destroy();
}

export async function playMp3Buffer(guildId, buffer) {
  const chain = queues.get(guildId) || Promise.resolve();

  const next = chain.then(async () => {
    const player = getPlayer(guildId);

    // FFmpeg transcode -> PCM raw 48kHz stereo
    const transcoder = new prism.FFmpeg({
      args: [
        "-analyzeduration", "0",
        "-loglevel", "0",
        "-i", "pipe:0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
      ],
    });

    const input = Readable.from(buffer);
    const output = input.pipe(transcoder);

    const resource = createAudioResource(output, { inputType: StreamType.Raw });

    player.play(resource);

    await new Promise((resolve, reject) => {
      const onIdle = () => cleanup(resolve);
      const onError = (e) => cleanup(() => reject(e));

      const cleanup = (done) => {
        player.off(AudioPlayerStatus.Idle, onIdle);
        player.off("error", onError);
        done();
      };

      player.once(AudioPlayerStatus.Idle, onIdle);
      player.once("error", onError);
    });
  });

  queues.set(guildId, next.catch(() => {}));
  return next;
}