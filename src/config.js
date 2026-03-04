export const PREFIX = process.env.PREFIX?.trim() || "!";
export const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID?.trim() || "";
export const PORT = Number(process.env.PORT || 8080);

// Sélection de voix par défaut (sera remplacée par f1/h1 dynamiques si possible)
export const DEFAULT_VOICE_KEY = "f1";