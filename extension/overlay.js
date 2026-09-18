/* =========================================================================
   OVERLAY TALENTS — logique

   Deux sources possibles, choisies automatiquement :
   - dans le lecteur Twitch, les messages PubSub relayés par l'EBS ;
   - hors Twitch (test local), le serveur local, interrogé toutes les secondes.

   Le message transporte des identifiants bruts ("WizardAetherWalker") parce
   que le PubSub de Twitch plafonne à 5 Ko. C'est ici qu'on les traduit, avec
   extension/talents.json, généré depuis EOWEA BUILDS.

   Le retard est la pièce délicate : le flux Twitch a 10 à 20 secondes de
   décalage sur la partie. Sans tampon, le viewer verrait un talent apparaître
   dans le tableau avant que le joueur ne le prenne à l'écran.
   ========================================================================= */
'use strict';

const LARGEUR_LARGE = 1010; // Les deux équipes côte à côte.
const LARGEUR_ETROITE = 560; // Une seule équipe, sur un petit lecteur.
const SEUIL_ETROIT = 0.62; // En deçà, les icônes deviennent illisibles.
const PALIERS = [1, 4, 7, 10, 13, 16, 20];

/* Trois rappels manqués : le lecteur du streamer s'est arrêté. On fige alors
   le chrono, parce qu'une horloge qui continue toute seule pendant que le
   tableau ne bouge plus donnerait l'illusion d'une partie encore suivie. */
const CHRONO_PERIME = 30000;

const $ = (sel) => document.querySelector(sel);

/* NFD sépare la lettre de son accent, qu'on retire ensuite : sans ça
   « Rejuvenescência » devenait « rejuvenescncia » — les lettres accentuées
   n'étant pas dans [a-z] — et ne correspondait plus à l'identifiant du jeu,
   « LucioAmpItUpRejuvenescencia ». */
const aplatir = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/gi, '').toLowerCase();

/* talents.json porte les deux langues pour chaque héros et chaque talent.
   LANGUE et texteDe() viennent de langue.js, chargé juste avant ce script.
   Le repli sur l'anglais est écrit ici aussi : une entrée incomplète dans la
   table doit laisser un nom lisible, pas une case vide. */
const enLangue = (entree) => (entree && (entree[LANGUE] || entree.en)) || '';

/* Le panneau et la superposition partagent tout sauf leur cadre : l'un est
   toujours visible dans 318 px imposes par Twitch, l'autre s'ouvre au clic
   par-dessus la video et se met a l'echelle du lecteur. */
const MODE_PANNEAU = document.body.dataset.mode === 'panneau';

const cadre = $('.cadre');
const tableau = $('#tableau');
const boutonOuvrir = $('#ouvrir');

let table = null; // talents.json
let indexHeros = new Map(); // alias -> identifiant BUILDS
let equipeAffichee = 1; // Sur petit lecteur, l'équipe visible.
let dernierEtat = null;

/* =========================================================================
   LA TABLE DES TALENTS
   ========================================================================= */

async function chargerTable() {
  const reponse = await fetch('talents.json');
  if (!reponse.ok) throw new Error(`talents.json : HTTP ${reponse.status}`);
  table = await reponse.json();

  /* Le nom propre d'un héros l'emporte sur l'alias d'un autre. « gall » est
     l'identifiant de Gall, et aussi un alias de Cho'Gall : le premier inscrit
     gagnait, donc les talents de Gall étaient cherchés dans l'arbre de Cho,
     où l'on finissait par trouver une icône — fausse. */
  for (const id of Object.keys(table.heros)) indexHeros.set(id, id);
  for (const [id, hero] of Object.entries(table.heros)) {
    for (const alias of hero.alias) if (!indexHeros.has(alias)) indexHeros.set(alias, id);
  }
}

const trouverHeros = (id) => table.heros[indexHeros.get(aplatir(id))] || null;

