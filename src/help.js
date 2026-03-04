import { EmbedBuilder } from "discord.js";

export function buildHelpEmbed(prefix) {
  return new EmbedBuilder()
    .setTitle("Commandes TTS")
    .setDescription("Le bot ne répond qu’aux utilisateurs **dans le même vocal** que lui (sauf `join` / `help`).")
    .addFields(
      { name: `${prefix}join`, value: "Fait rejoindre le bot dans ton salon vocal.", inline: false },
      { name: `${prefix}leave`, value: "Fait quitter le bot (il ne quitte pas tout seul).", inline: false },
      { name: `${prefix}v <texte>`, value: "Lit le texte en vocal (sans dire ton nom).", inline: false },
      { name: `${prefix}v @user <texte>`, value: "Lit le texte en remplaçant la mention par le pseudo serveur.", inline: false },
      { name: `${prefix}vuse f1|f2|f3|h1|h2|h3`, value: "Change la voix (3 femmes / 3 hommes).", inline: false },
      { name: `${prefix}help`, value: "Affiche cet embed.", inline: false }
    )
    .setFooter({ text: "Google Cloud TTS + discord.js voice" });
}