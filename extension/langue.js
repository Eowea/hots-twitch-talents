/* =========================================================================
   LANGUE

   L'extension est publique : ses viewers ne sont pas tous francophones.
   Plutôt que d'en publier deux, elle porte les deux langues et choisit
   celle du spectateur.

   Twitch la donne dans l'adresse de l'iframe :
     panneau.html?anchor=panel&language=fr&locale=fr-FR&mode=viewer

   Attention au faux ami : onContext() expose aussi un « language », mais
   c'est celui de la DIFFUSION, pas du spectateur. Ce n'est pas lui qu'on
   veut — un anglophone qui regarde une chaîne française doit lire l'anglais.

   Repli sur l'anglais pour tout le reste : c'est la langue par défaut du
   jeu, et celle des noms de talents qu'on trouve dans les guides.

   Les noms de héros et de talents ne sont pas ici : talents.json les porte
   déjà dans les deux langues. Seule l'interface a besoin d'une table.
   ========================================================================= */
'use strict';

const LANGUES = ['fr', 'en'];
const REPLI = 'en';

function detecterLangue() {
  const parametres = new URLSearchParams(window.location.search);
  /* navigator.language ferme la marche : hors du lecteur Twitch — page
     ouverte à la main, test local — il n'y a aucun paramètre à lire. */
  const brut = parametres.get('language')
    || parametres.get('locale')
    || navigator.language
    || '';
  const code = String(brut).slice(0, 2).toLowerCase();
  return LANGUES.includes(code) ? code : REPLI;
}

const LANGUE = detecterLangue();