/* =========================================================================
   APPARIER UN IDENTIFIANT À UN TALENT

   Le tracker écrit <Héros><NomAnglaisDuTalent><CapacitéConcernée>, mais ce
   nom anglais est le nom *interne* de Blizzard, qui a dérivé de celui qu'on
   affiche : « Indestructable » pour Indestructible, « NanaBoost » pour Nano
   Boost, « ArchlichArmor » pour Armor of the Archlich.

   Deux choses rendent l'appariement sûr malgré cette dérive :

   - Le palier. Les talents d'un joueur arrivent dans l'ordre des paliers, donc
     l'indice de la case donne le sien. Cela ramène le choix à trois ou quatre
     candidats au lieu de vingt — et supprime au passage une erreur qu'on ne
     voyait pas : au palier 20, l'identifiant d'une amélioration d'héroïque
     cite le nom de l'héroïque, et le tableau affichait donc le talent du
     palier 10. Mesuré à 170 cases fausses sur 12 000.
   - La marge. On n'accepte un appariement approximatif que s'il domine
     nettement le suivant. Une icône fausse est pire qu'une case vide.
   ========================================================================= */

// Mots que Blizzard colle dans ses identifiants sans qu'ils nomment le talent.
const BRUIT = new Set(['mastery', 'heroic', 'ability', 'talent', 'the', 'of', 'and']);

const SEUIL = 0.55; // En deçà, le nom ne décrit pas cet identifiant.
const MARGE = 0.15; // Et il doit devancer le deuxième d'autant.

const motsDuNom = (nom) => String(nom)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-zA-Z0-9]+/)
  .map((mot) => mot.toLowerCase())
  .filter((mot) => mot.length >= 4 && !BRUIT.has(mot));

/* Longueur de la plus longue sous-chaîne commune — ce qui rattrape les fautes
   de frappe de Blizzard, « Indestructable » partageant « indestruct » avec
   « Indestructible ». */
function communLePlusLong(mot, cle) {
  let max = 0;
  for (let i = 0; i < mot.length; i++) {
    for (let j = i + max + 1; j <= mot.length; j++) {
      if (!cle.includes(mot.slice(i, j))) break;
      max = j - i;
    }
  }
  return max;
}

/* À quel point ce nom de talent décrit-il cet identifiant ? De 0 à 1. */
function pertinence(nom, cle) {
  const mots = motsDuNom(nom);
  if (!mots.length) return 0;

  let obtenus = 0;
  let possibles = 0;
  for (const mot of mots) {
    possibles += mot.length;
    const singulier = mot.endsWith('s') ? mot.slice(0, -1) : mot;

    if (cle.includes(mot)) obtenus += mot.length;
    else if (singulier.length >= 4 && cle.includes(singulier)) obtenus += singulier.length;
    else {
      const commun = communLePlusLong(mot, cle);
      // Sous cinq lettres, une coïncidence ne prouve rien.
      if (commun >= 5) obtenus += commun * 0.9;
    }
  }
  return obtenus / possibles;
}

function trouverTalent(hero, identifiant, palier) {
  if (!hero) return null;
  const cle = aplatir(identifiant);

  const candidats = palier
    ? hero.talents.filter((talent) => talent.niveau === palier)
    : hero.talents;
  if (!candidats.length) return null;

  /* La règle d'origine règle 98 % des cas : le nom affiché est contenu dans
     l'identifiant. Le plus long gagne, pour que « Chaos Reigns » ne prenne
     pas la place de « Chaos Reigns Supreme ». */
  let exact = null;
  let meilleureLongueur = 0;
  for (const talent of candidats) {
    const en = aplatir(talent.en);
    if (en.length >= 4 && cle.includes(en) && en.length > meilleureLongueur) {
      exact = talent;
      meilleureLongueur = en.length;
    }
  }
  if (exact) return exact;

  // Sinon le mieux noté du palier, s'il se détache assez.
  const notes = candidats
    .map((talent) => ({ talent, note: pertinence(talent.en, cle) }))
    .sort((a, b) => b.note - a.note);

  const [premier, second] = notes;
  if (premier.note >= SEUIL && (!second || premier.note - second.note >= MARGE)) {
    return premier.talent;
  }
  return null;
}

