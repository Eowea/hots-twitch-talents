/* =========================================================================
   SUIVI EN DIRECT — de la partie en cours au tableau de talents

   C'est le cœur de l'application compagnon : elle surveille le fichier que le
   jeu alimente, décode ce qui est nouveau, et annonce le tableau à jour. Le
   pont vers Twitch se branchera ici, sur onUpdate.

   Trois précautions, toutes tirées de ce qu'on a observé :
   - le fichier est écrit par blocs de 4 Ko, donc la queue est souvent coupée :
     TrackerStream sait s'arrêter net et reprendre ;
   - le jeu efface son dossier entre deux parties, et une nouvelle partie
     repart d'un fichier plus court : on repart alors de zéro ;
   - le lobby, lui, n'est écrit qu'une fois : il donne les battletags, que le
     tracker ne connaît pas.
   ========================================================================= */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const bl = require('./battlelobby.js');
const tracker = require('./tracker.js');

const TRACKER_NAME = 'replay.tracker.events';

/* Windows ne vide pas toujours le dossier temporaire en fin de partie : le
   fichier de la partie précédente peut y traîner des heures. Pendant une
   partie, il est réécrit toutes les quinze secondes environ — au-delà de ce
   délai sans écriture, on considère qu'il n'y a pas de partie en cours. */
const FRAICHEUR_MAX = 5 * 60 * 1000;

/* Même dossier que le battlelobby, même logique de recherche : le suffixe du
   dossier varie d'une instance du jeu à l'autre. */
