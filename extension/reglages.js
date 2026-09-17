/* =========================================================================
   REGLAGES DE L'EXTENSION

   L'overlay et les pages de configuration sont servis par Twitch ; l'EBS, lui,
   tourne ailleurs. Il faut donc lui dire où le joindre.

   Le domaine indiqué ici doit figurer dans la liste blanche des requêtes de la
   console Twitch (« URL Fetching Domains »), sans quoi sa politique de contenu
   bloque les appels sans le moindre message.

   Pour éprouver une version locale, on peut pointer sur `fonction/local.js`
   (http://localhost:8445) — mais 8080 et 8081 sont souvent pris sur un PC de
   stream, par NVIDIA Broadcast et Streamer.bot.
   ========================================================================= */

window.REGLAGES = {
  /* La fonction, déployée chez Cloudflare. Adresse fixe : plus de tunnel à
     relancer, plus d'adresse à reporter à chaque démarrage. Ce domaine doit
     figurer dans la liste blanche des requêtes de la console Twitch. */
  ebs: 'https://hots-talents.eowea.workers.dev',

  // Le domaine qui sert les icônes et les portraits, à déclarer lui aussi
  // dans la liste blanche, côté images.
  images: 'https://eowea.github.io/builds/',
};