const TEXTES = {
  fr: {
    /* Le tableau */
    titreTableau: 'Talents — Heroes of the Storm',
    talents: 'TALENTS',
    bannis: 'BANNIS',
    equipeBleue: 'ÉQUIPE BLEUE',
    equipeRouge: 'ÉQUIPE ROUGE',
    attente: "En attente d'une partie…",
    fermerTableau: 'Fermer le tableau',
    niveau: 'niveau {n}',
    palier: 'PALIER {n}',
    voirRouge: 'Voir l’équipe rouge →',
    voirBleue: '← Voir l’équipe bleue',
    tableIntrouvable: 'Table des talents introuvable.',

    /* La configuration */
    titreConfig: 'Talents — configuration',
    configSousTitre: 'Relie ton PC à ta chaîne, une fois pour toutes.',
    configQuoi: "Ce qu'il faut faire",
    configQuoiTexte: 'Lance le lecteur sur ton PC. Au premier démarrage, il te '
      + "demandera le code ci-dessous : colle-le, et c'est fini — il s'en souviendra.",
    configQuoiDetail: "Le jeton n'autorise qu'une seule chose : publier le tableau "
      + 'des talents sur ta chaîne. Il ne donne aucun accès à ton compte Twitch.',
    configReglages: 'Tes réglages',
    configCode: "Ton code d'appairage",
    configCanal: 'Identifiant de chaîne',
    chargement: 'Chargement…',
    configConnexion: 'Connexion à Twitch…',
    configSansHelper: "Le script d'aide de Twitch ne s'est pas chargé. Cette page "
      + "doit être ouverte depuis le gestionnaire d'extensions, pas directement.",
    configSansAutorisation: "Twitch n'a pas autorisé la page au bout de 6 secondes. "
      + "C'est en général que l'extension n'est pas installée sur la chaîne, ou que "
      + "cette page a été ouverte hors du gestionnaire d'extensions. Ouvre la console "
      + '(F12) : le vrai motif y est écrit.',
    configAutorise: 'Autorisé par Twitch. Interrogation du service sur {ebs}…',
    configRefus: "Le service a répondu 403. Il n'a pas reconnu le jeton de Twitch : "
      + 'son secret ne correspond pas à celui de la console Twitch. Si tu as régénéré '
      + "une clé, l'ancienne ne vaut plus.",
    configErreur: 'Le service a répondu {code}.',
    configPret: 'Prêt. Colle ce code dans le lecteur, au premier démarrage.',
    configInjoignable: 'Service injoignable à {ebs} ({erreur}). Vérifie que '
      + '« {domaine} » figure dans la liste blanche des requêtes de la console '
      + 'Twitch. Si tu viens de changer cette adresse, recharge cette page avec '
      + "Ctrl+Shift+R : le navigateur garde l'ancienne en cache.",

    /* Le tableau de bord du direct */
    titreDirect: 'Talents — en direct',
    directSousTitre: 'État du lecteur pendant ton direct.',
    directLecteur: 'Lecteur',
    directVerification: 'Vérification…',
    directSiRien: "Si rien n'arrive",
    directSiRienDebut: 'Lance',
    directSiRienFin: "sur ton PC, avant ou pendant la partie. Le lecteur n'a besoin "
      + "de rien d'autre : il lit un fichier que le jeu écrit lui-même, et se met à "
      + 'envoyer dès que la carte est chargée.',
    directInjoignable: 'Service injoignable',
    directReponse: 'Le serveur a répondu {code}.',
    directArrete: 'Lecteur arrêté',
    directDernierMessage: 'Dernier message il y a {s} s.',
    directConnecte: 'Lecteur connecté',
    directPartie: 'Partie en cours à {temps}, {n} joueurs suivis.',
    directAttente: "En attente d'une partie.",
  },

  en: {
    /* The panel */
    titreTableau: 'Talents — Heroes of the Storm',
    talents: 'TALENTS',
    bannis: 'BANNED',
    equipeBleue: 'BLUE TEAM',
    equipeRouge: 'RED TEAM',
    attente: 'Waiting for a game…',
    fermerTableau: 'Close the panel',
    niveau: 'level {n}',
    palier: 'TIER {n}',
    voirRouge: 'Show the red team →',
    voirBleue: '← Show the blue team',
    tableIntrouvable: 'Talent table not found.',

    /* Setup */
    titreConfig: 'Talents — setup',
    configSousTitre: 'Link your PC to your channel, once and for all.',
    configQuoi: 'What to do',
    configQuoiTexte: 'Run the reader on your PC. On its first launch it will ask '
      + "for the code below: paste it in, and that's it — it will remember.",
    configQuoiDetail: 'The token allows exactly one thing: publishing the talent '
      + 'panel on your channel. It grants no access to your Twitch account.',
    configReglages: 'Your settings',
    configCode: 'Your pairing code',
    configCanal: 'Channel ID',
    chargement: 'Loading…',
    configConnexion: 'Connecting to Twitch…',
    configSansHelper: "Twitch's helper script did not load. This page has to be "
      + 'opened from the extension manager, not directly.',
    configSansAutorisation: 'Twitch did not authorize this page within 6 seconds. '
      + 'Usually the extension is not installed on the channel, or this page was '
      + 'opened outside the extension manager. Open the console (F12): the real '
      + 'reason is written there.',
    configAutorise: 'Authorized by Twitch. Querying the service at {ebs}…',
    configRefus: 'The service replied 403. It did not recognize the Twitch token: '
      + 'its secret does not match the one in the Twitch console. If you have '
      + 'regenerated a key, the old one is void.',
    configErreur: 'The service replied {code}.',
    configPret: 'Ready. Paste this code into the reader on its first launch.',
    configInjoignable: 'Service unreachable at {ebs} ({erreur}). Check that '
      + '“{domaine}” is on the request allowlist in the Twitch console. If you have '
      + 'just changed this address, reload the page with Ctrl+Shift+R: the browser '
      + 'is holding the old one in cache.',

    /* Live dashboard */
    titreDirect: 'Talents — live',
    directSousTitre: 'Reader status during your stream.',
    directLecteur: 'Reader',
    directVerification: 'Checking…',
    directSiRien: 'If nothing shows up',
    directSiRienDebut: 'Run',
    directSiRienFin: 'on your PC, before or during the game. The reader needs '
      + 'nothing else: it reads a file the game writes by itself, and starts '
      + 'sending as soon as the map is loaded.',
    directInjoignable: 'Service unreachable',
    directReponse: 'The server replied {code}.',
    directArrete: 'Reader stopped',
    directDernierMessage: 'Last message {s} s ago.',
    directConnecte: 'Reader connected',
    directPartie: 'Game in progress at {temps}, {n} players tracked.',
    directAttente: 'Waiting for a game.',
  },
};

/* Une clé absente rend la version anglaise, puis la clé elle-même : une
   traduction oubliée doit se voir à l'écran, pas disparaître en silence. */
function texteDe(cle, valeurs) {
  const brut = TEXTES[LANGUE][cle] ?? TEXTES[REPLI][cle] ?? cle;
  if (!valeurs) return brut;
  return brut.replace(/\{(\w+)\}/g, (entier, nom) => (
    nom in valeurs ? String(valeurs[nom]) : entier
  ));
}

/* Le balisage porte les clés, pas les textes : data-t pour le contenu,
   data-t-aria pour l'étiquette d'accessibilité, data-titre sur <body> pour
   le titre de la page. */
function traduirePage() {
  document.documentElement.lang = LANGUE;

  for (const element of document.querySelectorAll('[data-t]')) {
    element.textContent = texteDe(element.dataset.t);
  }
  for (const element of document.querySelectorAll('[data-t-aria]')) {
    element.setAttribute('aria-label', texteDe(element.dataset.tAria));
  }
  if (document.body.dataset.titre) {
    document.title = texteDe(document.body.dataset.titre);
  }
}

/* Ce script est chargé en fin de <body> : le document est donc complet, et
   la traduction se pose avant le premier rendu — pas de texte français qui
   clignote une fraction de seconde chez un viewer anglophone. */
traduirePage();
