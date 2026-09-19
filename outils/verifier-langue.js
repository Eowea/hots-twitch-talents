#!/usr/bin/env node
/* =========================================================================
   CONTRÔLE DES DEUX LANGUES

   Le projet parle français et anglais en deux endroits : l'extension, dans le
   navigateur du viewer (extension/langue.js), et le lecteur, dans le terminal
   du diffuseur (textes.js). Une clé oubliée ne se voit nulle part : ni à la
   compilation, ni au chargement — seulement à l'écran, une fois la version
   distribuée.

   Ce script la trouve avant. outils/archiver.js appelle le premier contrôle,
   outils/construire.js le second, et chacun refuse de produire son fichier
   tant que quelque chose est signalé.

     node outils/verifier-langue.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const EXTENSION = path.join(RACINE, 'extension');

// Doit suivre le ?v= des pages : l'archive et le cache du navigateur en dépendent.
const VERSION_ATTENDUE = '13';

const ACCENTS = /[éèêëàâçôöûùïîœÉÈÀÇÊÔÎÙ]/;

const marqueurs = (texte) => new Set(
  [...String(texte).matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
);

/* Les commentaires ne s'affichent nulle part : on les retire avant de
   chercher du français oublié. Les lignes de continuation d'un bloc ne
   portent aucune marque — c'est exactement ce qui piège une recherche naïve. */
function sansCommentaires(texte) {
  return texte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

/* Les littéraux de chaîne d'un fichier JS. Approximatif — il ne distingue pas
   un apostrophe échappé d'une fin de chaîne dans tous les cas — mais assez
   juste pour signaler une phrase française restée en dur. */
function chainesAccentuees(code) {
  const trouve = [];
  const motifs = [/'((?:[^'\\\n]|\\.)*)'/g, /"((?:[^"\\\n]|\\.)*)"/g, /`((?:[^`\\]|\\.)*)`/g];
  for (const motif of motifs) {
    for (const m of code.matchAll(motif)) if (ACCENTS.test(m[1])) trouve.push(m[1]);
  }
  return trouve;
}

/* Vérifie une paire de tables : mêmes clés, mêmes marqueurs. */
function comparerTables(TEXTES, soucis) {
  const fr = new Set(Object.keys(TEXTES.fr));
  const en = new Set(Object.keys(TEXTES.en));

  for (const cle of fr) if (!en.has(cle)) soucis.push(`« ${cle} » manque en anglais`);
  for (const cle of en) if (!fr.has(cle)) soucis.push(`« ${cle} » manque en français`);

  /* Un « {n} » perdu à la traduction donne une phrase anglaise sans son
     nombre, ce que rien d'autre ne signalerait. */
  for (const cle of fr) {
    if (!en.has(cle)) continue;
    const a = marqueurs(TEXTES.fr[cle]);
    const b = marqueurs(TEXTES.en[cle]);
    const ecart = [...new Set([...a, ...b])].filter((m) => a.has(m) !== b.has(m));
    if (ecart.length) soucis.push(`« ${cle} » : marqueurs dépareillés (${ecart.join(', ')})`);
  }

  return fr;
}

/* Vérifie les appels texteDe('cle', { ... }) d'un fichier : la clé existe, et
   les valeurs que la phrase attend sont bien fournies. */
function verifierAppels(fichier, source, cles, TEXTES, soucis) {
  let n = 0;
  for (const m of source.matchAll(/texteDe\('([^']+)'(\s*,\s*\{([^}]*)\})?/g)) {
    n++;
    const cle = m[1];
    if (!cles.has(cle)) { soucis.push(`${fichier} cite « ${cle} », absente de la table`); continue; }

    const fournis = new Set(
      (m[3] || '').split(',').map((p) => p.split(':')[0].trim()).filter(Boolean),
    );
    for (const attendu of marqueurs(TEXTES.fr[cle])) {
      if (!fournis.has(attendu)) {
        soucis.push(`${fichier} : « ${cle} » attend {${attendu}}, non fourni`);
      }
    }
  }
  return n;
}

/* =========================================================================
   L'EXTENSION — extension/langue.js, lu par un navigateur
   ========================================================================= */

const HTML = ['panneau.html', 'video_overlay.html', 'config.html', 'live_config.html'];
const JS_EXTENSION = ['overlay.js', 'config.js', 'live_config.js'];

/* langue.js s'exécute dans un navigateur. On lui en fabrique juste assez pour
   lire sa table, sans lancer la traduction de la page. */
function chargerLangueNavigateur() {
  const source = fs.readFileSync(path.join(EXTENSION, 'langue.js'), 'utf8')
    .replace(/\ntraduirePage\(\);\s*$/, '\n');

  const bac = {
    window: { location: { search: '' } },
    navigator: { language: 'fr' },
    document: { documentElement: {}, body: { dataset: {} }, querySelectorAll: () => [] },
    URLSearchParams,
  };
  vm.createContext(bac);
  vm.runInContext(`${source}\n;this.TEXTES = TEXTES; this.detecter = detecterLangue;`, bac);
  return bac;
}

