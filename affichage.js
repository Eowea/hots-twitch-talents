/* =========================================================================
   AFFICHAGE DU LECTEUR

   Ce que voit le streamer pendant qu'il joue. Ce n'est pas un journal
   technique : c'est une fenêtre qu'il laisse ouverte dans un coin, et qui doit
   lui dire en un coup d'œil si tout va bien.

   Le journal d'origine écrivait une ligne par message envoyé — « 240s,
   10 joueurs, 1049 octets, rappel » — toutes les deux secondes. Exact, et
   parfaitement inquiétant pour qui n'a pas écrit le programme. On raconte donc
   des états, pas des envois : une partie commence, elle avance, elle se
   termine.

   Les textes viennent de textes.js, en français ou en anglais selon la
   machine : ce programme est distribué, et son premier écran est celui d'un
   inconnu qui vient de le télécharger.

   `--detail` rend le journal technique, pour diagnostiquer une panne.
   ========================================================================= */
'use strict';

const { texteDe } = require('./textes.js');

const DETAIL = process.argv.includes('--detail');

// Réécrire la même ligne demande un vrai terminal ; redirigé vers un fichier,
// on empile les lignes plutôt que d'y semer des caractères de contrôle.
const INTERACTIF = Boolean(process.stdout.isTTY) && !DETAIL;

let ligneEnCours = false;
let dernierResume = '';

function effacerLigne() {
  if (!ligneEnCours) return;
  process.stdout.write(`\r${' '.repeat(78)}\r`);
  ligneEnCours = false;
}

function dire(texte = '') {
  effacerLigne();
  console.log(texte);
}

/* Une ligne qui se réécrit sur place, pour que l'avancement d'une partie ne
   déroule pas trois cents lignes. */
function surPlace(texte) {
  if (!INTERACTIF) {
    if (texte !== dernierResume) { console.log(texte); dernierResume = texte; }
    return;
  }
  process.stdout.write(`\r${texte.padEnd(78)}`);
  ligneEnCours = true;
}

const mmss = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}`;

/* =========================================================================
   LES ÉTATS
   ========================================================================= */

function demarrage(canal) {
  dire();
  dire(`  ${texteDe('banniere')}`);
  dire('  ' + '─'.repeat(40));
  dire(`  ${texteDe('chaine', { canal })}`);
  dire();
  dire(`  ${texteDe('laisserOuvert')}`);
  dire(`  ${texteDe('peutReduire')}`);
  dire();
}

function attente() {
  dire(`  ${texteDe('attente')}`);
  dire();
}

function partie(charge) {
  const talents = charge.j.reduce((n, j) => n + (j.t ? j.t.length : 0), 0);
  surPlace(`  ${texteDe('enCours', {
    temps: mmss(charge.t),
    joueurs: charge.j.length,
    talents,
  })}`);
}

function finPartie() {
  effacerLigne();
  dire(`  ${texteDe('terminee')}`);
  dire(`  ${texteDe('resteVisible')}`);
  dire();
}

/* =========================================================================
   LES ENNUIS
   Dits dans la langue du diffuseur, avec ce qu'il faut faire — et une seule
   fois, pour ne pas noyer l'écran pendant une coupure de réseau.
   ========================================================================= */

let dernierEnnui = '';

function ennui(texte, conseil) {
  if (texte === dernierEnnui) return;
  dernierEnnui = texte;
  effacerLigne();
  dire();
  dire(`  ${texte}`);
  if (conseil) dire(`  ${conseil}`);
  dire();
}

function retabli() {
  if (!dernierEnnui) return;
  dernierEnnui = '';
  dire(`  ${texteDe('retabli')}`);
  dire();
}

const reseauCoupe = () => ennui(
  texteDe('injoignable'),
  texteDe('injoignableConseil'),
);

const appairageRefuse = () => ennui(
  texteDe('appairageRefuse'),
  texteDe('appairageRefuseConseil'),
);

const envoiRefuse = (code) => ennui(
  texteDe('envoiRefuse', { code }),
  texteDe('envoiRefuseConseil'),
);

/* Le journal technique, sur demande. */
function detail(texte) {
  if (DETAIL) dire(`  ${texte}`);
}

module.exports = {
  DETAIL,
  dire,
  demarrage,
  attente,
  partie,
  finPartie,
  reseauCoupe,
  appairageRefuse,
  envoiRefuse,
  retabli,
  detail,
  mmss,
};
