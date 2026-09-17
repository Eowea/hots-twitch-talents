/* =========================================================================
   LA FONCTION — ce qui relie les PC des streamers aux viewers

   Remplace l'EBS d'origine, et tient en deux points d'entrée :

     GET  /appairage   la page de configuration demande le code du streamer
     POST /publier     son PC pousse l'état de la partie, on le diffuse

   Aucun stockage. Les jetons d'appairage sont dérivés du secret et de
   l'identifiant de chaîne, donc recalculés à la demande : cette fonction peut
   démarrer, mourir et renaître ailleurs sans rien perdre.

   Le secret de l'extension ne vit qu'ici. Un PC de streamer ne connaît que son
   propre jeton, qui ne vaut que pour sa chaîne.

   Configuration (variables d'environnement Cloudflare) :

     EXT_CLIENT_ID     identifiant client de l'extension
     EXT_SECRET        secret de l'extension, en base64, tel que Twitch le donne
     EXT_PROPRIETAIRE  identifiant utilisateur Twitch du propriétaire
   ========================================================================= */

import {
  verifier,
  jetonDeDiffusion,
  jetonDAppairage,
  appairageValide,
  texteVersB64url,
} from './jwt.js';

const API_PUBSUB = 'https://api.twitch.tv/helix/extensions/pubsub';
const TAILLE_MAX = 5 * 1024; // Plafond imposé par Twitch, par message.

/* L'extension est servie par Twitch, la fonction vit ailleurs : sans ces
   en-têtes, le navigateur refuse l'appel. « authorization » doit être nommé,
   le joker « * » ne le couvre pas. */
const ENTETES = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};

const repondre = (corps, code = 200) => new Response(JSON.stringify(corps), {
  status: code,
  headers: { ...ENTETES, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const porteur = (requete) => String(requete.headers.get('authorization') || '')
  .replace(/^Bearer\s+/i, '');

/* =========================================================================
   DIFFUSION
   ========================================================================= */

async function diffuser(canal, message, env) {
  const jeton = await jetonDeDiffusion(canal, env.EXT_PROPRIETAIRE, env.EXT_SECRET);

  const reponse = await fetch(API_PUBSUB, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jeton}`,
      'client-id': env.EXT_CLIENT_ID,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      target: ['broadcast'],
      broadcaster_id: String(canal),
      is_global_broadcast: false,
      message,
    }),
  });

  if (!reponse.ok) {
    throw new Error(`Twitch a refusé : HTTP ${reponse.status} ${await reponse.text()}`);
  }
}

/* =========================================================================
   POINTS D'ENTREE
   ========================================================================= */

/* La page de configuration prouve, avec le jeton que Twitch lui a donné, que
   c'est bien le diffuseur de cette chaîne qui demande. Personne ne peut donc
   obtenir le code d'une chaîne qui n'est pas la sienne. */
async function appairage(requete, env) {
  const identite = await verifier(porteur(requete), env.EXT_SECRET);
  if (!identite || identite.role !== 'broadcaster' || !identite.channel_id) {
    return repondre({ erreur: 'réservé au diffuseur' }, 403);
  }

  const canal = String(identite.channel_id);
  const jeton = await jetonDAppairage(canal, env.EXT_SECRET);

  /* Un seul code à copier, plutôt que trois valeurs à reporter : c'est la
     différence entre un streamer qui y arrive et un streamer qui abandonne. */
  const code = texteVersB64url(JSON.stringify({
    e: env.EBS_PUBLIQUE || new URL(requete.url).origin,
    c: canal,
    j: jeton,
  }));

  return repondre({ canal, jeton, code });
}

async function publier(requete, env) {
  const canal = String(requete.headers.get('x-canal') || '');
  if (!await appairageValide(canal, porteur(requete), env.EXT_SECRET)) {
    return repondre({ erreur: 'appairage invalide' }, 401);
  }

  const message = await requete.text();
  if (message.length > TAILLE_MAX) {
    return repondre({ erreur: `message de ${message.length} octets : au-dessus des 5 Ko` }, 413);
  }

  try {
    JSON.parse(message); // On refuse de relayer ce qu'on ne sait pas lire.
  } catch {
    return repondre({ erreur: 'charge utile illisible' }, 400);
  }

  try {
    await diffuser(canal, message, env);
  } catch (err) {
    return repondre({ erreur: err.message }, 502);
  }
  return repondre({ ok: true });
}

export async function router(requete, env) {
  const url = new URL(requete.url);

  if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: ENTETES });
  if (requete.method === 'GET' && url.pathname === '/appairage') return appairage(requete, env);
  if (requete.method === 'POST' && url.pathname === '/publier') return publier(requete, env);

  // Utile pour vérifier d'un navigateur que la fonction est bien déployée.
  if (requete.method === 'GET' && url.pathname === '/') {
    return repondre({ service: 'hots-twitch-talents', etat: 'en marche' });
  }
  return repondre({ erreur: 'inconnu' }, 404);
}

export default {
  fetch: (requete, env) => router(requete, env),
};
