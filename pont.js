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
     node pont.js --langue en                 force la langue (sinon : celle
                                              des paramètres régionaux)
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
const vue = require('./affichage.js');
const { texteDe } = require('./textes.js');

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
    throw new Error(texteDe('codeTronque'));
  }
  const { e, c, j } = contenu;
  if (!e || !c || !j) throw new Error(texteDe('codeIncomplet'));
  return { ebs: e, canal: String(c), jeton: j };
}

function demanderCode() {
  const lecture = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resoudre) => {
    console.log('');
    console.log(texteDe('premierDemarrage'));
    console.log('');
    console.log(texteDe('ouvreConfig'));
    console.log(texteDe('copieCode'));
    console.log('');
    lecture.question(texteDe('colleIci'), (reponse) => {
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
      vue.dire(`  ${texteDe('appaire', { canal: config.canal })}`);
      console.log(texteDe('retenu'));
      console.log('');
      return config;
    } catch (err) {
      console.log('');
      console.log(texteDe('codeInvalide', { motif: err.message }));
    }
  }
  console.error(texteDe('troisEssais'));
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
  let derniereEmpreinte = '';
  let dernierEtat = null; // Toujours le plus frais, chrono compris.
  let differe = false;
  let minuterie = null;

  /* Ce qu'on compare pour décider d'envoyer — tout sauf le chrono.

     Il avançait d'une seconde à chaque seconde, donc deux états successifs
     n'étaient jamais identiques, donc le dédoublonnage ne servait à rien et
     le lecteur envoyait au plafond de deux secondes toute la partie : mesuré
     à 25,6 messages par minute, pour 70 changements de talent en vingt
     minutes. En laissant le chrono de côté on tombe à 8,9, et c'est
     l'extension qui fait avancer l'horloge entre deux messages. */
  const empreinte = (charge) => JSON.stringify({ ...charge, t: 0 });

  const pousser = async (charge, rappel = false) => {
    const signature = empreinte(charge);
    // Rien de visible n'a bougé : on n'envoie que s'il est temps de rappeler.
    if (signature === derniereEmpreinte && !rappel) return;

    const corps = JSON.stringify(charge);

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
        // 401 : l'appairage ne vaut plus. Tout le reste est de notre côté.
        if (reponse.status === 401) vue.appairageRefuse();
        else vue.envoiRefuse(reponse.status);
        vue.detail(texteDe('detailRefus', {
          code: reponse.status,
          corps: await reponse.text(),
        }));
        return;
      }

      derniereEmpreinte = signature;
      derniere = Date.now();
      vue.retabli();

      if (charge.j.length) vue.partie(charge);
      vue.detail(texteDe('detailEnvoi', {
        temps: charge.t,
        joueurs: charge.j.length,
        octets: Buffer.byteLength(corps),
        rappel: rappel ? texteDe('detailRappel') : '',
      }));
    } catch (err) {
      vue.reseauCoupe();
      vue.detail(texteDe('detailEnvoiImpossible', { motif: err.message }));
    }
  };

  /* Le rappel périodique : il ne part que si rien d'autre n'est parti
     entre-temps, donc il ne s'ajoute jamais au trafic d'une partie animée.

     C'est lui qui porte maintenant l'horloge : il republie l'état courant —
     pas celui qu'on avait envoyé — pour que le chrono du viewer se recale
     toutes les dix secondes sur celui de la partie. */
  setInterval(() => {
    if (differe || !dernierEtat || Date.now() - derniere < RAPPEL) return;

    /* Et il s'arrete des qu'il n'y a plus de partie. Sans cette condition, un
       lecteur laisse ouvert toute la journee republierait un tableau vide
       toutes les dix secondes : pres de neuf mille appels quotidiens pour
       rien, de quoi epuiser le quota gratuit a quelques utilisateurs. */
    if (!dernierEtat.j || dernierEtat.j.length === 0) return;
    pousser(dernierEtat, true);
  }, RAPPEL).unref();

  /* On ne pousse jamais plus d'un message toutes les deux secondes ; le
     dernier état reçu entre-temps part à l'échéance. */
  return (charge) => {
    dernierEtat = charge; // Même quand on n'envoie pas : le rappel s'en sert.

    const reste = INTERVALLE_MIN - (Date.now() - derniere);
    if (reste <= 0) { pousser(charge); return; }

    differe = true;
    if (minuterie) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      differe = false;
      if (dernierEtat) pousser(dernierEtat);
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
    console.error(texteDe('aucunReplay'));
    process.exit(1);
  }
  trouves.sort((a, b) => b.date - a.date);
  vue.dire(`  ${texteDe('dernierePartie', { fichier: path.basename(trouves[0].chemin) })}`);
  return trouves[0].chemin;
}

/* =========================================================================
   SOURCES
   ========================================================================= */

function suivrePartie(envoyer) {
  vue.attente();

  // On n'annonce la fin que si une partie avait commencé : sinon le lecteur
  // dirait « partie terminée » au premier coup d'œil dans un dossier vide.
  let enPartie = false;

  live.watchGame((tableau) => {
    if (tableau === null) {
      if (enPartie) { vue.finPartie(); vue.attente(); enPartie = false; }
      envoyer(live.CHARGE_VIDE);
      return;
    }

    const charge = live.chargeUtile(tableau);
    if (!enPartie && charge.j.length) enPartie = true;
    envoyer(charge);
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

  vue.dire(`  ${texteDe('rejeu', { carte, vitesse })}\n`);

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
      /* Les envois sont limités à un toutes les deux secondes : en rejeu
         accéléré, la file n'est pas vide quand la partie s'achève. On laisse
         passer le dernier avant d'annoncer la fin. */
      setTimeout(() => vue.finPartie(), INTERVALLE_MIN + 200);
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
    vue.dire(`  ${texteDe('appaire', { canal: config.canal })}`);
  } else if (!config.ebs || !config.canal || !config.jeton) {
    config = await premierDemarrage();
  }

  vue.demarrage(config.canal);
  vue.detail(texteDe('detailService', { ebs: config.ebs }));

  const envoyer = creerEnvoyeur(config);
  const demo = args.includes('--dernier') ? dernierReplay() : valeur('--demo');

  if (demo) {
    if (!fs.existsSync(demo)) {
      vue.dire(`  ${texteDe('fichierIntrouvable', { fichier: demo })}`);
      process.exit(1);
    }
    rejouer(envoyer, demo, Number(valeur('--vitesse') || 20));
  } else {
    suivrePartie(envoyer);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
