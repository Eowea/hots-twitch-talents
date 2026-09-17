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

   `--detail` rend le journal technique, pour diagnostiquer une panne.
   ========================================================================= */
'use strict';

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
  dire('  TALENTS — lecteur de parties');
  dire('  ' + '─'.repeat(40));
  dire(`  Chaîne ${canal}`);
  dire();
  dire('  Laisse cette fenêtre ouverte pendant que tu joues.');
  dire('  Tu peux la réduire : elle n\'a rien à afficher d\'important.');
  dire();
}

function attente() {
  dire('  En attente d\'une partie. Lance Heroes of the Storm.');
  dire();
}

function partie(charge) {
  const talents = charge.j.reduce((n, j) => n + (j.t ? j.t.length : 0), 0);
  surPlace(`  Partie en cours — ${mmss(charge.t)}  ·  ${charge.j.length} joueurs`
    + `  ·  ${talents} talents suivis`);
}

function finPartie() {
  effacerLigne();
  dire('  Partie terminée.');
  dire('  Le tableau reste visible quelques minutes chez tes viewers.');
  dire();
}

/* =========================================================================
   LES ENNUIS
   Dits en français, avec ce qu'il faut faire — et une seule fois, pour ne pas
   noyer l'écran pendant une coupure de réseau.
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
  dire('  Connexion rétablie.');
  dire();
}

const reseauCoupe = () => ennui(
  'Service injoignable.',
  'Ta connexion est peut-être coupée. Le lecteur réessaiera tout seul.',
);

const appairageRefuse = () => ennui(
  'Ton appairage a été refusé.',
  'Récupère un nouveau code sur la page de configuration de ton extension, '
  + 'puis supprime le fichier pont.config.json à côté de ce programme.',
);

const envoiRefuse = (code) => ennui(
  `Le service a refusé l'envoi (code ${code}).`,
  'Si ça persiste, préviens Eowea — ce n\'est pas de ton fait.',
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
