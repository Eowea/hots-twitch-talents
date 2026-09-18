/* =========================================================================
   PAGE DE CONFIGURATION — appairage du PC

   Twitch authentifie le diffuseur pour nous : onAuthorized fournit un jeton
   signé avec le secret de l'extension, que l'EBS vérifie. Personne d'autre ne
   peut donc obtenir le jeton d'appairage d'une chaîne qui n'est pas la sienne.

   La page annonce chaque étape. Sans ça, une autorisation qui n'arrive jamais
   laisse trois « … » à l'écran et rien pour comprendre pourquoi — c'est
   exactement ce qui s'est produit la première fois.

   Les textes viennent de langue.js, chargé juste avant ce script : cette page
   est vue par chaque diffuseur qui installe l'extension, pas seulement par le
   sien.
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

dire(texteDe('configConnexion'));

/* Si le script d'aide de Twitch n'est même pas là, la page n'est pas chargée
   dans le gestionnaire d'extensions — ou son domaine est bloqué. */
if (!window.Twitch || !window.Twitch.ext) {
  dire(texteDe('configSansHelper'), true);
} else {
  setTimeout(() => {
    if (autorise) return;
    dire(texteDe('configSansAutorisation'), true);
  }, DELAI_TWITCH);

  window.Twitch.ext.onAuthorized(async (auth) => {
    autorise = true;
    dire(texteDe('configAutorise', { ebs: window.REGLAGES.ebs }));

    try {
      const reponse = await fetch(`${window.REGLAGES.ebs}/appairage`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });

      if (reponse.status === 403) {
        dire(texteDe('configRefus'), true);
        return;
      }

      if (!reponse.ok) {
        dire(texteDe('configErreur', { code: reponse.status }), true);
        return;
      }

      const { canal, code } = await reponse.json();
      afficher('code', code);
      afficher('canal', canal);
      dire(texteDe('configPret'));
    } catch (err) {
      dire(texteDe('configInjoignable', {
        ebs: window.REGLAGES.ebs,
        erreur: err.message,
        domaine: new URL(window.REGLAGES.ebs).hostname,
      }), true);
    }
  });
}
