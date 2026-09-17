#!/usr/bin/env node
/* =========================================================================
   EBS — le service qui relie ton PC aux viewers

   Trois rôles, et trois seulement :

   1. recevoir l'état de la partie depuis ton PC (POST /publier) ;
   2. le diffuser aux viewers par le PubSub de Twitch ;
   3. le servir à ceux qui ouvrent le tableau en cours de partie (GET /etat),
      car le PubSub ne rejoue pas ce qui est déjà passé.

   Configuration, par ebs/config.json ou par variables d'environnement — dans
   les deux cas hors du dépôt :

     EXT_CLIENT_ID    identifiant client de l'extension (console Twitch)
     EXT_SECRET       secret de l'extension, en base64, tel que Twitch le donne
     EXT_PROPRIETAIRE identifiant utilisateur Twitch du propriétaire
     EBS_PORT         8444 par défaut

   Le fichier évite de taper le secret dans le terminal, où il resterait dans
   l'historique :

     { "clientId": "...", "secret": "...", "proprietaire": "..." }

   Le secret ne transite jamais vers un viewer ni vers ton PC : seul l'EBS le
   connaît. Ton PC s'authentifie avec un jeton d'appairage, propre à ta chaîne
   et révocable, que la page de configuration te montre.
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const jwt = require('./jwt.js');

/* L'environnement l'emporte sur le fichier : pratique en hébergement, où les
   secrets arrivent souvent par variables. */
function fichierConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

const CONFIG = fichierConfig();
// 8081 est souvent pris sur un PC de stream : on part plus haut.
const PORT = Number(process.env.EBS_PORT || CONFIG.port || 8444);
const CLIENT_ID = process.env.EXT_CLIENT_ID || CONFIG.clientId || '';
const SECRET_B64 = process.env.EXT_SECRET || CONFIG.secret || '';
const PROPRIETAIRE = process.env.EXT_PROPRIETAIRE || CONFIG.proprietaire || '';
const APPAIRAGES = path.join(__dirname, 'appairages.json');

// Twitch livre le secret en base64 : on le décode une fois pour toutes.
const SECRET = SECRET_B64 ? Buffer.from(SECRET_B64, 'base64') : null;

const API_PUBSUB = 'https://api.twitch.tv/helix/extensions/pubsub';
const TAILLE_MAX = 5 * 1024; // Plafond imposé par Twitch, par message.
const PEREMPTION = 5 * 60 * 1000; // Au-delà, l'état courant n'a plus de sens.

/* =========================================================================
   HISTORIQUE EN MEMOIRE

   Pas un seul état par chaîne, mais les derniers : un viewer qui ouvre le
   tableau en pleine partie est en retard de dix à vingt secondes sur nous. Lui
   servir l'état courant lui divulguerait des talents que son image ne montre
   pas encore. On garde donc de quoi remonter le temps d'autant.

   Pas de base de données : ces données ne survivent pas à la partie.
   ========================================================================= */

const HISTORIQUE_MAX = 40; // Un message toutes les 2 s : environ 80 s de recul.
const etats = new Map(); // canal -> [{ charge, recuLe }, ...] du plus ancien au plus récent

function enregistrer(canal, charge) {
  const suite = etats.get(canal) || [];
  suite.push({ charge, recuLe: Date.now() });
  while (suite.length > HISTORIQUE_MAX) suite.shift();
  etats.set(canal, suite);
}

const dernier = (canal) => {
  const suite = etats.get(canal);
  return suite && suite.length ? suite[suite.length - 1] : null;
};

/* L'état tel qu'il était il y a `retard` secondes — ou le plus ancien connu si
   l'historique ne remonte pas si loin. */
function etatRetarde(canal, retard) {
  const suite = etats.get(canal);
  if (!suite || !suite.length) return null;

  const cible = Date.now() - retard * 1000;
  let choisi = null;
  for (const entree of suite) {
    if (entree.recuLe <= cible) choisi = entree;
    else break;
  }
  return choisi || suite[0];
}

/* Les jetons d'appairage, eux, doivent survivre à un redémarrage. */
function lireAppairages() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(APPAIRAGES, 'utf8'))));
  } catch {
    return new Map();
  }
}

const appairages = lireAppairages(); // canal -> jeton

function ecrireAppairages() {
  fs.writeFileSync(APPAIRAGES, JSON.stringify(Object.fromEntries(appairages), null, 2), 'utf8');
}

