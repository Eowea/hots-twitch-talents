/* =========================================================================
   REGLAGES DE L'EXTENSION

   L'overlay et les pages de configuration sont servis par Twitch ; l'EBS, lui,
   tourne ailleurs. Il faut donc lui dire où le joindre.

   En test local, l'EBS écoute sur le port 8444 — 8080 et 8081 sont souvent
   déjà pris sur un PC de stream (NVIDIA Broadcast, Streamer.bot). En production, remplace cette
   adresse par celle de ton serveur — et pense à déclarer ce domaine dans la
   liste blanche « URL Fetching Domains » de la console Twitch, sinon les
   requêtes seront bloquées par sa politique de contenu.
   ========================================================================= */

window.REGLAGES = {
  /* Tunnel cloudflared vers l'EBS local. Une adresse de tunnel rapide change
     à chaque redémarrage de cloudflared : il faut alors la remplacer ici,
     repousser sur GitHub Pages, et mettre à jour la liste blanche de Twitch.
     En production, ce sera l'adresse fixe du serveur qui héberge l'EBS. */
  ebs: 'https://institutes-history-thereof-hunter.trycloudflare.com',

  // Le domaine qui sert les icônes et les portraits, à déclarer lui aussi
  // dans la liste blanche, côté images.
  images: 'https://eowea.github.io/builds/',
};
