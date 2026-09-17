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
  for (const p of game.joueurs.values()) {
    if (p.slot !== null && p.slot < battletags.length) p.battletag = battletags[p.slot];
  }
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
   LA CHARGE UTILE

   Ce que le pont envoie a l'EBS, et que l'overlay recoit. Compacte a dessein :
   le PubSub de Twitch plafonne a 5 Ko par message, et c'est l'overlay qui
   traduit les identifiants en noms et en icones.

   Le discriminant du battletag est retire ici, a la source. « Eowea#21654 »
   devient « Eowea ». Les neuf autres joueurs d'une partie n'ont rien demande :
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

const CHARGE_VIDE = { v: 1, t: 0, carte: null, bans: [], j: [] };

module.exports = {
  findTrackerFiles,
  watchGame,
  readBattletags,
  attachNames,
  chargeUtile,
  sansDiscriminant,
  CHARGE_VIDE,
  TRACKER_NAME,
};
