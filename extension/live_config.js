/* =========================================================================
   TABLEAU DE BORD DU DIRECT

   Une seule question, posée toutes les cinq secondes : est-ce que le lecteur
   envoie ? C'est ce qu'on veut voir d'un coup d'oeil en pleine partie, sans
   avoir à basculer sur une fenêtre de terminal.

   Les textes viennent de langue.js, chargé juste avant ce script.
   ========================================================================= */
'use strict';

const etat = document.getElementById('etat');
const texte = document.getElementById('etat-texte');
const detail = document.getElementById('detail');

const mmss = (s) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;

function montrer(actif, principal, secondaire) {
  etat.dataset.actif = actif ? 'oui' : 'non';
  texte.textContent = principal;
  detail.textContent = secondaire || '';
}

window.Twitch.ext.onAuthorized((auth) => {
  const interroger = async () => {
    try {
      const reponse = await fetch(`${window.REGLAGES.ebs}/statut`, {
        headers: { authorization: `Bearer ${auth.token}` },
        cache: 'no-store',
      });

      if (!reponse.ok) {
        montrer(false, texteDe('directInjoignable'),
          texteDe('directReponse', { code: reponse.status }));
        return;
      }

      const statut = await reponse.json();
      if (!statut.connecte) {
        montrer(false, texteDe('directArrete'), statut.depuis
          ? texteDe('directDernierMessage', { s: Math.round(statut.depuis / 1000) })
          : '');
        return;
      }

      montrer(true, texteDe('directConnecte'), statut.joueurs
        ? texteDe('directPartie', { temps: mmss(statut.seconde), n: statut.joueurs })
        : texteDe('directAttente'));
    } catch (err) {
      montrer(false, texteDe('directInjoignable'), err.message);
    }
  };

  interroger();
  setInterval(interroger, 5000);
});
