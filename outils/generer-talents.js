#!/usr/bin/env node
/* =========================================================================
   GENERATEUR DE LA TABLE DES TALENTS

   Le lecteur envoie des identifiants bruts ("WizardAetherWalker") : c'est
   compact, et il le faut, le PubSub de Twitch étant limité à 5 Ko par message.
   C'est donc l'overlay qui traduit, avec la table produite ici.

   La source est EOWEA BUILDS, soit le dépôt local s'il est là, soit le site
   publié. La règle de correspondance est celle qu'on a vérifiée sur 40
   parties : le nom anglais du talent, sans espaces ni ponctuation, est
   contenu dans l'identifiant du tracker.

     node outils/generer-talents.js

   Écrit DEUX fichiers, et c'est voulu :

     talents.json        noms, paliers, icônes, portraits, rôles, alias
     descriptions.json   le texte de chaque talent, rien d'autre

   Les descriptions pèsent les deux tiers de la table, et ne servent qu'à
   l'infobulle. Les charger d'entrée coûtait 3,3 s sur un téléphone à
   500 Kb/s, au-dessus des 3 s que Twitch demande (règle 3.3). Elles sont
   donc à part, et l'overlay ne va les chercher qu'au premier survol.

   descriptions.json suit l'ordre de talents.json : pour le héros « abathur »,
   la description du troisième talent est descriptions.abathur[2]. Pas de clé
   répétée, pas d'identifiant à inventer.

   À relancer après une mise à jour de BUILDS.
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { knowsHero, HERO_TOKENS } = require('../heroes.js');

const SITE = 'https://eowea.github.io/builds/';
const LOCAL = path.join(os.homedir(), 'Documents', 'GitHub', 'builds', 'data.js');
const SORTIE = path.join(__dirname, '..', 'extension', 'talents.json');
const SORTIE_TEXTES = path.join(__dirname, '..', 'extension', 'descriptions.json');

// Préfixes communs à toutes les images : on ne les stocke pas mille fois.
const PREFIXE_ICONE = 'assets/heroes/base_spells/';
const PREFIXE_PORTRAIT = 'assets/heroes/portraits/';

async function lireBuilds() {
  if (fs.existsSync(LOCAL)) {
    console.log(`source : ${LOCAL}`);
    return fs.readFileSync(LOCAL, 'utf8');
  }
  console.log(`source : ${SITE}data.js`);
  const reponse = await fetch(`${SITE}data.js`);
  if (!reponse.ok) throw new Error(`data.js : HTTP ${reponse.status}`);
  return reponse.text();
}

const aplatir = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

/* Le dictionnaire du lecteur connait les noms internes du jeu ("FaerieDragon"
   pour Brightwing) ; BUILDS, lui, nomme ses heros en francais ("luisaile").
   On verse les deux cotes dans la meme liste d'alias, sinon l'overlay ne
   retrouve pas le heros que le tracker lui annonce. */
const JETONS_PAR_NOM = new Map();
for (const [jetons, nom] of HERO_TOKENS) JETONS_PAR_NOM.set(aplatir(nom), jetons);

/* Cho'gall est deux joueurs dans le jeu, et BUILDS a bien deux entrees :
   « chogall » pour Cho, « gall » pour Gall. Donner « gall » a Cho revenait
   donc a voler son nom a Gall — l'overlay cherchait alors les talents de Gall
   dans l'arbre de Cho, et y trouvait une icone fausse. */
const ALIAS_MANUELS = { chogall: ['cho', 'chogall'] };

function aliasDe(h) {
  const liste = [h.id, h.name.en, h.name.fr, ...(ALIAS_MANUELS[h.id] || [])];
  for (const cle of [h.id, h.name.en, h.name.fr]) {
    const jetons = JETONS_PAR_NOM.get(aplatir(cle));
    if (jetons) liste.push(...jetons);
  }
  return [...new Set(liste.map(aplatir).filter(Boolean))];
}

const raccourcir = (chemin, prefixe) => (
  chemin && chemin.startsWith(prefixe) ? chemin.slice(prefixe.length) : chemin || null
);

async function main() {
  const source = await lireBuilds();
  // data.js déclare ses constantes : on l'évalue dans une portée close.
  const HEROES = new Function(`${source}; return HEROES;`)();

  const heros = {};
  /* La description fait l'infobulle : sans elle, « Aura vampirique » n'apprend
     rien à un viewer qui ne connaît pas le héros. Les deux langues voyagent,
     pour le jour où l'extension sortira de France — mais dans leur fichier. */
  const descriptions = {};
  let talents = 0;
  let sansIcone = 0;

  for (const h of HEROES) {
    if (h.enabled === false) continue;
    heros[h.id] = {
      nom: { fr: h.name.fr, en: h.name.en },
      // Le role s'affiche au survol du portrait ; BUILDS le nomme en un seul
      // identifiant (« AssassinDistance »), que l'extension traduit.
      role: h.role || null,
      portrait: raccourcir(h.portrait, PREFIXE_PORTRAIT),
      // Les alias servent à retrouver le héros depuis l'identifiant du jeu,
      // qui le nomme souvent par son personnage d'origine (Amazon = Cassia).
      alias: aliasDe(h),
      talents: (h.talentPool || []).map((t) => {
        if (!t.icon) sansIcone++;
        talents++;
        return {
          en: t.name.en,
          fr: t.name.fr,
          niveau: t.level,
          icone: raccourcir(t.icon, PREFIXE_ICONE),
        };
      }),
    };

    descriptions[h.id] = (h.talentPool || []).map((t) => ({
      fr: (t.description && t.description.fr) || '',
      en: (t.description && t.description.en) || '',
    }));
  }

  const table = {
    genereLe: new Date().toISOString().slice(0, 10),
    base: SITE,
    prefixeIcone: PREFIXE_ICONE,
    prefixePortrait: PREFIXE_PORTRAIT,
    heros,
  };

  fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
  fs.writeFileSync(SORTIE, JSON.stringify(table), 'utf8');
  fs.writeFileSync(SORTIE_TEXTES, JSON.stringify(descriptions), 'utf8');

  const ko = fs.statSync(SORTIE).size / 1024;
  const koTextes = fs.statSync(SORTIE_TEXTES).size / 1024;
  console.log(`${Object.keys(heros).length} héros, ${talents} talents -> ${SORTIE}`);
  console.log(`${ko.toFixed(0)} Ko au chargement, ${koTextes.toFixed(0)} Ko de descriptions à la demande`);
  if (sansIcone) console.log(`${sansIcone} talents sans icône`);

  // Ce qui n'est pas dans le dictionnaire du lecteur ne sera jamais résolu.
  const inconnus = Object.keys(heros).filter((id) => !knowsHero(id));
  if (inconnus.length) console.log(`héros hors dictionnaire du lecteur : ${inconnus.join(', ')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
