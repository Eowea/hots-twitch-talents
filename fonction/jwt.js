/* =========================================================================
   JETONS — signature, vérification, et dérivation des jetons d'appairage

   Écrit en WebCrypto plutôt qu'avec le module crypto de Node : c'est la seule
   interface disponible dans une fonction Cloudflare, et elle existe aussi dans
   Node. Une seule implémentation, testable localement, déployable telle quelle.

   Tout y est asynchrone — c'est la contrainte de WebCrypto, et la raison pour
   laquelle ce fichier ne ressemble pas à son ancêtre ebs/jwt.js.
   ========================================================================= */

const encodeur = new TextEncoder();

/* =========================================================================
   BASE64URL
   Sans Buffer, qui n'existe pas dans une fonction Cloudflare.
   ========================================================================= */

function versB64url(octets) {
  let binaire = '';
  for (const octet of new Uint8Array(octets)) binaire += String.fromCharCode(octet);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function depuisB64url(texte) {
  const binaire = atob(String(texte).replace(/-/g, '+').replace(/_/g, '/'));
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

const texteVersB64url = (texte) => versB64url(encodeur.encode(texte));

/* Le secret arrive de la console Twitch encodé en base64. Il faut le décoder
   avant de signer : signer avec la chaîne telle quelle produit des jetons que
   Twitch rejette sans message clair. */
const secretEnOctets = (secretB64) => depuisB64url(String(secretB64).replace(/=+$/, ''));

async function cleHmac(secretB64, usages) {
  return crypto.subtle.importKey(
    'raw',
    secretEnOctets(secretB64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

/* =========================================================================
   JWT
   ========================================================================= */

async function signer(charge, secretB64, dureeSecondes = 120) {
  const entete = texteVersB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corps = texteVersB64url(JSON.stringify({
    ...charge,
    exp: Math.floor(Date.now() / 1000) + dureeSecondes,
  }));

  const cle = await cleHmac(secretB64, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cle, encodeur.encode(`${entete}.${corps}`));
  return `${entete}.${corps}.${versB64url(signature)}`;
}

/* Vérifie un jeton présenté par un viewer ou par la page de configuration.
   Renvoie la charge utile, ou null — jamais d'exception à rattraper ailleurs. */
async function verifier(jeton, secretB64) {
  const morceaux = String(jeton || '').split('.');
  if (morceaux.length !== 3) return null;

  const [entete, corps, signature] = morceaux;
  const cle = await cleHmac(secretB64, ['verify']);

  let valide = false;
  try {
    // subtle.verify compare en temps constant : rien à faire de plus.
    valide = await crypto.subtle.verify(
      'HMAC', cle, depuisB64url(signature), encodeur.encode(`${entete}.${corps}`),
    );
  } catch {
    return null; // Signature illisible.
  }
  if (!valide) return null;

  let charge;
  try {
    charge = JSON.parse(new TextDecoder().decode(depuisB64url(corps)));
  } catch {
    return null;
  }
  if (typeof charge.exp === 'number' && charge.exp < Math.floor(Date.now() / 1000)) return null;
  return charge;
}

/* Le jeton que Twitch attend pour publier un message PubSub sur une chaîne.
   Le rôle « external » est celui des services côté serveur. */
function jetonDeDiffusion(canal, proprietaire, secretB64) {
  return signer({
    user_id: String(proprietaire),
    role: 'external',
    channel_id: String(canal),
    pubsub_perms: { send: ['broadcast'] },
  }, secretB64);
}

/* =========================================================================
   JETONS D'APPAIRAGE, DÉRIVÉS PLUTÔT QUE STOCKÉS

   Le jeton d'une chaîne est le condensé de son identifiant par le secret. On
   le recalcule à chaque fois au lieu de le garder : la fonction n'a donc ni
   fichier, ni base de données, et peut mourir et renaître sans rien perdre.

   Contrepartie assumée : on ne peut pas révoquer un jeton isolément sans
   changer le secret. C'est un cas rare, et il ne doit pas imposer une base de
   données au cas courant.
   ========================================================================= */

const messageDAppairage = (canal) => encodeur.encode(`appairage:${canal}`);

async function jetonDAppairage(canal, secretB64) {
  const cle = await cleHmac(secretB64, ['sign']);
  return versB64url(await crypto.subtle.sign('HMAC', cle, messageDAppairage(canal)));
}

async function appairageValide(canal, jeton, secretB64) {
  if (!canal || !jeton) return false;
  const cle = await cleHmac(secretB64, ['verify']);
  try {
    return await crypto.subtle.verify('HMAC', cle, depuisB64url(jeton), messageDAppairage(canal));
  } catch {
    return false; // Jeton mal formé : c'est un refus, pas une erreur.
  }
}

export {
  signer,
  verifier,
  jetonDeDiffusion,
  jetonDAppairage,
  appairageValide,
  versB64url,
  depuisB64url,
  texteVersB64url,
};
