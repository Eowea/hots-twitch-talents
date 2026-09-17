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
    const [file] = findTrackerFiles();

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

module.exports = { findTrackerFiles, watchGame, readBattletags, attachNames, TRACKER_NAME };