function findTrackerFiles() {
  let entries = [];
  try {
    entries = fs.readdirSync(bl.lobbyRoot(), { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(bl.lobbyRoot(), entry.name, TRACKER_NAME);
    try {
      const st = fs.statSync(file);
      found.push({ path: file, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Dossier sans fichier de suivi : on passe.
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/* Les battletags viennent du lobby, le reste du tracker. On les relie par le
   slot : le lobby les écrit dans l'ordre des slots, et PlayerSetup donne le
   slot de chaque joueur. */
async function readBattletags() {
  const [lobby] = bl.findLobbyFiles();
  if (!lobby) return [];
  try {
    return bl.parseLobby(await bl.readLobby(lobby.path)).battletags.map((t) => t.full);
  } catch {
    return [];
  }
}

function attachNames(game, battletags) {
  if (battletags.length === 0) return;

  /* Le lobby ne liste que les joueurs HUMAINS, dans l'ordre des slots — pas
     les dix places. Indexer par le numero de slot marchait tant que la partie
     etait pleine d'humains, et se decalait des qu'une IA occupait une place :
     contre l'IA, le pseudo du diffuseur se posait sur le heros du slot 0, un
     bot, pendant que son propre heros restait anonyme.

     On apparie donc le i-eme battletag au i-eme humain. */
  const humains = [...game.joueurs.values()]
    .filter((p) => p.humain === true && p.slot !== null)
    .sort((a, b) => a.slot - b.slot);

  humains.forEach((p, i) => {
    if (i < battletags.length) p.battletag = battletags[i];
  });
}

/* =========================================================================
   BOUCLE
   ========================================================================= */

function watchGame(onUpdate, { intervalMs = 1000, onError = console.error } = {}) {
  let current = null; // { path, stream, game, lastSize, battletags }

  const reset = (file) => ({
    path: file.path,
    stream: new tracker.TrackerStream(),
    game: tracker.newGame(),
    lastSize: 0,
    battletags: [],
  });

  const tick = async () => {
    const [recent] = findTrackerFiles();
    // Un fichier qui ne bouge plus est le reliquat d'une partie terminée.
    const file = recent && Date.now() - recent.mtimeMs < FRAICHEUR_MAX ? recent : null;

    if (!file) {
      // Dossier effacé : la partie est finie, on oublie tout.
      if (current) { current = null; onUpdate(null); }
      return;
    }

    // Nouveau fichier, ou fichier reparti de plus bas : nouvelle partie.
    if (!current || current.path !== file.path || file.size < current.lastSize) {
      current = reset(file);
      current.battletags = await readBattletags();
    }
    if (file.size === current.lastSize) return; // Rien de neuf.
    current.lastSize = file.size;

    const buf = await fsp.readFile(file.path);
    const events = current.stream.push(buf);
    if (events.length === 0) return;

    tracker.apply(current.game, events);
    attachNames(current.game, current.battletags);
    onUpdate(tracker.table(current.game), { evenements: events.length, fichier: file.path });
  };

  const timer = setInterval(() => { tick().catch(onError); }, intervalMs);
  tick().catch(onError);
  return () => clearInterval(timer);
}

/* =========================================================================
   RECONNAITRE LE DIFFUSEUR

   Les dix joueurs se valent dans le fichier : rien n'y dit lequel tient la
   souris. Mais PlayerInit porte le ToonHandle de chacun, et les comptes
   installes sur ce PC sont des dossiers qui portent exactement cet
   identifiant :

     Documents/Heroes of the Storm/Accounts/<numero>/2-Hero-1-8537813/

   Le joueur dont le ToonHandle y figure est donc celui qui diffuse. Le
   tableau met alors son equipe a gauche et en bleu, comme le jeu la lui
   montre : sans ca, une partie sur deux, le viewer verrait les couleurs
   inversees par rapport a l'image qu'il a sous les yeux.

   Seul le numero d'equipe quitte cette machine. Le ToonHandle, lui, reste
   ici — c'est un identifiant de compte, y compris pour les neuf autres.
   ========================================================================= */

const MOTIF_TOON = /^\d+-[A-Za-z]+-\d+-\d+$/;

/* Un PC peut avoir servi a plusieurs comptes — celui-ci en porte vingt-deux.
   « N'importe quel compte local » designerait donc parfois un adversaire. On
   les classe par la date du dossier de replays, qui change des qu'une partie
   s'y ecrit : celui qui joue est celui qui en a produit un en dernier.

   Relu toutes les minutes plutot qu'une fois pour toutes, pour qu'un
   changement de joueur sur la meme machine soit suivi. */
const FRAICHEUR_COMPTES = 60 * 1000;

let comptes = null;
let comptesLus = 0;

function comptesDuPC() {
  if (comptes && Date.now() - comptesLus < FRAICHEUR_COMPTES) return comptes;

  const racine = path.join(os.homedir(), 'Documents', 'Heroes of the Storm', 'Accounts');
  const trouves = [];

  let dossiers = [];
  try {
    dossiers = fs.readdirSync(racine, { withFileTypes: true });
  } catch {
    comptes = []; comptesLus = Date.now();
    return comptes; // Jeu installe ailleurs : on s'en passera.
  }

  for (const compte of dossiers) {
    if (!compte.isDirectory()) continue;
    let toons = [];
    try {
      toons = fs.readdirSync(path.join(racine, compte.name), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const toon of toons) {
      if (!toon.isDirectory() || !MOTIF_TOON.test(toon.name)) continue;

      /* La date du dossier suffit : elle change quand un replay s'y ajoute.
         Parcourir les 2 363 fichiers de l'un d'eux serait absurde. */
      let date = 0;
      for (const sous of ['Replays/Multiplayer', 'Replays']) {
        try {
          date = Math.max(date, fs.statSync(path.join(racine, compte.name, toon.name, sous)).mtimeMs);
        } catch {
          // Ce sous-dossier n'existe pas pour ce compte.
        }
      }
      if (date) trouves.push({ toon: toon.name, date });
    }
  }

  trouves.sort((a, b) => b.date - a.date);
  comptes = trouves;
  comptesLus = Date.now();
  return comptes;
}

/* Rend 1 ou 2 — l'equipe du diffuseur — ou null si on ne l'a pas reconnu :
   jeu installe ailleurs, compte tout neuf, ou partie observee. */
function equipeDuDiffuseur(vue) {
  const presents = new Map();
  for (const j of vue.joueurs) if (j.toon) presents.set(j.toon, j.equipe);
  if (!presents.size) return null;

  // Le compte le plus recemment actif qui joue effectivement cette partie.
  for (const { toon } of comptesDuPC()) {
    if (presents.has(toon)) return presents.get(toon);
  }
  return null;
}

/* =========================================================================
   LA CHARGE UTILE

   Ce que le pont envoie a l'EBS, et que l'overlay recoit. Compacte a dessein :
   le PubSub de Twitch plafonne a 5 Ko par message, et c'est l'overlay qui
   traduit les identifiants en noms et en icones.

   Le discriminant du battletag est retire ici, a la source. « Bnet#123456 »
   devient « Bnet ». Les neuf autres joueurs d'une partie n'ont rien demande :
   leur identifiant unique n'a donc aucune raison de quitter cette machine,
   encore moins d'etre diffuse a une audience. Le pseudo seul suffit largement
   a reconnaitre quelqu'un, et n'identifie personne a lui seul.
   ========================================================================= */

const sansDiscriminant = (tag) => (tag ? String(tag).split('#')[0] : null);

function chargeUtile(vue, carte) {
  return {
    v: 1,
    t: vue.seconde,
    carte: carte || null,
    m: equipeDuDiffuseur(vue), // L'equipe a mettre a gauche, ou null.
    bans: (vue.bans || []).map((b) => b.herosId).filter(Boolean),
    j: vue.joueurs.map((j) => ({
      e: j.equipe,
      n: sansDiscriminant(j.battletag),
      h: j.herosId,
      l: j.niveau,
      t: j.talents,
    })),
  };
}

const CHARGE_VIDE = { v: 1, t: 0, carte: null, m: null, bans: [], j: [] };

module.exports = {
  findTrackerFiles,
  watchGame,
  readBattletags,
  attachNames,
  chargeUtile,
  equipeDuDiffuseur,
  comptesDuPC,
  sansDiscriminant,
  CHARGE_VIDE,
  TRACKER_NAME,
};
