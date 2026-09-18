/* =========================================================================
   PAGES LÉGALES — choix de la langue

   La langue vit dans le fragment de l'adresse (#fr, #en) plutôt que dans un
   stockage local : un lien vers la version anglaise doit pouvoir s'envoyer
   tel quel — à un examinateur de Twitch, par exemple — et arriver en anglais.

   Sans JavaScript, la version française reste affichée et l'anglaise est
   marquée `hidden` : la page dit toujours quelque chose de complet.
   ========================================================================= */
'use strict';

const LANGUES = ['fr', 'en'];
const REPLI = 'fr'; // L'auteur est francophone ; l'anglais est à un clic.

function demandee() {
  const fragment = window.location.hash.replace('#', '').toLowerCase();
  if (LANGUES.includes(fragment)) return fragment;

  const navigateur = String(navigator.language || '').slice(0, 2).toLowerCase();
  return LANGUES.includes(navigateur) ? navigateur : REPLI;
}

function appliquer(langue) {
  document.documentElement.lang = langue;

  for (const article of document.querySelectorAll('[data-langue]')) {
    article.hidden = article.dataset.langue !== langue;
  }
  for (const lien of document.querySelectorAll('.bascule a')) {
    lien.setAttribute('aria-current', String(lien.dataset.vers === langue));
  }
}

appliquer(demandee());
window.addEventListener('hashchange', () => appliquer(demandee()));
