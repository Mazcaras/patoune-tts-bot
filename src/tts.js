import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import textToSpeech from "@google-cloud/text-to-speech";

function ensureGcpCredsFromEnv() {
  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    const p = path.join(os.tmpdir(), "gcp-creds.json");
    fs.writeFileSync(p, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
  }
}

const ttsClient = new textToSpeech.TextToSpeechClient();

/**
 * Récupère des voix *fr-FR* (3 F / 3 M).
 * On filtre strictement sur fr-FR pour éviter l’accent québécois (fr-CA).
 */
export async function loadVoicePresets() {
  ensureGcpCredsFromEnv();

  const [res] = await ttsClient.listVoices({});
  const voices = (res.voices || [])
    // ✅ Filtre STRICT fr-FR uniquement
    .filter((v) => (v.languageCodes || []).includes("fr-FR"))
    .map((v) => ({
      name: v.name,
      gender: v.ssmlGender, // "FEMALE" | "MALE" | "NEUTRAL" | "SSML_VOICE_GENDER_UNSPECIFIED"
      languages: v.languageCodes || [],
    }));

  // (optionnel) si tu veux favoriser certaines familles, tu peux trier ici
  // ex: prioriser Neural2 / Wavenet, etc. (sans changer le reste)

  const females = voices.filter((v) => v.gender === "FEMALE");
  const males = voices.filter((v) => v.gender === "MALE");
  const neutrals = voices.filter((v) => v.gender === "NEUTRAL");

  const pick = (arr, n) => arr.slice(0, n);

  const f = pick(females, 3);
  const m = pick(males, 3);

  while (f.length < 3 && neutrals[f.length]) f.push(neutrals[f.length]);
  while (m.length < 3 && neutrals[m.length]) m.push(neutrals[m.length]);

  return {
    f1: f[0]?.name || "",
    f2: f[1]?.name || "",
    f3: f[2]?.name || "",
    h1: m[0]?.name || "",
    h2: m[1]?.name || "",
    h3: m[2]?.name || "",
  };
}

/**
 * TTS -> OGG_OPUS buffer
 * ✅ On force fr-FR pour éviter toute dérive vers fr-CA.
 */
export async function synthesizeMp3(text, voiceName = "", speakingRate = 1.0) {
  ensureGcpCredsFromEnv();

  // ✅ Toujours fr-FR
  const languageCode = "fr-FR";

  const request = {
    input: { text },
    voice: voiceName
      ? { name: voiceName, languageCode } // voiceName doit être une voix fr-FR
      : { languageCode, ssmlGender: "NEUTRAL" },
    audioConfig: {
      audioEncoding: "OGG_OPUS",
      speakingRate,
    },
  };

  const [response] = await ttsClient.synthesizeSpeech(request);
  if (!response.audioContent) throw new Error("Google TTS: audioContent vide");

  return Buffer.from(response.audioContent);
}