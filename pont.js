#!/usr/bin/env node
/* =========================================================================
   LE PONT — de ta partie vers l'EBS

   Tourne sur ton PC pendant que tu joues : il suit la partie, en fait la
   charge utile, et la pousse à l'EBS, qui la diffuse aux viewers.

   Au premier démarrage, il demande le code d'appairage que la configuration
   de l'extension affiche sur ta chaîne, puis le retient dans pont.config.json.
   Il n'y a rien d'autre à régler.

   Ce code n'autorise qu'une chose : publier le tableau des talents sur ta
   chaîne. Il ne donne aucun accès à ton compte Twitch, et tu peux le révoquer
   en le régénérant depuis la même page.

     node pont.js                             suit la partie en cours
     node pont.js --dernier --vitesse 20      rejoue la dernière partie jouée
     node pont.js --demo "<replay>" --vitesse 20
     node pont.js --code <code>               appairage sans question posée
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const readline = require('readline');
const path = require('path');

const bl = require('./battlelobby.js');
const mpq = require('./mpq.js');
const tracker = require('./tracker.js');
const live = require('./live.js');

/* Où le lecteur range sa configuration. Empaqueté en exécutable, il n'a plus
   de dossier de code : elle se pose alors à côté de l'exe, là où le streamer
   peut la voir, la sauvegarder ou la supprimer pour se réappairer. */
const DOSSIER = (() => {
  try {
    // eslint-disable-next-line global-require
    return require('node:sea').isSea() ? path.dirname(process.execPath) : __dirname;
  } catch {
    return __dirname; // Node trop ancien pour node:sea : on est forcément en source.
  }
})();

const CONFIG = path.join(DOSSIER, 'pont.config.json');

// Twitch tolère 100 messages par minute et par chaîne. Une partie n'en produit
// pas le dixième, mais cet intervalle garantit qu'on n'en approchera jamais.
const INTERVALLE_MIN = 2000;

/* La fonction ne garde aucun historique : un viewer qui ouvre le tableau entre
   deux prises de talents n'aurait donc rien à afficher. On republie le même
   état toutes les dix secondes pour qu'il n'attende jamais plus longtemps.
   Six messages par minute au pire : très loin du plafond de Twitch. */
const RAPPEL = 10000;

/* =========================================================================
   APPAIRAGE

   Le code vient de la page de configuration de l'extension. Il emballe
   l'adresse de l'EBS, l'identifiant de chaîne et le jeton — pour que le
   streamer n'ait qu'une seule chose à copier, une seule fois.
   ========================================================================= */

function decoder(code) {
  let contenu;
  try {
    contenu = JSON.parse(Buffer.from(String(code).trim(), 'base64url').toString('utf8'));
  } catch {
    // L'erreur d'analyse brute n'apprendrait rien à qui a simplement mal copié.
    throw new Error('il semble tronqué ou mal copié');
  }
  const { e, c, j } = contenu;
  if (!e || !c || !j) throw new Error('il lui manque une partie');
  return { ebs: e, canal: String(c), jeton: j };
}

function demanderCode() {
  const lecture = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resoudre) => {
    console.log('');
    console.log('Premier démarrage.');
    console.log('');
    console.log("Ouvre la configuration de l'extension Talents sur ta chaîne Twitch,");
    console.log("et copie le code d'appairage qu'elle affiche.");
    console.log('');
    lecture.question('Colle-le ici : ', (reponse) => {
      lecture.close();
      resoudre(reponse);
    });
  });
}

async function premierDemarrage() {
  for (let essai = 0; essai < 3; essai++) {
    const code = await demanderCode();
    try {
      const config = decoder(code);
      fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      console.log('');
      console.log(`Appairé à la chaîne ${config.canal}.`);
      console.log("C'est retenu : tu n'auras plus à le refaire.");
      console.log('');
      return config;
    } catch (err) {
      console.log('');
      console.log(`Ce code n'est pas valide (${err.message}). Réessaie.`);
    }
  }
  console.error('Trois essais infructueux. Vérifie le code sur la page de configuration.');
  return process.exit(1);
}

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
   ENVOI
   ========================================================================= */

function creerEnvoyeur({ ebs, canal, jeton }) {
  let derniere = 0;
  let dernierCorps = '';
  let enAttente = null;
  let minuterie = null;

  const pousser = async (charge, rappel = false) => {
    const corps = JSON.stringify(charge);
    // Rien n'a bougé : on n'envoie que s'il est temps de rappeler l'état.
    if (corps === dernierCorps && !rappel) return;

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
      const suffixe = rappel ? '  (rappel)' : '';
      console.log(`  ${charge.t}s — ${charge.j.length} joueurs — ${taille} octets${suffixe}`);
    } catch (err) {
      console.error(`  EBS injoignable : ${err.message}`);
    }
  };

  /* Le rappel périodique : il ne part que si rien d'autre n'est parti
     entre-temps, donc il ne s'ajoute jamais au trafic d'une partie animée. */
  setInterval(() => {
    if (!enAttente && dernierCorps && Date.now() - derniere >= RAPPEL) {
      pousser(JSON.parse(dernierCorps), true);
    }
  }, RAPPEL).unref();

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
      envoyer(live.CHARGE_VIDE);
      return;
    }
    envoyer(live.chargeUtile(vue));
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
    envoyer(live.chargeUtile(tracker.table(partie), carte));
    if (curseur >= evenements.length) {
      clearInterval(minuterie);
      console.log('\nrejeu terminé');
    }
  }, 1000);
}

/* =========================================================================
   DEMARRAGE
   ========================================================================= */

async function main() {
  const args = process.argv.slice(2);
  const valeur = (nom) => {
    const i = args.indexOf(nom);
    return i !== -1 ? args[i + 1] : null;
  };

  let config = reglages();

  // --code sert aux installations automatisées ; sans lui, on demande.
  const fourni = valeur('--code');
  if (fourni) {
    config = decoder(fourni);
    fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    console.log(`Appairé à la chaîne ${config.canal}.`);
  } else if (!config.ebs || !config.canal || !config.jeton) {
    config = await premierDemarrage();
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

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