const urlIcone = (fichier) => table.base + table.prefixeIcone + fichier;
const urlPortrait = (fichier) => table.base + table.prefixePortrait + fichier;

/* =========================================================================
   RENDU
   ========================================================================= */

/* Ce que chaque case décrit. Une table faible plutôt que des attributs dans
   le DOM : soixante-dix descriptions de cent caractères n'ont rien à faire
   dans le document. */
const talentDeLaCase = new WeakMap();

function creerCase(hero, identifiant, palier) {
  const talent = trouverTalent(hero, identifiant, palier);

  if (!talent || !talent.icone) {
    // Talent non traduit : une case pleine vaut mieux qu'un trou, et son
    // identifiant brut reste lisible dans l'infobulle.
    const vide = document.createElement('div');
    vide.className = 'case';
    vide.tabIndex = 0;
    talentDeLaCase.set(vide, { brut: identifiant });
    return vide;
  }

  const img = document.createElement('img');
  img.className = 'case';
  img.src = urlIcone(talent.icone);
  img.alt = enLangue(talent);
  img.tabIndex = 0;
  talentDeLaCase.set(img, talent);
  return img;
}

function creerLigne(joueur) {
  const hero = trouverHeros(joueur.h);
  const ligne = document.createElement('div');
  ligne.className = 'ligne';
  ligne.dataset.equipe = joueur.e;

  const portrait = document.createElement('img');
  portrait.className = 'portrait';
  portrait.alt = '';
  if (hero && hero.portrait) portrait.src = urlPortrait(hero.portrait);
  ligne.append(portrait);

  const identite = document.createElement('div');
  identite.className = 'identite';
  const nom = document.createElement('div');
  nom.className = 'heros';
  nom.textContent = hero ? enLangue(hero.nom) : joueur.h;
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = joueur.n || '';
  identite.append(nom, tag);
  ligne.append(identite);

  const talents = document.createElement('div');
  talents.className = 'talents';
  for (let i = 0; i < PALIERS.length; i++) {
    const identifiant = joueur.t[i];
    if (identifiant) {
      // L'indice donne le palier : les prises arrivent dans l'ordre.
      talents.append(creerCase(hero, identifiant, PALIERS[i]));
    } else {
      const vide = document.createElement('div');
      vide.className = 'case';
      talents.append(vide); // Palier pas encore atteint.
    }
  }
  ligne.append(talents);
  return ligne;
}

/* =========================================================================
   LE CHRONO

   Le lecteur n'envoie plus un message par seconde : il ne parle que quand
   quelque chose change à l'écran, et se rappelle toutes les dix secondes.
   C'est donc ici qu'on fait avancer l'horloge, depuis le dernier repère reçu
   — ce qui divise par trois le trafic vers le service sans que le viewer
   voie la moindre différence.
   ========================================================================= */

let chronoBase = null; // { seconde, depuis }

