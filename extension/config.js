/* =========================================================================
   PAGE DE CONFIGURATION — appairage du PC

   Twitch authentifie le diffuseur pour nous : onAuthorized fournit un jeton
   signé avec le secret de l'extension, que l'EBS vérifie. Personne d'autre ne
   peut donc obtenir le jeton d'appairage d'une chaîne qui n'est pas la sienne.

   La page annonce chaque étape. Sans ça, une autorisation qui n'arrive jamais
   laisse trois « … » à l'écran et rien pour comprendre pourquoi — c'est
   exactement ce qui s'est produit la première fois.
   ========================================================================= */
'use strict';

const DELAI_TWITCH = 6000; // Au-delà, onAuthorized ne viendra plus.

const message = document.getElementById('message');
let autorise = false;

function afficher(id, texte) {
  document.getElementById(id).textContent = texte;
}

function dire(texte, enErreur = false) {
  message.textContent = texte;
  message.className = enErreur ? 'erreur' : 'detail';
  message.hidden = false;
}

dire('Connexion à Twitch…');

/* Si le script d'aide de Twitch n'est même pas là, la page n'est pas chargée
   dans le gestionnaire d'extensions — ou son domaine est bloqué. */
if (!window.Twitch || !window.Twitch.ext) {
  dire('Le script d\'aide de Twitch ne s\'est pas chargé. Cette page doit être '
    + 'ouverte depuis le gestionnaire d\'extensions, pas directement.', true);
} else {
  setTimeout(() => {
    if (autorise) return;
    dire('Twitch n\'a pas autorisé la page au bout de 6 secondes. C\'est en '
      + 'général le certificat de localhost qui n\'a pas été accepté dans ce '
      + 'navigateur, ou l\'extension qui n\'est pas installée sur la chaîne. '
      + 'Ouvre la console (F12) : le vrai motif y est écrit.', true);
  }, DELAI_TWITCH);

  window.Twitch.ext.onAuthorized(async (auth) => {
    autorise = true;
    dire(`Autorisé par Twitch. Interrogation de l'EBS sur ${window.REGLAGES.ebs}…`);

    try {
      const reponse = await fetch(`${window.REGLAGES.ebs}/appairage`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });

      if (reponse.status === 403) {
        dire('L\'EBS a répondu 403. Il n\'a pas reconnu le jeton de Twitch : '
          + 'le secret de ebs/config.json ne correspond pas à celui de la '
          + 'console Twitch. Si tu as régénéré une clé, l\'ancienne ne vaut plus.', true);
        return;
      }

      if (!reponse.ok) {
        dire(`L'EBS a répondu ${reponse.status}.`, true);
        return;
      }

      const { canal, code } = await reponse.json();
      afficher('code', code);
      afficher('canal', canal);
      dire('Prêt. Colle ce code dans le lecteur, au premier démarrage.');
    } catch (err) {
      const domaine = new URL(window.REGLAGES.ebs).hostname;
      dire(`Service injoignable à ${window.REGLAGES.ebs} (${err.message}). `
        + `Vérifie que « ${domaine} » figure dans la liste blanche des requêtes `
        + 'de la console Twitch. Si tu viens de changer cette adresse, recharge '
        + "cette page avec Ctrl+Shift+R : le navigateur garde l'ancienne en cache.",
      true);
    }
  });
}
