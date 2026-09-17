/* =========================================================================
   LECTEUR replay.server.battlelobby — Heroes of the Storm

   Au chargement d'une carte, le client écrit dans le dossier temporaire de
   Windows un fichier décrivant le lobby : les joueurs, leur région, leur
   collection... On se contente de LIRE ce fichier, que le jeu a écrit
   lui-même. Rien n'est injecté, aucune mémoire n'est lue : cette approche ne
   touche pas au client et ne présente pas de risque côté Blizzard.

   Le format est binaire et non documenté. Cette première version ne prétend
   pas le décoder : elle extrait les chaînes lisibles, y repère les battletags
   et les noms de héros, et garde tout le reste sous la main (mode "dump")
   pour qu'on cale le vrai décodage sur une partie réelle.
   ========================================================================= */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { HERO_TOKENS, WEAK_TOKEN_LENGTH } = require('./heroes.js');

const LOBBY_NAME = 'replay.server.battlelobby';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================================================================
   TROUVER LE FICHIER
   ========================================================================= */

/* Chemin : %TEMP%\Heroes of the Storm\TempWriteReplayP<n>\replay.server.battlelobby
   Le suffixe (P1, P2...) dépend de l'instance du jeu, et le PTR écrit dans son
   propre dossier : on balaie donc tous les sous-dossiers plutôt que d'en
   coder un en dur. */
function lobbyRoot() {
  return path.join(os.tmpdir(), 'Heroes of the Storm');
}

