/* =========================================================================
   JETONS JWT — signature et vérification, en HS256

   Twitch signe les jetons de ses viewers avec le secret de l'extension, et
   attend qu'on signe les nôtres de la même façon. C'est un HMAC-SHA256 et du
   base64url : le module crypto de Node suffit, pas besoin de bibliothèque.

   Le secret fourni par la console Twitch est encodé en base64. Il faut le
   décoder AVANT de signer : signer avec la chaîne telle quelle produit des
   jetons que Twitch rejette, sans message d'erreur clair.
   ========================================================================= */
'use strict';

const crypto = require('crypto');

const encoder = (valeur) => Buffer.from(JSON.stringify(valeur)).toString('base64url');

function hmac(donnees, secret) {
  return crypto.createHmac('sha256', secret).update(donnees).digest('base64url');
}

/* Signe une charge utile. La durée de vie reste courte : ces jetons ne servent
   qu'à l'aller-retour immédiat vers l'API de Twitch. */
function signer(charge, secret, dureeSecondes = 120) {
  const entete = encoder({ alg: 'HS256', typ: 'JWT' });
  const corps = encoder({
    ...charge,
    exp: Math.floor(Date.now() / 1000) + dureeSecondes,
  });
  return `${entete}.${corps}.${hmac(`${entete}.${corps}`, secret)}`;
}

/* Vérifie un jeton présenté par un viewer ou par la page de configuration.
   Renvoie la charge utile, ou lève. */
function verifier(jeton, secret) {
  const morceaux = String(jeton || '').split('.');
  if (morceaux.length !== 3) throw new Error('jeton malformé');

  const [entete, corps, signature] = morceaux;
  const attendue = hmac(`${entete}.${corps}`, secret);

  // timingSafeEqual exige deux tampons de même longueur : on compare d'abord
  // les tailles, sinon il lève au lieu de renvoyer faux.
  const recue = Buffer.from(signature);
  const bonne = Buffer.from(attendue);
  if (recue.length !== bonne.length || !crypto.timingSafeEqual(recue, bonne)) {
    throw new Error('signature invalide');
  }

  const charge = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
  if (typeof charge.exp === 'number' && charge.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('jeton expiré');
  }
  return charge;
}

/* Le jeton que Twitch attend pour publier un message PubSub sur une chaîne.
   Le rôle "external" est celui des services côté serveur. */
function jetonDeDiffusion(canal, proprietaire, secret) {
  return signer({
    user_id: String(proprietaire),
    role: 'external',
    channel_id: String(canal),
    pubsub_perms: { send: ['broadcast'] },
  }, secret);
}

module.exports = { signer, verifier, jetonDeDiffusion };
