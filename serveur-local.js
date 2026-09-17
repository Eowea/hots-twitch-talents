#!/usr/bin/env node
/* =========================================================================
   SERVEUR LOCAL — pour voir l'overlay tourner avant de brancher Twitch

     node serveur-local.js                  suit la partie en cours
     node serveur-local.js --demo "<replay.StormReplay>"
                                            rejoue une vraie partie, accélérée
     node serveur-local.js --demo ... --vitesse 20
     node serveur-local.js --http           sans TLS, pour un simple coup d'œil
     node serveur-local.js --port 9443      si 8443 est pris lui aussi

   Il sert le dossier extension/ et expose /etat, qui rend exactement la charge
   utile que l'EBS enverra plus tard par PubSub. L'overlay ne verra donc aucune
   différence le jour où on branchera Twitch.

   Twitch exige du HTTPS, y compris en test local : le serveur fabrique au
   besoin un certificat auto-signé avec openssl. Le navigateur affichera un
   avertissement une fois — c'est normal pour un certificat local.
   ========================================================================= */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const bl = require('./battlelobby.js');
const mpq = require('./mpq.js');
const tracker = require('./tracker.js');
const live = require('./live.js');

const RACINE = path.join(__dirname, 'extension');
const CERTS = path.join(__dirname, 'certs');

/* 8080 et 8081 sont souvent occupes par d'autres outils d'un PC de stream
   (NVIDIA Broadcast, Streamer.bot...). On part donc plus haut, et le port
   reste reglable par --port. */
const PORT_DEFAUT = 8443;

/* =========================================================================
   LA CHARGE UTILE
   Compacte à dessein : le PubSub de Twitch plafonne à 5 Ko par message, et
   c'est l'overlay qui traduit les identifiants.
   ========================================================================= */

function chargeUtile(vue, carte) {
  return {
    v: 1,
    t: vue.seconde,
    carte: carte || null,
    bans: (vue.bans || []).map((b) => b.herosId).filter(Boolean),
    j: vue.joueurs.map((j) => ({
      e: j.equipe,
      n: j.battletag || null,
      h: j.herosId,
      l: j.niveau,
      t: j.talents,
    })),
  };
}

const VIDE = { v: 1, t: 0, carte: null, bans: [], j: [] };

/* =========================================================================
   SOURCE : LA PARTIE EN COURS
   ========================================================================= */

function suivrePartieReelle(etat) {
  live.watchGame((vue) => {
    etat.courant = vue === null ? VIDE : chargeUtile(vue);
    if (vue === null) console.log('partie terminée');
    else console.log(`  ${vue.seconde}s — ${vue.joueurs.length} joueurs`);
  });
  console.log('En attente d\'une partie. Lance Heroes of the Storm.');
}

/* =========================================================================
   SOURCE : UNE PARTIE REJOUEE
   Le décodeur donne les événements horodatés ; il suffit de les resservir au
   rythme voulu pour simuler une partie en direct, sans lancer le jeu.
   ========================================================================= */

function rejouer(etat, fichier, vitesse) {
  const evenements = new tracker.TrackerStream()
    .push(mpq.extractFile(fichier, live.TRACKER_NAME));

  const partie = tracker.newGame();
  let battletags = [];
  try {
    battletags = bl.parseLobby(mpq.extractFile(fichier, bl.LOBBY_NAME))
      .battletags.map((t) => t.full);
  } catch {
    // Replay sans lobby : on affichera les numéros de joueur.
  }

  const carte = path.basename(fichier, '.StormReplay').replace(/^[\d.\s-]+/, '');
  const dernier = evenements.length ? evenements[evenements.length - 1].seconde : 0;
  const debut = Date.now();
  let curseur = 0;

  console.log(`Rejeu de « ${carte} » : ${evenements.length} événements, `
    + `${Math.round(dernier / 60)} min de partie à ${vitesse}x`);

  const avancer = () => {
    const horloge = ((Date.now() - debut) / 1000) * vitesse;
    while (curseur < evenements.length && evenements[curseur].seconde <= horloge) {
      tracker.apply(partie, [evenements[curseur]]);
      curseur++;
    }
    live.attachNames(partie, battletags);
    etat.courant = chargeUtile(tracker.table(partie), carte);

    if (curseur >= evenements.length) {
      clearInterval(minuterie);
      console.log('rejeu terminé');
    }
  };

  const minuterie = setInterval(avancer, 500);
  avancer();
}