function verifierExtension() {
  const soucis = [];
  const constats = [];
  const bac = chargerLangueNavigateur();
  const { TEXTES } = bac;
  const lire = (f) => fs.readFileSync(path.join(EXTENSION, f), 'utf8');

  const cles = comparerTables(TEXTES, soucis);
  constats.push(`extension : ${cles.size} clés, présentes dans les deux langues`);

  /* Le balisage ne cite que des clés existantes, charge bien langue.js, et
     porte la version attendue. */
  let citeesHtml = 0;
  for (const fichier of HTML) {
    const texte = lire(fichier);
    for (const m of texte.matchAll(/data-(?:t|t-aria|titre)="([^"]+)"/g)) {
      citeesHtml++;
      if (!cles.has(m[1])) soucis.push(`${fichier} cite « ${m[1]} », absente de la table`);
    }
    if (!/langue\.js/.test(texte)) soucis.push(`${fichier} ne charge pas langue.js`);

    const vieilles = [...texte.matchAll(/\?v=(\d+)/g)]
      .map((m) => m[1]).filter((v) => v !== VERSION_ATTENDUE);
    if (vieilles.length) {
      soucis.push(`${fichier} garde des ?v=${[...new Set(vieilles)].join(', ')}`
        + ` (attendu ${VERSION_ATTENDUE})`);
    }
  }
  constats.push(`extension : ${citeesHtml} clés citées par le balisage`);

  let citeesJs = 0;
  for (const fichier of JS_EXTENSION) {
    const source = lire(fichier);
    citeesJs += verifierAppels(fichier, source, cles, TEXTES, soucis);

    // Un .fr en dur rendrait la page française quelle que soit la langue.
    if (/\.nom\.fr\b|\btalent\.fr\b|\.d\.fr\b/.test(source)) {
      soucis.push(`${fichier} lit encore .fr en dur`);
    }
    for (const reste of chainesAccentuees(sansCommentaires(source))) {
      soucis.push(`${fichier} garde du français en dur : « ${reste.slice(0, 50)} »`);
    }
  }
  constats.push(`extension : ${citeesJs} clés citées par le code`);

  const cas = [
    ['?language=fr&locale=fr-FR', 'fr', 'viewer français'],
    ['?language=en&locale=en-US', 'en', 'viewer anglais'],
    ['?language=de&locale=de-DE', 'en', 'viewer allemand'],
    ['?locale=fr-CA', 'fr', 'locale seule'],
  ];
  for (const [recherche, attendu, quoi] of cas) {
    bac.window.location.search = recherche;
    const obtenu = bac.detecter();
    if (obtenu !== attendu) soucis.push(`${quoi} : « ${obtenu} » au lieu de « ${attendu} »`);
  }
  constats.push(`extension : détection et repli, ${cas.length} cas vérifiés`);

  return { soucis, constats };
}

/* =========================================================================
   LE LECTEUR — textes.js, lu par Node
   ========================================================================= */

const JS_LECTEUR = ['affichage.js', 'pont.js'];

function verifierLecteur() {
  const soucis = [];
  const constats = [];

  // Celui-ci est un vrai module : on peut le charger tel quel.
  delete require.cache[require.resolve(path.join(RACINE, 'textes.js'))];
  const textes = require(path.join(RACINE, 'textes.js'));
  const { TEXTES } = textes;

  const cles = comparerTables(TEXTES, soucis);
  constats.push(`lecteur : ${cles.size} clés, présentes dans les deux langues`);

  let citees = 0;
  for (const fichier of JS_LECTEUR) {
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    citees += verifierAppels(fichier, source, cles, TEXTES, soucis);

    for (const reste of chainesAccentuees(sansCommentaires(source))) {
      soucis.push(`${fichier} garde du français en dur : « ${reste.slice(0, 50)} »`);
    }
  }
  constats.push(`lecteur : ${citees} clés citées par le code`);

  /* La détection lit process.argv et l'environnement : on les remplace le
     temps de l'essai, puis on les remet. */
  const argv = process.argv;
  const env = { ...process.env };
  const cas = [
    [['--langue', 'en'], {}, 'en', 'forcé en ligne de commande'],
    [['--langue', 'fr'], {}, 'fr', 'forcé en français'],
    [[], { TALENTS_LANGUE: 'en' }, 'en', "forcé par l'environnement"],
    [[], { LANG: 'de_DE.UTF-8' }, 'en', 'machine allemande (repli)'],
    [[], { LC_ALL: 'fr_FR.UTF-8' }, 'fr', 'machine française'],
  ];
  for (const [args, variables, attendu, quoi] of cas) {
    process.argv = ['node', 'pont.js', ...args];
    for (const c of ['TALENTS_LANGUE', 'LANG', 'LC_ALL', 'LC_MESSAGES']) delete process.env[c];
    Object.assign(process.env, variables);

    const obtenu = textes.detecterLangue();
    if (obtenu !== attendu) soucis.push(`${quoi} : « ${obtenu} » au lieu de « ${attendu} »`);
  }
  process.argv = argv;
  for (const c of Object.keys(process.env)) delete process.env[c];
  Object.assign(process.env, env);
  constats.push(`lecteur : détection et repli, ${cas.length} cas vérifiés`);

  return { soucis, constats };
}

if (require.main === module) {
  const resultats = [verifierExtension(), verifierLecteur()];
  const soucis = resultats.flatMap((r) => r.soucis);

  for (const r of resultats) for (const c of r.constats) console.log(`  ok   ${c}`);
  if (soucis.length) {
    console.log('');
    for (const s of soucis) console.log(`  NON  ${s}`);
    process.exit(1);
  }
  console.log('\nLes deux langues sont cohérentes, des deux côtés.');
}

module.exports = { verifierExtension, verifierLecteur };