function findLobbyFiles() {
  let entries = [];
  try {
    entries = fs.readdirSync(lobbyRoot(), { withFileTypes: true });
  } catch {
    return []; // Le dossier n'existe pas tant que le jeu n'a pas tourne.
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(lobbyRoot(), entry.name, LOBBY_NAME);
    try {
      const st = fs.statSync(file);
      found.push({ path: file, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Sous-dossier sans fichier de lobby : normal, on passe.
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/* Le client garde le fichier ouvert pendant la partie. Node ouvre en lecture
   partagée, donc ça passe en général du premier coup ; on retente quand même
   quelques fois, le temps que l'écriture se termine. */
async function readLobby(filePath, { retries = 4, delayMs = 250 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fsp.readFile(filePath);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(delayMs);
    }
  }
  throw lastErr;
}

/* =========================================================================
   EXTRACTION DES CHAINES
   On parcourt le tampon en latin1 : un octet = un caractère, donc les
   décalages calculés ici pointent bien sur les octets du fichier. Les
   fragments retenus sont ensuite redécodés en UTF-8 pour l'affichage.
   ========================================================================= */

function toScanText(buf) {
  return buf.toString('latin1');
}

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

function decodeUtf8(latin1Slice) {
  const text = Buffer.from(latin1Slice, 'latin1').toString('utf8');
  // Découpage à cheval sur un caractère multi-octets : on jette le fragment.
  return text.includes(REPLACEMENT_CHAR) ? null : text;
}

function extractStrings(buf, minLen = 4) {
  const text = toScanText(buf);
  const out = [];
  let start = -1;

  for (let i = 0; i <= text.length; i++) {
    const code = i < text.length ? text.charCodeAt(i) : 0;
    const printable = code >= 0x20 && code !== 0x7f; // 0x80+ inclus : UTF-8 possible.
    if (printable) {
      if (start === -1) start = i;
      continue;
    }
    if (start !== -1 && i - start >= minLen) {
      const decoded = decodeUtf8(text.slice(start, i));
      if (decoded !== null) out.push({ offset: start, text: decoded });
    }
    start = -1;
  }
  return out;
}

/* =========================================================================
   BATTLETAGS
   Un battletag s'écrit Nom#1234. Le nom peut contenir des accents, stockés en
   UTF-8 : dans notre lecture latin1 ils apparaissent comme des octets 0x80+,
   d'où la classe de caractères élargie.

   Le client écrit la chaîne précédée de sa longueur en octets, sur un octet :

       0d 54 72 75 65 50 79 72 6f 23 31 39 30 33
       ^^ 13    T  r  u  e  P  y  r  o  #  1  9  0  3

   Vérifié sur 589 battletags tirés de 58 parties : 589 préfixes justes. On
   s'en sert comme filtre, ce qui élimine d'office les collisions fortuites
   avec des données binaires.
   ========================================================================= */

/* Le discriminant passe à 8 chiffres sur les comptes récents (les
   « Aventurier#23102254 » attribués d'office) : viser trop court coupe le
   battletag en plein milieu et le fait rejeter par le contrôle de longueur. */
const BATTLETAG_RE = /[A-Za-z-ÿ][A-Za-z0-9-ÿ_.-]{1,23}#\d{2,10}/g;

function findBattletags(buf, { requireLengthPrefix = true } = {}) {
  const text = toScanText(buf);
  // On garde la première occurrence : l'ordre du fichier est celui des slots.
  const seen = new Map();

  for (const match of text.matchAll(BATTLETAG_RE)) {
    const decoded = decodeUtf8(match[0]);
    if (decoded === null) continue;

    const hash = decoded.lastIndexOf('#');
    const name = decoded.slice(0, hash);
    const tag = decoded.slice(hash + 1);
    if (name.length < 2) continue;

    // La longueur annoncée compte des octets, pas des caractères.
    const byteLength = Buffer.byteLength(decoded, 'utf8');
    const prefixed = match.index > 0 && buf[match.index - 1] === byteLength;
    if (requireLengthPrefix && !prefixed) continue;

    if (!seen.has(decoded)) {
      seen.set(decoded, { full: decoded, name, tag, offset: match.index, prefixed });
    }
  }
  return [...seen.values()];
}

/* =========================================================================
   HEROS — diagnostic seulement

   Attention : le héros N'EST PAS dans le battlelobby. Vérifié sur un
   échantillon de 75 parties (ARAM et cartes classiques, 2026) : sur 174 noms
   de héros connus par ailleurs, 12 "correspondances" seulement, toutes des
   collisions fortuites sur des jetons courts (Ana, Chen, Xul...).

   C'est logique : le fichier est écrit à la création du lobby, avant la
   sélection en mode draft et en ARAM. Le nom du héros, lui, apparaît en clair
   dans replay.details — mais seulement en fin de partie.

   La fonction reste ici pour le mode dump : le jour où un mode de jeu range
   le héros quelque part, c'est elle qui le verra. Elle ne sert pas au
   dépouillement normal.
   ========================================================================= */

const isWordByte = (code) =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);

function findHeroMentions(buf) {
  const text = toScanText(buf);
  const mentions = [];

  for (const [tokens, hero] of HERO_TOKENS) {
    for (const token of tokens) {
      let from = 0;
      for (;;) {
        const at = text.indexOf(token, from);
        if (at === -1) break;
        from = at + 1;

        const before = at > 0 ? text.charCodeAt(at - 1) : 0;
        const after = at + token.length < text.length ? text.charCodeAt(at + token.length) : 0;
        if (isWordByte(before) || isWordByte(after)) continue; // Jeton noyé dans un mot plus long.

        mentions.push({ hero, token, offset: at, weak: token.length < WEAK_TOKEN_LENGTH });
      }
    }
  }
  return mentions.sort((a, b) => a.offset - b.offset);
}

/* =========================================================================
   LECTURE COMPLETE
   ========================================================================= */

function parseLobby(buf) {
  const battletags = findBattletags(buf);

  return {
    size: buf.length,
    battletags,
    // 10 joueurs = partie normale. Au-delà, il y a des observateurs dans le lobby.
    playerCount: battletags.length,
    hasObservers: battletags.length > 10,
  };
}

/* =========================================================================
   SURVEILLANCE
   fs.watch est capricieux sur %TEMP% (le jeu crée et supprime ses dossiers) :
   un sondage d'une seconde est plus simple et largement suffisant, le fichier
   n'étant écrit qu'une fois par partie. On attend deux relevés de taille
   identique avant de lire, pour ne pas tomber sur une écriture en cours.
   ========================================================================= */

function watchLobbies(onLobby, { intervalMs = 1000, onError = console.error } = {}) {
  const pending = new Map(); // chemin -> dernière taille vue
  const handled = new Set(); // chemin + taille + mtime déjà traités

  const tick = async () => {
    for (const file of findLobbyFiles()) {
      const key = `${file.path}|${file.size}|${Math.round(file.mtimeMs)}`;
      if (handled.has(key)) continue;

      if (pending.get(file.path) !== file.size) {
        pending.set(file.path, file.size); // Taille encore mouvante : on attend le tour suivant.
        continue;
      }

      handled.add(key);
      try {
        const buf = await readLobby(file.path);
        await onLobby({ file, buf, lobby: parseLobby(buf) });
      } catch (err) {
        onError(err);
      }
    }
  };

  const timer = setInterval(() => { tick().catch(onError); }, intervalMs);
  tick().catch(onError);
  return () => clearInterval(timer);
}

module.exports = {
  LOBBY_NAME,
  lobbyRoot,
  findLobbyFiles,
  readLobby,
  extractStrings,
  findBattletags,
  findHeroMentions,
  parseLobby,
  watchLobbies,
};
