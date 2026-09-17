/* =========================================================================
   PAGE DE CONFIGURATION — appairage du PC

   Twitch authentifie le diffuseur pour nous : onAuthorized fournit un jeton
   signé avec le secret de l'extension, que l'EBS vérifie. Personne d'autre ne
   peut donc obtenir le jeton d'appairage d'une chaîne qui n'est pas la sienne.
   ========================================================================= */
'use strict';

const afficher = (id, texte) => { document.getElementById(id).textContent = texte; };

function erreur(texte) {
  const message = document.getElementById('message');
  message.textContent = texte;
  message.className = 'erreur';
  message.hidden = false;
}

window.Twitch.ext.onAuthorized(async (auth) => {
  try {
    const reponse = await fetch(`${window.REGLAGES.ebs}/appairage`, {
      headers: { authorization: `Bearer ${auth.token}` },
    });

    if (!reponse.ok) {
      erreur(`L'EBS a répondu ${reponse.status}. Vérifie qu'il tourne et que `
        + `son adresse (${window.REGLAGES.ebs}) est la bonne dans reglages.js.`);
      return;
    }

    const { canal, jeton } = await reponse.json();
    afficher('canal', canal);
    afficher('jeton', jeton);
    afficher('fichier', JSON.stringify({ ebs: window.REGLAGES.ebs, canal, jeton }, null, 2));
  } catch (err) {
    erreur(`EBS injoignable : ${err.message}`);
  }
});
