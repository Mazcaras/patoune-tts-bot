import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import textToSpeech from "@google-cloud/text-to-speech";

function ensureGcpCredsFromEnv() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const p = path.join(os.tmpdir(), "gcp-creds.json");
    fs.writeFileSync(p, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
  }
}

const ttsClient = new textToSpeech.TextToSpeechClient();

/**
 * Récupère des voix FR si possible (3 F / 3 M).
 * On choisit dynamiquement pour éviter de hardcoder des noms qui changent.
 */
export async function loadVoicePresets() {
  ensureGcpCredsFromEnv();

  const [res] = await ttsClient.listVoices({});
  const voices = (res.voices || [])
    .filter(v => (v.languageCodes || []).some(l => l.startsWith("fr-")))
    .map(v => ({
      name: v.name,
      gender: v.ssmlGender, // "FEMALE" | "MALE" | "NEUTRAL" | "SSML_VOICE_GENDER_UNSPECIFIED"
      languages: v.languageCodes || []
    }));

  const females = voices.filter(v => v.gender === "FEMALE");
  const males = voices.filter(v => v.gender === "MALE");

  // fallback si pas assez genrés
  const neutrals = voices.filter(v => v.gender === "NEUTRAL");

  const pick = (arr, n) => arr.slice(0, n);

  const f = pick(females, 3);
  const m = pick(males, 3);

  // complète si insuffisant
  while (f.length < 3 && neutrals[f.length]) f.push(neutrals[f.length]);
  while (m.length < 3 && neutrals[m.length]) m.push(neutrals[m.length]);

  // Si vraiment vide, on renvoie un preset minimal
  const presets = {
    f1: f[0]?.name || "",
    f2: f[1]?.name || "",
    f3: f[2]?.name || "",
    h1: m[0]?.name || "",
    h2: m[1]?.name || "",
    h3: m[2]?.name || ""
  };

  return presets;
}

export async function synthesizeMp3(text, voiceName = "", speakingRate = 1.0) {
  ensureGcpCredsFromEnv();

  const request = {
    input: { text },
    voice: voiceName
      ? { name: voiceName }
      : { languageCode: "fr-FR", ssmlGender: "NEUTRAL" },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate
    }
  };

  const [response] = await ttsClient.synthesizeSpeech(request);
  if (!response.audioContent) throw new Error("Google TTS: audioContent vide");

  return Buffer.from(response.audioContent);
}