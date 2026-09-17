#!/usr/bin/env node
/* =========================================================================
   LE PONT — de ta partie vers l'EBS

   Tourne sur ton PC pendant que tu joues : il suit la partie, en fait la
   charge utile, et la pousse à l'EBS, qui la diffuse aux viewers.

   Configuration, par variables d'environnement ou par pont.config.json (le
   fichier est ignoré par git) :

     EBS_URL      adresse de l'EBS, par exemple https://localhost:8081
     CANAL        ton identifiant de chaîne Twitch
     JETON        le jeton d'appairage, donné par la page de configuration

   Le jeton n'autorise qu'une chose : publier sur ta chaîne. Il ne donne aucun
   accès à ton compte Twitch, et tu peux le révoquer en le régénérant.

     node pont.js
     node pont.js --demo "<replay.StormReplay>" --vitesse 20
     node pont.js --dernier --vitesse 20      rejoue la derniere partie jouee
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const bl = require('./battlelobby.js');
const mpq = require('./mpq.js');
const tracker = require('./tracker.js');
const live = require('./live.js');

const CONFIG = path.join(__dirname, 'pont.config.json');

// Twitch tolère 100 messages par minute et par chaîne. Une partie n'en produit
// pas le dixième, mais cet intervalle garantit qu'on n'en approchera jamais.
const INTERVALLE_MIN = 2000;

function reglages() {
  let fichier = {};
  try {
    fichier = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    // Pas de fichier : on s'en remet à l'environnement.
  }
  return {
    ebs: process.env.EBS_URL || fichier.ebs || '',
    canal: String(process.env.CANAL || fichier.canal || ''),
    jeton: process.env.JETON || fichier.jeton || '',
  };
}

/* =========================================================================
   LA CHARGE UTILE
   Identiques à celle de serveur-local.js : l'overlay ne doit voir aucune
   différence entre le test local et le direct.
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

/* =========================================================================
   ENVOI
   ========================================================================= */

function creerEnvoyeur({ ebs, canal, jeton }) {
  let derniere = 0;
  let dernierCorps = '';
  let enAttente = null;
  let minuterie = null;

  const pousser = async (charge) => {
    const corps = JSON.stringify(charge);
    if (corps === dernierCorps) return; // Rien n'a bougé : on n'envoie pas.

    try {
      const reponse = await fetch(`${ebs}/publier`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jeton}`,
          'x-canal': canal,
          'content-type': 'application/json',
        },
        body: corps,
      });

      if (!reponse.ok) {
        console.error(`  envoi refusé : HTTP ${reponse.status} ${await reponse.text()}`);
        return;
      }
      dernierCorps = corps;
      derniere = Date.now();
      const taille = Buffer.byteLength(corps);
      console.log(`  ${charge.t}s — ${charge.j.length} joueurs — ${taille} octets`);
    } catch (err) {
      console.error(`  EBS injoignable : ${err.message}`);
    }
  };

  /* On ne pousse jamais plus d'un message toutes les deux secondes ; le
     dernier état reçu entre-temps part à l'échéance. */
  return (charge) => {
    const reste = INTERVALLE_MIN - (Date.now() - derniere);
    if (reste <= 0) { pousser(charge); return; }

    enAttente = charge;
    if (minuterie) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      const differee = enAttente;
      enAttente = null;
      if (differee) pousser(differee);
    }, reste);
  };
}

/* Les noms de replay contiennent accents et apostrophes typographiques : les
   recopier a la main est une source d'erreur inutile. --dernier evite ca. */
function dernierReplay() {
  const racine = path.join(os.homedir(), 'Documents', 'Heroes of the Storm', 'Accounts');
  const trouves = [];

  const parcourir = (dossier, profondeur) => {
    if (profondeur > 5) return;
    let entrees = [];
    try {
      entrees = fs.readdirSync(dossier, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin, profondeur + 1);
      else if (entree.name.endsWith('.StormReplay')) {
        trouves.push({ chemin, date: fs.statSync(chemin).mtimeMs });
      }
    }
  };

  parcourir(racine, 0);
  if (!trouves.length) {
    console.error('Aucun replay trouvé sous Documents\\Heroes of the Storm.');
    process.exit(1);
  }
  trouves.sort((a, b) => b.date - a.date);
  console.log(`Dernière partie : ${path.basename(trouves[0].chemin)}`);
  return trouves[0].chemin;
}

/* =========================================================================
   SOURCES
   ========================================================================= */

function suivrePartie(envoyer) {
  console.log('En attente d\'une partie. Lance Heroes of the Storm.\n');
  live.watchGame((vue) => {
    if (vue === null) {
      console.log('partie terminée');
      envoyer({ v: 1, t: 0, carte: null, bans: [], j: [] });
      return;
    }
    envoyer(chargeUtile(vue));
  });
}

function rejouer(envoyer, fichier, vitesse) {
  const evenements = new tracker.TrackerStream()
    .push(mpq.extractFile(fichier, live.TRACKER_NAME));
  const partie = tracker.newGame();

  let battletags = [];
  try {
    battletags = bl.parseLobby(mpq.extractFile(fichier, bl.LOBBY_NAME))
      .battletags.map((t) => t.full);
  } catch {
    // Replay sans lobby : les numéros de joueur feront l'affaire.
  }

  const carte = path.basename(fichier, '.StormReplay').replace(/^[\d.\s-]+/, '');
  const debut = Date.now();
  let curseur = 0;

  console.log(`Rejeu de « ${carte} » à ${vitesse}x\n`);

  const minuterie = setInterval(() => {
    const horloge = ((Date.now() - debut) / 1000) * vitesse;
    while (curseur < evenements.length && evenements[curseur].seconde <= horloge) {
      tracker.apply(partie, [evenements[curseur]]);
      curseur++;
    }
    live.attachNames(partie, battletags);
    envoyer(chargeUtile(tracker.table(partie), carte));
    if (curseur >= evenements.length) {
      clearInterval(minuterie);
      console.log('\nrejeu terminé');
    }
  }, 1000);
}

/* =========================================================================
   DEMARRAGE
   ========================================================================= */

function main() {
  const args = process.argv.slice(2);
  const valeur = (nom) => {
    const i = args.indexOf(nom);
    return i !== -1 ? args[i + 1] : null;
  };

  const config = reglages();
  const manques = [!config.ebs && 'EBS_URL', !config.canal && 'CANAL', !config.jeton && 'JETON']
    .filter(Boolean);

  if (manques.length) {
    console.error(`Réglages manquants : ${manques.join(', ')}`);
    console.error(`Renseigne-les dans l'environnement, ou dans ${CONFIG} :`);
    console.error('  { "ebs": "https://...", "canal": "123456", "jeton": "..." }');
    console.error('\nLe jeton vient de la page de configuration de ton extension.');
    process.exit(1);
  }

  console.log(`EBS   : ${config.ebs}`);
  console.log(`Chaîne: ${config.canal}\n`);

  const envoyer = creerEnvoyeur(config);
  const demo = args.includes('--dernier') ? dernierReplay() : valeur('--demo');

  if (demo) {
    if (!fs.existsSync(demo)) { console.error(`introuvable : ${demo}`); process.exit(1); }
    rejouer(envoyer, demo, Number(valeur('--vitesse') || 20));
  } else {
    suivrePartie(envoyer);
  }
}

main();
