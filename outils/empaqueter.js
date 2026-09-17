#!/usr/bin/env node
/* =========================================================================
   EMPAQUETEUR — rassemble le lecteur en un seul fichier

   Un exécutable Node ne peut embarquer qu'un script, sans arborescence de
   modules autour. Il faut donc replier les huit fichiers du lecteur en un.

   C'est un assembleur minuscule, écrit ici plutôt qu'emprunté : le projet n'a
   aucune dépendance, et ce serait dommage d'en introduire une pour quarante
   lignes. Il ne gère que ce dont on a besoin — des `require` relatifs, en
   CommonJS, sans cycle. Les modules de Node (`fs`, `path`...) passent au
   travers et seront résolus normalement à l'exécution.

     node outils/empaqueter.js [entrée] [sortie]
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const ENTREE = process.argv[2] || path.join(RACINE, 'pont.js');
const SORTIE = process.argv[3] || path.join(RACINE, 'build', 'lecteur.bundle.js');

// Seuls les chemins relatifs sont internes ; le reste est un module de Node.
const RELATIF = /require\((['"])(\.[^'"]+)\1\)/g;

function resoudre(depuis, demande) {
  const chemin = path.resolve(path.dirname(depuis), demande);
  return fs.existsSync(chemin) ? chemin : `${chemin}.js`;
}

/* Parcours en profondeur du graphe des require, à partir de l'entrée. */
function collecter(entree) {
  const modules = new Map();

  const visiter = (fichier) => {
    const cle = path.resolve(fichier);
    if (modules.has(cle)) return;

    // Le « #! » d'un script exécutable n'est valide qu'en première ligne d'un
    // fichier : à l'intérieur d'une fonction, il casse tout.
    const source = fs.readFileSync(cle, 'utf8').replace(/^#!.*\r?\n/, '');
    modules.set(cle, source);

    for (const [, , demande] of source.matchAll(RELATIF)) {
      visiter(resoudre(cle, demande));
    }
  };

  visiter(entree);
  return modules;
}

/* Chaque module devient une fonction, indexée par son chemin depuis la racine.
   Un require interne appelle cette table ; tout le reste retombe sur le vrai
   require de Node. */
function assembler(modules, entree) {
  const nom = (chemin) => path.relative(RACINE, chemin).replace(/\\/g, '/');

  const corps = [...modules].map(([chemin, source]) => {
    // On réécrit les require relatifs vers la table, en chemins absolus
    // depuis la racine : deux modules voisins n'ont plus le même « ./ ».
    const reecrit = source.replace(RELATIF, (tout, guillemet, demande) => {
      const cible = nom(resoudre(chemin, demande));
      return `__requis(${guillemet}${cible}${guillemet})`;
    });

    return `__modules[${JSON.stringify(nom(chemin))}] = `
      + `function (module, exports) {\n${reecrit}\n};`;
  }).join('\n\n');

  return `/* Fichier produit par outils/empaqueter.js — ne pas modifier à la main.
   Le lecteur et ses modules, repliés en un seul script pour être embarqués
   dans un exécutable. Le code d'origine est dans le dépôt. */
'use strict';

const __modules = {};
const __charges = {};

function __requis(nom) {
  if (!(nom in __modules)) return require(nom); // Module de Node.
  if (!(nom in __charges)) {
    const module = { exports: {} };
    __charges[nom] = module.exports;
    __modules[nom](module, module.exports);
    __charges[nom] = module.exports;
  }
  return __charges[nom];
}

${corps}

__requis(${JSON.stringify(nom(path.resolve(entree)))});
`;
}

function main() {
  const modules = collecter(ENTREE);
  const source = assembler(modules, ENTREE);

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, source, 'utf8');

  console.log(`${modules.size} modules repliés :`);
  for (const chemin of modules.keys()) {
    console.log(`  ${path.relative(RACINE, chemin)}`);
  }
  console.log(`\n-> ${SORTIE}  (${(source.length / 1024).toFixed(0)} Ko)`);
}

main();
