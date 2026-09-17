/* =========================================================================
   REGLAGES DE L'EXTENSION

   L'overlay et les pages de configuration sont servis par Twitch ; l'EBS, lui,
   tourne ailleurs. Il faut donc lui dire où le joindre.

   En test local, l'EBS écoute sur le port 8081. En production, remplace cette
   adresse par celle de ton serveur — et pense à déclarer ce domaine dans la
   liste blanche « URL Fetching Domains » de la console Twitch, sinon les
   requêtes seront bloquées par sa politique de contenu.
   ========================================================================= */

window.REGLAGES = {
  ebs: 'https://localhost:8081',

  // Le domaine qui sert les icônes et les portraits, à déclarer lui aussi
  // dans la liste blanche, côté images.
  images: 'https://eowea.github.io/builds/',
};