function jetonDAppairage(canal) {
  if (!appairages.has(canal)) {
    appairages.set(canal, crypto.randomBytes(24).toString('base64url'));
    ecrireAppairages();
  }
  return appairages.get(canal);
}

/* =========================================================================
   DIFFUSION VERS TWITCH
   ========================================================================= */

async function diffuser(canal, charge) {
  const message = JSON.stringify(charge);
  if (Buffer.byteLength(message) > TAILLE_MAX) {
    throw new Error(`message de ${Buffer.byteLength(message)} octets : au-dessus des 5 Ko`);
  }

  const reponse = await fetch(API_PUBSUB, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt.jetonDeDiffusion(canal, PROPRIETAIRE, SECRET)}`,
      'client-id': CLIENT_ID,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      target: ['broadcast'],
      broadcaster_id: String(canal),
      is_global_broadcast: false,
      message,
    }),
  });

  if (!reponse.ok) {
    throw new Error(`PubSub : HTTP ${reponse.status} ${await reponse.text()}`);
  }
}

/* =========================================================================
   OUTILS HTTP
   ========================================================================= */

function repondre(reponse, code, corps) {
  const texte = typeof corps === 'string' ? corps : JSON.stringify(corps);
  reponse.writeHead(code, {
    'content-type': typeof corps === 'string'
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // L'extension est servie depuis le domaine de Twitch, pas depuis ici ; et
    // Chrome exige qu'un serveur local autorise explicitement les appels
    // venant d'une page publique.
    // « authorization » doit etre nomme : le joker « * » ne le couvre pas,
    // c'est une exception de la norme CORS. Or c'est l'en-tete que portent
    // tous nos appels.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-private-network': 'true',
    'access-control-max-age': '86400',
  });
  reponse.end(texte);
}

function lireCorps(requete, maxOctets = 64 * 1024) {
  return new Promise((resoudre, rejeter) => {
    let total = 0;
    const morceaux = [];
    requete.on('data', (morceau) => {
      total += morceau.length;
      if (total > maxOctets) { rejeter(new Error('corps trop volumineux')); requete.destroy(); return; }
      morceaux.push(morceau);
    });
    requete.on('end', () => resoudre(Buffer.concat(morceaux).toString('utf8')));
    requete.on('error', rejeter);
  });
}

const porteur = (requete) => String(requete.headers.authorization || '').replace(/^Bearer\s+/i, '');

/* Le jeton d'un viewer ou du diffuseur, signé par Twitch avec notre secret. */
function identiteTwitch(requete) {
  try {
    return jwt.verifier(porteur(requete), SECRET);
  } catch {
    return null;
  }
}

/* =========================================================================
   LES POINTS D'ENTREE
   ========================================================================= */

async function router(requete, reponse) {
  const url = new URL(requete.url, 'https://ebs');

  // Contrôle préalable de Chrome avant tout appel vers le réseau privé.
  if (requete.method === 'OPTIONS') { repondre(reponse, 204, ''); return; }

  /* --- Ton PC pousse l'état de la partie ------------------------------- */
  if (requete.method === 'POST' && url.pathname === '/publier') {
    const canal = String(requete.headers['x-canal'] || '');
    const jeton = porteur(requete);

    if (!canal || !appairages.has(canal) || appairages.get(canal) !== jeton) {
      repondre(reponse, 401, { erreur: 'appairage invalide' });
      return;
    }

    let charge;
    try {
      charge = JSON.parse(await lireCorps(requete));
    } catch {
      repondre(reponse, 400, { erreur: 'corps illisible' });
      return;
    }

    enregistrer(canal, charge);

    try {
      await diffuser(canal, charge);
      repondre(reponse, 200, { ok: true });
    } catch (err) {
      // L'état reste servi par /etat même si la diffusion échoue : les
      // viewers qui ouvrent le tableau verront quand même la partie.
      console.error('diffusion :', err.message);
      repondre(reponse, 502, { erreur: err.message });
    }
    return;
  }

  /* --- Un viewer ouvre le tableau en cours de partie -------------------- */
  if (requete.method === 'GET' && url.pathname === '/etat') {
    const identite = identiteTwitch(requete);
    if (!identite || !identite.channel_id) {
      repondre(reponse, 401, { erreur: 'jeton Twitch requis' });
      return;
    }

    // Le viewer annonce le retard de son flux : on lui rend l'état tel qu'il
    // était à ce moment-là, et non celui de la partie en cours.
    const retard = Math.min(60, Math.max(0, Number(url.searchParams.get('retard')) || 0));
    const entree = etatRetarde(String(identite.channel_id), retard);

    if (!entree || Date.now() - entree.recuLe > PEREMPTION) {
      repondre(reponse, 200, { v: 1, t: 0, carte: null, bans: [], j: [] });
      return;
    }
    repondre(reponse, 200, entree.charge);
    return;
  }

  /* --- La page de configuration demande le jeton d'appairage ------------ */
  if (requete.method === 'GET' && url.pathname === '/appairage') {
    const identite = identiteTwitch(requete);
    // Seul le diffuseur de la chaîne peut voir le jeton de sa chaîne.
    if (!identite || identite.role !== 'broadcaster' || !identite.channel_id) {
      repondre(reponse, 403, { erreur: 'réservé au diffuseur' });
      return;
    }
    const canal = String(identite.channel_id);
    repondre(reponse, 200, { canal, jeton: jetonDAppairage(canal) });
    return;
  }

  /* --- Le tableau de bord en direct ------------------------------------- */
  if (requete.method === 'GET' && url.pathname === '/statut') {
    const identite = identiteTwitch(requete);
    if (!identite || identite.role !== 'broadcaster' || !identite.channel_id) {
      repondre(reponse, 403, { erreur: 'réservé au diffuseur' });
      return;
    }
    const entree = dernier(String(identite.channel_id));
    repondre(reponse, 200, {
      connecte: Boolean(entree) && Date.now() - entree.recuLe < 15000,
      depuis: entree ? Date.now() - entree.recuLe : null,
      joueurs: entree ? entree.charge.j.length : 0,
      seconde: entree ? entree.charge.t : 0,
    });
    return;
  }

  repondre(reponse, 404, { erreur: 'inconnu' });
}

/* =========================================================================
   DEMARRAGE
   ========================================================================= */

function main() {
  const manques = [
    !CLIENT_ID && 'EXT_CLIENT_ID',
    !SECRET_B64 && 'EXT_SECRET',
    !PROPRIETAIRE && 'EXT_PROPRIETAIRE',
  ].filter(Boolean);

  if (manques.length) {
    console.error(`Réglages manquants : ${manques.join(', ')}`);
    console.error('Ils viennent de la console Twitch. Renseigne-les dans');
    console.error(`  ${path.join(__dirname, 'config.json')}`);
    console.error('  { "clientId": "...", "secret": "...", "proprietaire": "..." }');
    console.error("ou dans l'environnement. Ce fichier est ignoré par git.");
    process.exit(1);
  }

  // --http force le texte clair : utile pour les tests, et pour déboguer sans
  // la fenêtre d'avertissement du navigateur.
  const sansTls = process.argv.includes('--http');
  const certs = path.join(__dirname, '..', 'certs');
  const cle = path.join(certs, 'localhost.key');
  const cert = path.join(certs, 'localhost.crt');
  const tls = !sansTls && fs.existsSync(cle) && fs.existsSync(cert)
    ? { key: fs.readFileSync(cle), cert: fs.readFileSync(cert) }
    : null;

  const gestionnaire = (requete, reponse) => {
    router(requete, reponse).catch((err) => {
      console.error(err);
      repondre(reponse, 500, { erreur: 'erreur interne' });
    });
  };

  const serveur = tls ? https.createServer(tls, gestionnaire) : http.createServer(gestionnaire);

  serveur.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`
Le port ${PORT} est déjà pris par un autre programme.`);
    console.error('Choisis-en un autre dans ebs/config.json :  { "port": 9444, ... }');
    console.error('et reporte-le dans extension/reglages.js.');
    process.exit(1);
  });

  serveur.listen(PORT, () => {
    console.log(`EBS sur ${tls ? 'https' : 'http'}://localhost:${PORT}`);
    // Le mode clair est un choix quand on le demande, un manque sinon.
    if (sansTls) console.log('Mode clair demandé : prévois un tunnel HTTPS devant.');
    else if (!tls) {
      console.log('Sans TLS : lance d\'abord serveur-local.js une fois pour créer le certificat.');
    }
    console.log(`${appairages.size} chaîne(s) appairée(s)`);
  });
}

if (require.main === module) main();

module.exports = { router, diffuser };
