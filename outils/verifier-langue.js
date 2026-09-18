#!/usr/bin/env node
/* =========================================================================
   CONTRÔLE DES DEUX LANGUES

   L'extension porte le français et l'anglais dans le même paquet. Une clé
   oubliée ne se voit nulle part : ni à la compilation, ni au chargement —
   seulement à l'écran, chez un viewer, une fois la version figée sur Twitch.

   Ce script la trouve avant. Il est appelé par outils/archiver.js, qui
   refuse d'emballer tant qu'il signale quelque chose.

     node outils/verifier-langue.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXTENSION = path.join(__dirname, '..', 'extension');

const HTML = ['panneau.html', 'video_overlay.html', 'config.html', 'live_config.html'];
const JS = ['overlay.js', 'config.js', 'live_config.js'];

// Doit suivre le ?v= des pages : l'archive et le cache du navigateur en dépendent.
const VERSION_ATTENDUE = '5';

const marqueurs = (texte) => new Set(
  [...String(texte).matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
);

/* langue.js s'exécute dans un navigateur. On lui en fabrique juste assez
   pour lire sa table, sans lancer la traduction de la page. */
function chargerLangue() {
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

function verifier() {
  const soucis = [];
  const constats = [];
  const bac = chargerLangue();
  const { TEXTES } = bac;

  const lire = (f) => fs.readFileSync(path.join(EXTENSION, f), 'utf8');

  /* 1. Les deux tables portent les mêmes clés. */
  const fr = new Set(Object.keys(TEXTES.fr));
  const en = new Set(Object.keys(TEXTES.en));
  for (const cle of fr) if (!en.has(cle)) soucis.push(`« ${cle} » manque en anglais`);
  for (const cle of en) if (!fr.has(cle)) soucis.push(`« ${cle} » manque en français`);
  constats.push(`${fr.size} clés, présentes dans les deux langues`);

  /* 2. Et les mêmes marqueurs {x}. Un « {n} » perdu à la traduction donne une
        phrase anglaise sans son nombre, ce que rien d'autre ne signalerait. */
  for (const cle of fr) {
    if (!en.has(cle)) continue;
    const a = marqueurs(TEXTES.fr[cle]);
    const b = marqueurs(TEXTES.en[cle]);
    const ecart = [...new Set([...a, ...b])].filter((m) => a.has(m) !== b.has(m));
    if (ecart.length) soucis.push(`« ${cle} » : marqueurs dépareillés (${ecart.join(', ')})`);
  }

  /* 3. Le balisage ne cite que des clés existantes, et charge bien langue.js. */
  let citeesHtml = 0;
  for (const fichier of HTML) {
    const texte = lire(fichier);
    for (const m of texte.matchAll(/data-(?:t|t-aria|titre)="([^"]+)"/g)) {
      citeesHtml++;
      if (!fr.has(m[1])) soucis.push(`${fichier} cite « ${m[1]} », absente de la table`);
    }
    if (!/langue\.js/.test(texte)) soucis.push(`${fichier} ne charge pas langue.js`);

    const vieilles = [...texte.matchAll(/\?v=(\d+)/g)]
      .map((m) => m[1]).filter((v) => v !== VERSION_ATTENDUE);
    if (vieilles.length) {
      soucis.push(`${fichier} garde des ?v=${[...new Set(vieilles)].join(', ')}`
        + ` (attendu ${VERSION_ATTENDUE})`);
    }
  }
  constats.push(`${citeesHtml} clés citées par le balisage, toutes présentes`);

  /* 4. Le code non plus — et il fournit les valeurs que la phrase attend. */
  let citeesJs = 0;
  for (const fichier of JS) {
    const texte = lire(fichier);
    for (const m of texte.matchAll(/texteDe\('([^']+)'(\s*,\s*\{([^}]*)\})?/g)) {
      citeesJs++;
      const cle = m[1];
      if (!fr.has(cle)) { soucis.push(`${fichier} cite « ${cle} », absente de la table`); continue; }

      const fournis = new Set(
        (m[3] || '').split(',').map((p) => p.split(':')[0].trim()).filter(Boolean),
      );
      for (const attendu of marqueurs(TEXTES.fr[cle])) {
        if (!fournis.has(attendu)) {
          soucis.push(`${fichier} : « ${cle} » attend {${attendu}}, non fourni`);
        }
      }
    }
    // Un .fr en dur rendrait la page française quelle que soit la langue.
    if (/\.nom\.fr\b|\btalent\.fr\b|\.d\.fr\b/.test(texte)) {
      soucis.push(`${fichier} lit encore .fr en dur`);
    }
  }
  constats.push(`${citeesJs} clés citées par le code, toutes présentes et complètes`);

  /* 5. La détection et son repli. */
  const cas = [
    ['?language=fr&locale=fr-FR', 'fr', 'viewer français'],
    ['?language=en&locale=en-US', 'en', 'viewer anglais'],
    ['?language=de&locale=de-DE', 'en', 'viewer allemand'],
    ['?language=pt&locale=pt-BR', 'en', 'viewer brésilien'],
    ['?locale=fr-CA', 'fr', 'locale seule'],
  ];
  for (const [recherche, attendu, quoi] of cas) {
    bac.window.location.search = recherche;
    const obtenu = bac.detecter();
    if (obtenu !== attendu) soucis.push(`${quoi} : « ${obtenu} » au lieu de « ${attendu} »`);
  }
  constats.push(`détection et repli sur l'anglais : ${cas.length} cas vérifiés`);

  return { soucis, constats };
}

if (require.main === module) {
  const { soucis, constats } = verifier();
  for (const c of constats) console.log(`  ok   ${c}`);
  if (soucis.length) {
    console.log('');
    for (const s of soucis) console.log(`  NON  ${s}`);
    process.exit(1);
  }
  console.log('\nLes deux langues sont cohérentes.');
}

module.exports = { verifier };