/* =========================================================================
   CERTIFICAT
   ========================================================================= */

function certificat() {
  const cle = path.join(CERTS, 'localhost.key');
  const cert = path.join(CERTS, 'localhost.crt');
  if (fs.existsSync(cle) && fs.existsSync(cert)) {
    return { key: fs.readFileSync(cle), cert: fs.readFileSync(cert) };
  }

  fs.mkdirSync(CERTS, { recursive: true });
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', cle, '-out', cert,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
    console.log(`certificat auto-signé créé dans ${CERTS}`);
    return { key: fs.readFileSync(cle), cert: fs.readFileSync(cert) };
  } catch {
    return null; // openssl absent : l'appelant retombera sur HTTP.
  }
}

/* =========================================================================
   SERVEUR
   ========================================================================= */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/* Accès au réseau privé : depuis Chrome 130 environ, une page publique
   (dashboard.twitch.tv) qui charge une ressource sur localhost est bloquée si
   le serveur local ne l'autorise pas explicitement. Chrome envoie d'abord une
   requête OPTIONS de contrôle ; sans ces en-têtes, l'iframe reste noire et
   aucune erreur n'apparaît dans l'onglet Réseau. */
const ENTETES_RESEAU_PRIVE = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-private-network': 'true',
};

function servir(etat) {
  return (requete, reponse) => {
    const url = new URL(requete.url, 'https://localhost');

    if (requete.method === 'OPTIONS') {
      reponse.writeHead(204, { ...ENTETES_RESEAU_PRIVE, 'access-control-max-age': '86400' });
      reponse.end();
      return;
    }

    if (url.pathname === '/etat') {
      const corps = JSON.stringify(etat.courant);
      reponse.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...ENTETES_RESEAU_PRIVE,
      });
      reponse.end(corps);
      return;
    }

    const demande = url.pathname === '/' ? '/video_overlay.html' : url.pathname;
    const fichier = path.join(RACINE, path.normalize(demande).replace(/^(\.\.[/\\])+/, ''));
    if (!fichier.startsWith(RACINE)) { reponse.writeHead(403).end(); return; }

    fs.readFile(fichier, (err, contenu) => {
      if (err) { reponse.writeHead(404).end('introuvable'); return; }
      reponse.writeHead(200, {
        'content-type': TYPES[path.extname(fichier)] || 'application/octet-stream',
        'cache-control': 'no-store',
        ...ENTETES_RESEAU_PRIVE,
      });
      reponse.end(contenu);
    });
  };
}

/* =========================================================================
   POINT D'ENTREE
   ========================================================================= */

function main() {
  const args = process.argv.slice(2);
  const valeur = (nom) => {
    const i = args.indexOf(nom);
    return i !== -1 ? args[i + 1] : null;
  };

  const etat = { courant: VIDE };
  const port = Number(valeur('--port') || PORT_DEFAUT);
  const demo = valeur('--demo');
  const vitesse = Number(valeur('--vitesse') || 10);

  if (demo) {
    if (!fs.existsSync(demo)) {
      console.error(`introuvable : ${demo}`);
      process.exit(1);
    }
    rejouer(etat, demo, vitesse);
  } else {
    suivrePartieReelle(etat);
  }

  const tls = args.includes('--http') ? null : certificat();
  const serveur = tls ? https.createServer(tls, servir(etat)) : http.createServer(servir(etat));
  const schema = tls ? 'https' : 'http';

  serveur.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`\nLe port ${port} est déjà pris par un autre programme.`);
    console.error('Relance avec un autre port :  node serveur-local.js --port 9443');
    process.exit(1);
  });

  serveur.listen(port, () => {
    console.log(`\n  ${schema}://localhost:${port}/`);
    if (!tls) console.log('  (sans TLS : Twitch exigera du HTTPS pour le test local)');
    console.log('\nCtrl+C pour arrêter.\n');
  });
}

main();
