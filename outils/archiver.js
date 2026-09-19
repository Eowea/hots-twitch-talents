#!/usr/bin/env node
/* =========================================================================
   ARCHIVE POUR TWITCH

   En test hébergé, Twitch sert les fichiers de l'extension depuis son propre
   réseau, au lieu de les chercher chez nous. Il faut donc les lui envoyer,
   dans une archive dont les fichiers sont à la racine — pas dans un dossier.

   Ce script vérifie avant d'emballer. Une archive fausse ne se découvre
   qu'après l'envoi, une fois la version figée : autant refuser tout de suite.

     node outils/archiver.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const langue = require('./verifier-langue.js');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'extension');
const ARCHIVE = path.join(RACINE, 'build', 'extension.zip');

/* Les fichiers que la console Twitch désigne par leur nom. S'il en manque un,
   l'extension se chargera sur une page blanche, sans message nulle part. */
const ATTENDUS = [
  'video_overlay.html',
  'panneau.html',
  'mobile.html',
  'config.html',
  'live_config.html',
];

/* Ce qui n'a rien à faire dans une extension publiée. */
const INTERDITS = [
  { motif: /localhost/i, quoi: 'une adresse locale' },
  { motif: /trycloudflare\.com/i, quoi: 'une adresse de tunnel temporaire' },
  { motif: /127\.0\.0\.1/, quoi: 'une adresse locale' },
];

/* Remplace chaque commentaire par des espaces, en gardant les fins de ligne :
   les numéros de ligne et la lisibilité des messages restent ainsi justes. */
function sansCommentaires(texte) {
  const vider = (bloc) => bloc.replace(/[^\n]/g, ' ');
  return texte
    .replace(/\/\*[\s\S]*?\*\//g, vider)
    .replace(/<!--[\s\S]*?-->/g, vider)
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function verifier() {
  const fichiers = fs.readdirSync(SOURCE).filter((f) => !f.startsWith('.'));
  const soucis = [];

  for (const attendu of ATTENDUS) {
    if (!fichiers.includes(attendu)) soucis.push(`${attendu} manque`);
  }

  for (const fichier of fichiers) {
    if (!/\.(html|js|css|json)$/.test(fichier)) continue;
    const texte = fs.readFileSync(path.join(SOURCE, fichier), 'utf8');

    /* Un commentaire qui en parle est sans conséquence : seul le code compte.
       On les retire donc avant de chercher, plutôt que d'essayer de reconnaître
       une ligne de commentaire — les lignes de continuation d'un bloc ne
       portent aucune marque, et c'est exactement ce qui m'a piégé. */
    const code = sansCommentaires(texte);

    for (const { motif, quoi } of INTERDITS) {
      for (const ligne of code.split('\n')) {
        if (motif.test(ligne)) {
          soucis.push(`${fichier} contient ${quoi} : ${ligne.trim().slice(0, 70)}`);
        }
      }
    }
  }

  /* L'extension porte ses deux langues dans le même paquet : une clé oubliée
     ne se verrait qu'à l'écran d'un viewer, la version déjà figée. */
  soucis.push(...langue.verifierExtension().soucis);

  return { fichiers, soucis };
}

function main() {
  const { fichiers, soucis } = verifier();

  console.log(`${fichiers.length} fichiers dans extension/\n`);
  for (const f of fichiers) {
    const ko = (fs.statSync(path.join(SOURCE, f)).size / 1024).toFixed(0);
    console.log(`  ${String(ko).padStart(4)} Ko  ${f}`);
  }

  if (soucis.length) {
    console.error('\nL\'archive n\'a pas été créée :');
    for (const souci of soucis) console.error(`  ${souci}`);
    return process.exit(1);
  }

  fs.mkdirSync(path.dirname(ARCHIVE), { recursive: true });
  fs.rmSync(ARCHIVE, { force: true });

  /* Compress-Archive place à la racine ce qu'on lui donne avec un joker, ce
     qui est précisément la forme attendue par Twitch. */
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path "${path.join(SOURCE, '*')}" -DestinationPath "${ARCHIVE}" -Force`,
  ], { stdio: 'inherit' });

  const ko = (fs.statSync(ARCHIVE).size / 1024).toFixed(0);
  console.log(`\n${ARCHIVE}`);
  console.log(`${ko} Ko — à envoyer dans la section « Fichiers » de la console Twitch.`);
  console.log('\nUne fois envoyée, l\'URI de test de base ne sert plus : Twitch');
  console.log('sert les fichiers lui-même, avec son propre versionnage.');
}

main();
