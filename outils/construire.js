#!/usr/bin/env node
/* =========================================================================
   FABRICATION DE L'EXÉCUTABLE

   Produit un fichier unique que le streamer double-clique, sans rien installer.
   Quatre étapes, toutes automatisées ici :

     1. replier les modules du lecteur en un seul script  (outils/empaqueter.js)
     2. en faire un « blob » que Node sait embarquer      (--experimental-sea-config)
     3. copier le binaire de Node                          (c'est lui, l'exécutable)
     4. y injecter le blob                                 (postject, via npx)

   Seule la quatrième demande un outil extérieur, récupéré à la volée par npx.
   Il ne part pas dans le produit fini : c'est un outil d'atelier.

     node outils/construire.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const BUILD = path.join(RACINE, 'build');
const WINDOWS = process.platform === 'win32';
const EXE = path.join(BUILD, WINDOWS ? 'lecteur.exe' : 'lecteur');

// La sentinelle est imposée par Node : postject cherche cette chaîne dans le
// binaire pour savoir où déposer le blob.
const SENTINELLE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const etape = (n, texte) => console.log(`\n[${n}/4] ${texte}`);
const mo = (chemin) => (fs.statSync(chemin).size / 1024 / 1024).toFixed(0);

function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  etape(1, 'Repliage des modules');
  execFileSync(process.execPath, [path.join(__dirname, 'empaqueter.js')], { stdio: 'inherit' });

  etape(2, 'Préparation du blob');
  const config = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(config, `${JSON.stringify({
    main: path.relative(RACINE, path.join(BUILD, 'lecteur.bundle.js')).replace(/\\/g, '/'),
    output: path.relative(RACINE, path.join(BUILD, 'lecteur.blob')).replace(/\\/g, '/'),
    disableExperimentalSEAWarning: true,
  }, null, 2)}\n`, 'utf8');
  execFileSync(process.execPath, ['--experimental-sea-config', config], {
    cwd: RACINE,
    stdio: 'inherit',
  });

  etape(3, 'Copie du binaire de Node');
  fs.copyFileSync(process.execPath, EXE);
  console.log(`  ${path.basename(EXE)} : ${mo(EXE)} Mo`);

  etape(4, 'Injection du lecteur dans le binaire');
  try {
    /* npx est un script .cmd sous Windows, que Node refuse de lancer sans
       shell depuis ses correctifs de sécurité. On compose donc la ligne
       nous-mêmes, avec les guillemets qu'il faut, plutôt que de laisser
       execFile concaténer des arguments non échappés. */
    const blob = path.join(BUILD, 'lecteur.blob');
    execSync(
      `npx --yes postject "${EXE}" NODE_SEA_BLOB "${blob}" --sentinel-fuse ${SENTINELLE}`,
      { stdio: 'inherit' },
    );
  } catch (err) {
    console.error('\nL\'injection a échoué. Il faut npx (livré avec Node) et un accès réseau');
    console.error('la première fois, le temps que postject soit récupéré.');
    console.error(err.message);
    return process.exit(1);
  }

  console.log(`\n${EXE}`);
  console.log(`${mo(EXE)} Mo — à distribuer tel quel, sans rien d'autre.`);
  console.log('\nAu premier lancement il demandera le code d\'appairage, et rangera');
  console.log('sa configuration à côté de lui.');

  /* Windows signale une signature invalide après l'injection : c'est attendu,
     on a modifié un binaire signé par Node. Sans certificat de signature, il
     affichera un avertissement SmartScreen au premier lancement. */
  if (WINDOWS) {
    console.log('\nWindows affichera un avertissement au premier lancement : l\'exécutable');
    console.log('n\'est pas signé. C\'est le lot de tout logiciel distribué sans certificat.');
  }
}

main();
