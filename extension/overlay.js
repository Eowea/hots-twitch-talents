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

const $ = (sel) => document.querySelector(sel);
const aplatir = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

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

  for (const [id, hero] of Object.entries(table.heros)) {
    for (const alias of hero.alias) if (!indexHeros.has(alias)) indexHeros.set(alias, id);
  }
}

const trouverHeros = (id) => table.heros[indexHeros.get(aplatir(id))] || null;

/* Le tracker écrit <Héros><NomAnglaisDuTalent><CapacitéConcernée>. On retient
   donc le talent dont le nom anglais, réduit à ses lettres, est contenu dans
   l'identifiant — le plus long gagne, pour que « Chaos Reigns » ne prenne pas
   la place de « Chaos Reigns Supreme ». */
function trouverTalent(hero, identifiant) {
  if (!hero) return null;
  const cle = aplatir(identifiant);
  let meilleur = null;
  let meilleureLongueur = 0;

  for (const talent of hero.talents) {
    const en = aplatir(talent.en);
    if (en.length >= 4 && cle.includes(en) && en.length > meilleureLongueur) {
      meilleur = talent;
      meilleureLongueur = en.length;
    }
  }
  return meilleur;
}

const urlIcone = (fichier) => table.base + table.prefixeIcone + fichier;
const urlPortrait = (fichier) => table.base + table.prefixePortrait + fichier;

/* =========================================================================
   RENDU
   ========================================================================= */

function creerCase(hero, identifiant) {
  const talent = trouverTalent(hero, identifiant);
  if (!talent || !talent.icone) {
    // Talent non traduit : une case pleine vaut mieux qu'un trou, et son
    // identifiant brut reste lisible au survol.
    const vide = document.createElement('div');
    vide.className = 'case';
    vide.title = identifiant;
    return vide;
  }
  const img = document.createElement('img');
  img.className = 'case';
  img.src = urlIcone(talent.icone);
  img.alt = talent.fr;
  img.title = `${talent.fr} — palier ${talent.niveau}`;
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
  nom.textContent = hero ? hero.nom.fr : joueur.h;
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
      talents.append(creerCase(hero, identifiant));
    } else {
      const vide = document.createElement('div');
      vide.className = 'case';
      talents.append(vide); // Palier pas encore atteint.
    }
  }
  ligne.append(talents);
  return ligne;
}

function afficher(etat) {
  dernierEtat = etat;
  cadre.classList.toggle('partie', Boolean(etat && etat.j && etat.j.length));
  if (!etat || !etat.j || !etat.j.length) return;


  $('#carte').textContent = etat.carte || '';
  const s = Math.max(0, Math.round(etat.t || 0));
  $('#chrono').textContent = `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;

  const bans = $('#bans');
  bans.replaceChildren();
  $('#bans-libelle').hidden = !(etat.bans && etat.bans.length);
  for (const identifiant of etat.bans || []) {
    const hero = trouverHeros(identifiant);
    if (!hero || !hero.portrait) continue;
    const img = document.createElement('img');
    img.src = urlPortrait(hero.portrait);
    img.alt = hero.nom.fr;
    img.title = hero.nom.fr;
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
    cartouche.textContent = niveau ? `niveau ${niveau}` : '';

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
    bascule.textContent = equipeAffichee === 1 ? 'Voir l’équipe rouge →' : '← Voir l’équipe bleue';
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
  $('#attente').textContent = 'Table des talents introuvable.';
});
