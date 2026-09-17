/* =========================================================================
   TABLEAU DE BORD DU DIRECT

   Une seule question, posée toutes les cinq secondes : est-ce que le lecteur
   envoie ? C'est ce qu'on veut voir d'un coup d'oeil en pleine partie, sans
   avoir à basculer sur une fenêtre de terminal.
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
        montrer(false, 'EBS injoignable', `Le serveur a répondu ${reponse.status}.`);
        return;
      }

      const statut = await reponse.json();
      if (!statut.connecte) {
        montrer(false, 'Lecteur arrêté',
          statut.depuis ? `Dernier message il y a ${Math.round(statut.depuis / 1000)} s.` : '');
        return;
      }

      montrer(true, 'Lecteur connecté', statut.joueurs
        ? `Partie en cours à ${mmss(statut.seconde)}, ${statut.joueurs} joueurs suivis.`
        : 'En attente d\'une partie.');
    } catch (err) {
      montrer(false, 'EBS injoignable', err.message);
    }
  };

  interroger();
  setInterval(interroger, 5000);
});
