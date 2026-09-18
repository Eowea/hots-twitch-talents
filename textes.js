/* =========================================================================
   LES TEXTES DU LECTEUR

   Le lecteur est distribué à des diffuseurs qui ne sont pas tous
   francophones, et c'est le seul programme qu'ils aient à lancer eux-mêmes.
   Un premier démarrage en français devant une fenêtre noire, c'est une
   installation abandonnée.

   Même principe que extension/langue.js, mais dans Node : pas de Twitch pour
   annoncer la langue du lecteur, donc on la déduit de la machine.

     lecteur.exe --langue en     pour forcer
     TALENTS_LANGUE=en           idem, par l'environnement

   Repli sur l'anglais, comme l'extension.
   ========================================================================= */
'use strict';

const LANGUES = ['fr', 'en'];
const REPLI = 'en';

function detecterLangue() {
  const args = process.argv;
  const i = args.indexOf('--langue');
  const force = i !== -1 ? args[i + 1] : process.env.TALENTS_LANGUE;

  /* Sous Windows, LANG et LC_ALL sont vides : c'est Intl qui reflète les
     paramètres régionaux. On garde quand même les variables Unix, pour qui
     lance le lecteur depuis un terminal qui les pose. */
  const brut = force
    || process.env.LC_ALL
    || process.env.LC_MESSAGES
    || process.env.LANG
    || Intl.DateTimeFormat().resolvedOptions().locale
    || '';

  const code = String(brut).slice(0, 2).toLowerCase();
  return LANGUES.includes(code) ? code : REPLI;
}

const LANGUE = detecterLangue();

const TEXTES = {
  fr: {
    /* Le démarrage */
    banniere: 'TALENTS — lecteur de parties',
    chaine: 'Chaîne {canal}',
    laisserOuvert: 'Laisse cette fenêtre ouverte pendant que tu joues.',
    peutReduire: "Tu peux la réduire : elle n'a rien à afficher d'important.",

    /* La partie */
    attente: "En attente d'une partie. Lance Heroes of the Storm.",
    enCours: 'Partie en cours — {temps}  ·  {joueurs} joueurs  ·  {talents} talents suivis',
    terminee: 'Partie terminée.',
    resteVisible: 'Le tableau reste visible quelques minutes chez tes viewers.',

    /* Les ennuis */
    retabli: 'Connexion rétablie.',
    injoignable: 'Service injoignable.',
    injoignableConseil: 'Ta connexion est peut-être coupée. Le lecteur réessaiera tout seul.',
    appairageRefuse: 'Ton appairage a été refusé.',
    appairageRefuseConseil: 'Récupère un nouveau code sur la page de configuration de '
      + 'ton extension, puis supprime le fichier pont.config.json à côté de ce programme.',
    envoiRefuse: "Le service a refusé l'envoi (code {code}).",
    envoiRefuseConseil: "Si ça persiste, préviens Eowea — ce n'est pas de ton fait.",

    /* L'appairage */
    codeTronque: 'il semble tronqué ou mal copié',
    codeIncomplet: 'il lui manque une partie',
    premierDemarrage: 'Premier démarrage.',
    ouvreConfig: "Ouvre la configuration de l'extension Talents sur ta chaîne Twitch,",
    copieCode: "et copie le code d'appairage qu'elle affiche.",
    colleIci: 'Colle-le ici : ',
    appaire: 'Appairé à la chaîne {canal}.',
    retenu: "C'est retenu : tu n'auras plus à le refaire.",
    codeInvalide: "Ce code n'est pas valide ({motif}). Réessaie.",
    troisEssais: 'Trois essais infructueux. Vérifie le code sur la page de configuration.',

    /* Le rejeu, pour la mise au point */
    aucunReplay: 'Aucun replay trouvé sous Documents\\Heroes of the Storm.',
    dernierePartie: 'Dernière partie : {fichier}',
    rejeu: 'Rejeu de « {carte} » à {vitesse}x',
    fichierIntrouvable: 'Fichier introuvable : {fichier}',

    /* Le journal technique (--detail) */
    detailService: 'service : {ebs}',
    detailRefus: 'refus HTTP {code} {corps}',
    detailEnvoiImpossible: 'envoi impossible : {motif}',
    detailEnvoi: '{temps}s — {joueurs} joueurs — {octets} octets{rappel}',
    detailRappel: ' (rappel)',
  },

  en: {
    /* Startup */
    banniere: 'TALENTS — game reader',
    chaine: 'Channel {canal}',
    laisserOuvert: 'Leave this window open while you play.',
    peutReduire: 'You can minimise it: it has nothing important to show.',

    /* The game */
    attente: 'Waiting for a game. Start Heroes of the Storm.',
    enCours: 'Game in progress — {temps}  ·  {joueurs} players  ·  {talents} talents tracked',
    terminee: 'Game over.',
    resteVisible: 'The panel stays visible to your viewers for a few minutes.',

    /* Trouble */
    retabli: 'Connection restored.',
    injoignable: 'Service unreachable.',
    injoignableConseil: 'Your connection may be down. The reader will retry on its own.',
    appairageRefuse: 'Your pairing was refused.',
    appairageRefuseConseil: "Get a new code from your extension's configuration page, "
      + 'then delete the pont.config.json file next to this program.',
    envoiRefuse: 'The service refused the send (code {code}).',
    envoiRefuseConseil: 'If it keeps happening, tell Eowea — it is not your doing.',

    /* Pairing */
    codeTronque: 'it looks truncated or badly copied',
    codeIncomplet: 'part of it is missing',
    premierDemarrage: 'First launch.',
    ouvreConfig: "Open the Talents extension's configuration page on your Twitch channel,",
    copieCode: 'and copy the pairing code it shows.',
    colleIci: 'Paste it here: ',
    appaire: 'Paired with channel {canal}.',
    retenu: "That's remembered: you will not have to do it again.",
    codeInvalide: 'This code is not valid ({motif}). Try again.',
    troisEssais: 'Three failed attempts. Check the code on the configuration page.',

    /* Replay, for troubleshooting */
    aucunReplay: 'No replay found under Documents\\Heroes of the Storm.',
    dernierePartie: 'Last game: {fichier}',
    rejeu: 'Replaying “{carte}” at {vitesse}x',
    fichierIntrouvable: 'File not found: {fichier}',

    /* Technical log (--detail) */
    detailService: 'service: {ebs}',
    detailRefus: 'HTTP refusal {code} {corps}',
    detailEnvoiImpossible: 'send failed: {motif}',
    detailEnvoi: '{temps}s — {joueurs} players — {octets} bytes{rappel}',
    detailRappel: ' (refresh)',
  },
};

/* Une clé absente rend la version anglaise, puis la clé elle-même : une
   traduction oubliée doit se voir, pas disparaître en silence. */
function texteDe(cle, valeurs) {
  const brut = TEXTES[LANGUE][cle] ?? TEXTES[REPLI][cle] ?? cle;
  if (!valeurs) return brut;
  return brut.replace(/\{(\w+)\}/g, (entier, nom) => (
    nom in valeurs ? String(valeurs[nom]) : entier
  ));
}

module.exports = { LANGUE, LANGUES, REPLI, TEXTES, texteDe, detecterLangue };
