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
import { Readable } from "node:stream";

const player = createAudioPlayer();

// File d’attente simple par guild (pour éviter de parler en même temps)
const queues = new Map(); // guildId -> Promise chain

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
  selfDeaf: true,
  selfMute: false,
});

  // Logs d'état de la connexion vocale
  connection.on("stateChange", (oldState, newState) => {
    console.log(`[voice] ${channel.guild.id} ${oldState.status} -> ${newState.status}`);
  });

  connection.subscribe(player);

  // Robustesse: si Discord coupe, on tente de récupérer (sinon on détruit)
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn("[voice] Disconnected, trying to reconnect...");
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log("[voice] Recovered from disconnect.");
    } catch {
      console.warn("[voice] Reconnect failed, destroying connection.");
      try {
        connection.destroy();
      } catch {}
    }
  });

  // Attend que la connexion soit prête (timeout augmenté)
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 45_000);
  } catch (e) {
    console.error("[voice] Ready timeout. Destroying connection.", e?.message || e);
    try {
      connection.destroy();
    } catch {}
    throw new Error("Connexion vocale impossible (timeout). Vérifie permissions + région Discord.");
  }

  return connection;
}

export function leave(guildId) {
  const conn = getVoiceConnection(guildId);
  if (conn) conn.destroy();
}

export async function playMp3Buffer(guildId, buffer) {
  const chain = queues.get(guildId) || Promise.resolve();

  const next = chain.then(async () => {
    const stream = Readable.from(buffer);

    // OGG_OPUS
    const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });

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