function ecrireChrono(secondes) {
  const s = Math.max(0, Math.round(secondes));
  $('#chrono').textContent = `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
}

function avancerChrono() {
  if (!chronoBase) return;
  const ecoule = Date.now() - chronoBase.depuis;
  if (ecoule > CHRONO_PERIME) return; // Plus de lecteur : on fige où on est.
  ecrireChrono(chronoBase.seconde + ecoule / 1000);
}

function afficher(etat) {
  dernierEtat = etat;
  const enPartie = Boolean(etat && etat.j && etat.j.length);
  cadre.classList.toggle('partie', enPartie);
  if (!enPartie) {
    chronoBase = null;
    $('#chrono').textContent = '';
    return;
  }

  $('#carte').textContent = etat.carte || '';
  /* Le repère est posé à l'affichage, pas à la réception : le tampon de
     retard a déjà décalé l'appel, donc cet instant est bien celui où le
     viewer voit cette seconde de jeu. */
  chronoBase = { seconde: etat.t || 0, depuis: Date.now() };
  avancerChrono();

  const bans = $('#bans');
  bans.replaceChildren();
  $('#bans-libelle').hidden = !(etat.bans && etat.bans.length);
  for (const identifiant of etat.bans || []) {
    const hero = trouverHeros(identifiant);
    if (!hero || !hero.portrait) continue;
    const img = document.createElement('img');
    img.src = urlPortrait(hero.portrait);
    img.alt = enLangue(hero.nom);
    img.title = enLangue(hero.nom);
    bans.append(img);
  }

  for (const equipe of [1, 2]) {
    const colonne = document.querySelector(`.colonne[data-equipe="${equipe}"]`);
    const joueurs = etat.j.filter((j) => j.e === equipe);

    /* Le niveau est commun a toute l'equipe : le repeter sur chaque ligne
       repeterait la meme information cinq fois, et volerait une colonne aux
       icones. On prend le plus haut vu, au cas ou un evenement de montee de
       niveau manquerait pour un joueur. */
    const niveau = joueurs.reduce((max, j) => Math.max(max, j.l || 0), 0);
    let cartouche = colonne.querySelector('.niveau-equipe');
    if (!cartouche) {
      cartouche = document.createElement('span');
      cartouche.className = 'niveau-equipe';
      colonne.querySelector('.bandeau').append(cartouche);
    }
    cartouche.textContent = niveau ? texteDe('niveau', { n: niveau }) : '';

    const paliers = colonne.querySelector('.paliers');
    if (!paliers.childElementCount) {
      for (const n of PALIERS) {
        const span = document.createElement('span');
        span.textContent = n;
        paliers.append(span);
      }
    }
    const lignes = colonne.querySelector('.lignes');
    lignes.replaceChildren(...joueurs.map(creerLigne));
  }

  ajuster();
}


/* =========================================================================
   INFOBULLE

   Le survol d'une case doit dire ce que fait le talent. Un seul element,
   reutilise, plutot qu'un par case : soixante-dix infobulles dans le document
   pour une seule visible n'auraient aucun sens.

   On ecoute au niveau du cadre plutot que sur chaque icone — les lignes sont
   reconstruites a chaque mise a jour, et des ecouteurs poses sur elles
   disparaitraient avec.
   ========================================================================= */

let infobulle = null;

function creerInfobulle() {
  const element = document.createElement('div');
  element.className = 'infobulle';
  element.setAttribute('role', 'tooltip');
  element.hidden = true;
  document.body.append(element);
  return element;
}

function remplirInfobulle(talent) {
  infobulle.replaceChildren();

  if (talent.brut) {
    const brut = document.createElement('div');
    brut.className = 'infobulle-brut';
    brut.textContent = talent.brut;
    infobulle.append(brut);
    return;
  }

  const entete = document.createElement('div');
  entete.className = 'infobulle-entete';

  if (talent.icone) {
    const icone = document.createElement('img');
    icone.className = 'infobulle-icone';
    icone.src = urlIcone(talent.icone);
    icone.alt = '';
    entete.append(icone);
  }

  const titres = document.createElement('div');
  const nom = document.createElement('div');
  nom.className = 'infobulle-nom';
  nom.textContent = enLangue(talent);
  const palier = document.createElement('div');
  palier.className = 'infobulle-palier';
  palier.textContent = texteDe('palier', { n: talent.niveau });
  titres.append(nom, palier);
  entete.append(titres);
  infobulle.append(entete);

  const texte = document.createElement('div');
  texte.className = 'infobulle-texte';
  // textContent, jamais innerHTML : ces textes viennent d'un fichier de
  // donnees, et rien ne justifie de leur laisser injecter du balisage.
  texte.textContent = enLangue(talent.d);
  if (texte.textContent) infobulle.append(texte);
}

/* Au-dessus de la case si la place le permet, en dessous sinon, et toujours
   ramenee dans la fenetre — sans quoi elle sortirait du panneau de 318 px. */
function placerInfobulle(case_) {
  const c = case_.getBoundingClientRect();
  const b = infobulle.getBoundingClientRect();
  const MARGE = 8;

  let y = c.top - b.height - MARGE;
  if (y < MARGE) y = c.bottom + MARGE;

  let x = c.left + (c.width - b.width) / 2;
  x = Math.max(MARGE, Math.min(x, document.documentElement.clientWidth - b.width - MARGE));

  infobulle.style.left = `${Math.round(x)}px`;
  infobulle.style.top = `${Math.round(y)}px`;
}

function montrerInfobulle(case_) {
  const talent = talentDeLaCase.get(case_);
  if (!talent) return;

  if (!infobulle) infobulle = creerInfobulle();
  remplirInfobulle(talent);
  infobulle.hidden = false;
  placerInfobulle(case_); // Apres l'affichage : sa taille depend du texte.
}

function cacherInfobulle() {
  if (infobulle) infobulle.hidden = true;
}

function brancherInfobulle() {
  const surCase = (evenement) => {
    const case_ = evenement.target.closest('.case');
    if (case_) montrerInfobulle(case_);
  };

  cadre.addEventListener('mouseover', surCase);
  cadre.addEventListener('focusin', surCase);
  cadre.addEventListener('mouseout', cacherInfobulle);
  cadre.addEventListener('focusout', cacherInfobulle);

  // Le tableau bouge sous le curseur a chaque mise a jour : une infobulle
  // laissee en place designerait alors la mauvaise case.
  window.addEventListener('scroll', cacherInfobulle, true);
}

/* =========================================================================
   MISE A L'ECHELLE
   L'overlay occupe la surface du lecteur, qui va du plein écran à une petite
   fenêtre. Le tableau est dessiné à taille fixe puis réduit ; sous un certain
   seuil, on n'en montre plus qu'une équipe.
   ========================================================================= */

function ajuster() {
  if (MODE_PANNEAU) return; // Largeur imposee : rien a calculer.

  const dispoLargeur = document.documentElement.clientWidth - 40;
  const dispoHauteur = document.documentElement.clientHeight - 40;
  const etroit = dispoLargeur / LARGEUR_LARGE < SEUIL_ETROIT;
  const largeur = etroit ? LARGEUR_ETROITE : LARGEUR_LARGE;

  cadre.classList.toggle('etroit', etroit);
  cadre.style.width = `${largeur}px`;
  appliquerEtroit();

  // offsetHeight ignore la transformation : on mesure donc la hauteur réelle
  // du contenu, quelle que soit l'échelle déjà appliquée. Sans ce second
  // rapport, un lecteur court laisse le bas du tableau hors de l'image.
  const hauteur = cadre.offsetHeight || 1;
  const echelle = Math.min(1, dispoLargeur / largeur, dispoHauteur / hauteur);
  cadre.style.setProperty('--echelle', echelle.toFixed(3));
}

function appliquerEtroit() {
  if (MODE_PANNEAU) return; // Les deux equipes restent affichees.

  const etroit = cadre.classList.contains('etroit');
  for (const equipe of [1, 2]) {
    const colonne = document.querySelector(`.colonne[data-equipe="${equipe}"]`);
    colonne.hidden = etroit && equipe !== equipeAffichee;
  }
  const bascule = $('#bascule');
  if (bascule) {
    bascule.textContent = texteDe(equipeAffichee === 1 ? 'voirRouge' : 'voirBleue');
  }
}

/* =========================================================================
   LE TAMPON DE RETARD
   On retarde l'affichage du décalage du flux, mesuré depuis l'arrivée du
   message : comparer des horloges de deux machines serait moins sûr.
   ========================================================================= */

let retardSecondes = 0;

function recevoir(etat) {
  if (retardSecondes <= 0) { afficher(etat); return; }
  setTimeout(() => afficher(etat), retardSecondes * 1000);
}

/* =========================================================================
   LES SOURCES
   ========================================================================= */

let sourceChoisie = null;

/* Le PubSub ne rejoue pas ce qui est déjà passé. Plutôt que de faire garder un
   historique au serveur, c'est le lecteur du streamer qui republie son état
   toutes les dix secondes : un viewer qui ouvre le tableau entre deux prises
   de talents attend ce délai au pire, et le service reste sans mémoire. */
function brancherTwitch() {
  // onAuthorized se déclenche aussi au renouvellement du jeton : on ne
  // s'abonne qu'une fois.
  if (sourceChoisie === 'twitch') return;
  sourceChoisie = 'twitch';
  brancherEcoutes();
}

function brancherEcoutes() {
  window.Twitch.ext.onContext((contexte) => {
    if (typeof contexte.hlsLatencyBroadcaster === 'number') {
      retardSecondes = contexte.hlsLatencyBroadcaster;
    }
  });

  window.Twitch.ext.listen('broadcast', (cible, type, message) => {
    try {
      recevoir(JSON.parse(message));
    } catch (err) {
      console.warn('message illisible', err);
    }
  });
}

/* Le script d'aide de Twitch définit window.Twitch même hors du lecteur, et en
   test local l'extension est servie par le même serveur que /etat : ni l'un ni
   l'autre ne distingue donc le test du direct. Seul onAuthorized le fait — il
   ne se déclenche que dans le lecteur Twitch. */
async function serveurLocalPresent() {
  try {
    const reponse = await fetch('/etat', { cache: 'no-store' });
    return reponse.ok;
  } catch {
    return false;
  }
}

function brancherServeurLocal() {
  // En test local il n'y a pas de flux, donc pas de retard à compenser.
  const tirer = async () => {
    try {
      const reponse = await fetch('/etat', { cache: 'no-store' });
      if (!reponse.ok) return;
      afficher(await reponse.json());
    } catch {
      // Serveur arrêté : on garde le dernier état affiché.
    }
  };
  tirer();
  setInterval(tirer, 1000);
}

/* =========================================================================
   DEMARRAGE
   ========================================================================= */

/* En mode panneau, le tableau est toujours là : ni bouton d'ouverture, ni
   fermeture, ni bascule d'équipe — Twitch impose la largeur, et la feuille de
   style s'en charge. */
if (!MODE_PANNEAU) {
  boutonOuvrir.addEventListener('click', () => {
    tableau.hidden = false;
    boutonOuvrir.hidden = true;
    boutonOuvrir.setAttribute('aria-expanded', 'true');
    ajuster();
  });

  $('#fermer').addEventListener('click', () => {
    tableau.hidden = true;
    boutonOuvrir.hidden = false;
    boutonOuvrir.setAttribute('aria-expanded', 'false');
    boutonOuvrir.focus();
  });

  window.addEventListener('resize', ajuster);
}

chargerTable().then(() => {
  if (!MODE_PANNEAU) {
    const bascule = document.createElement('button');
    bascule.id = 'bascule';
    bascule.className = 'bascule';
    bascule.type = 'button';
    bascule.addEventListener('click', () => {
      equipeAffichee = equipeAffichee === 1 ? 2 : 1;
      ajuster();
    });
    cadre.append(bascule);
  }

  brancherInfobulle();
  setInterval(avancerChrono, 1000);
  ajuster();

  if (window.Twitch && window.Twitch.ext) {
    window.Twitch.ext.onAuthorized(() => brancherTwitch());
  }

  /* Si onAuthorized ne s'est pas déclenché, c'est qu'on n'est pas dans le
     lecteur : on se rabat alors sur le serveur local, s'il répond. */
  setTimeout(() => {
    if (sourceChoisie) return;
    serveurLocalPresent().then((present) => {
      if (present && !sourceChoisie) {
        sourceChoisie = 'local';
        brancherServeurLocal();
      }
    });
  }, 1500);
}).catch((err) => {
  console.error(err);
  $('#attente').textContent = texteDe('tableIntrouvable');
});
