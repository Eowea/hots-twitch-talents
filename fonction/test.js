/* =========================================================================
   TEST DE LA FONCTION, SANS CLOUDFLARE NI TWITCH

   Le code de la fonction n'utilise que des interfaces web — Request, Response,
   fetch, WebCrypto — toutes présentes dans Node. On peut donc l'éprouver ici,
   exactement telle qu'elle sera déployée, sans rien émuler.

   Le seul appel qu'on ne peut pas jouer est celui vers l'API de Twitch : il
   demande de vraies identités. Le test vérifie donc que son échec est traité
   proprement, et non qu'il réussit.

     node fonction/test.js
   ========================================================================= */

import { router } from './index.js';
import { signer, jetonDAppairage, texteVersB64url } from './jwt.js';

const CANAL = '123456789';
const BASE = 'https://fonction.test';

const ENV = {
  EXT_CLIENT_ID: 'client-de-test',
  EXT_SECRET: btoa('secret-de-test-pour-l-integration-1234'),
  EXT_PROPRIETAIRE: '999',
  EBS_PUBLIQUE: BASE,
};

let echecs = 0;

function verifier(intitule, condition, detail) {
  console.log(`  ${condition ? 'ok  ' : 'ECHEC'} ${intitule}${condition ? '' : ` — ${detail}`}`);
  if (!condition) echecs++;
}

const jetonTwitch = (role) => signer(
  { channel_id: CANAL, user_id: '999', role, opaque_user_id: 'U999' }, ENV.EXT_SECRET, 600,
);

async function appeler(chemin, options = {}) {
  const reponse = await router(new Request(BASE + chemin, options), ENV);
  let corps = null;
  try { corps = await reponse.json(); } catch { /* corps vide */ }
  return { code: reponse.status, corps, entetes: reponse.headers };
}

const charge = (t) => JSON.stringify({
  v: 1,
  t,
  carte: 'Les champs de l’éternité',
  bans: ['Garrosh'],
  j: [{ e: 1, n: 'Eowea', h: 'Malganis', l: 20, t: ['MalGanisVampiricTouchVampiricAura'] }],
});

async function main() {
  console.log('\nParcours complet :\n');

  // --- Appairage ---------------------------------------------------------
  const viewer = await appeler('/appairage', {
    headers: { authorization: `Bearer ${await jetonTwitch('viewer')}` },
  });
  verifier("un viewer ne peut pas obtenir le code d'appairage", viewer.code === 403, `code ${viewer.code}`);

  const anonyme = await appeler('/appairage');
  verifier("sans jeton, l'appairage est refusé", anonyme.code === 403, `code ${anonyme.code}`);

  const diffuseur = await appeler('/appairage', {
    headers: { authorization: `Bearer ${await jetonTwitch('broadcaster')}` },
  });
  verifier('le diffuseur obtient son code', diffuseur.code === 200 && Boolean(diffuseur.corps.code),
    `code ${diffuseur.code}`);

  let decode = null;
  try {
    decode = JSON.parse(atob(String(diffuseur.corps.code).replace(/-/g, '+').replace(/_/g, '/')));
  } catch { /* illisible */ }
  verifier('le code porte la chaîne, le jeton et l\'adresse',
    Boolean(decode) && decode.c === CANAL && decode.j === diffuseur.corps.jeton && Boolean(decode.e),
    JSON.stringify(decode));

  // --- Dérivation plutôt que stockage ------------------------------------
  const encore = await appeler('/appairage', {
    headers: { authorization: `Bearer ${await jetonTwitch('broadcaster')}` },
  });
  verifier('le jeton est stable sans être stocké nulle part',
    encore.corps.jeton === diffuseur.corps.jeton, 'deux appels ont donné deux jetons différents');

  const autre = await jetonDAppairage('987654321', ENV.EXT_SECRET);
  verifier('chaque chaîne a le sien', autre !== diffuseur.corps.jeton, 'deux chaînes, même jeton');

  // --- Publication -------------------------------------------------------
  const jeton = diffuseur.corps.jeton;
  const publier = (corps, entetes = {}) => appeler('/publier', {
    method: 'POST',
    headers: { authorization: `Bearer ${jeton}`, 'x-canal': CANAL, ...entetes },
    body: corps,
  });

  const usurpe = await appeler('/publier', {
    method: 'POST',
    headers: { authorization: 'Bearer faux-jeton', 'x-canal': CANAL },
    body: charge(10),
  });
  verifier('un mauvais jeton est rejeté', usurpe.code === 401, `code ${usurpe.code}`);

  const autreChaine = await appeler('/publier', {
    method: 'POST',
    headers: { authorization: `Bearer ${jeton}`, 'x-canal': '987654321' },
    body: charge(10),
  });
  verifier("le jeton d'une chaîne ne vaut pas pour une autre", autreChaine.code === 401,
    `code ${autreChaine.code}`);

  const illisible = await publier('ceci n est pas du JSON');
  verifier('une charge utile illisible est refusée', illisible.code === 400, `code ${illisible.code}`);

  const trop = await publier(JSON.stringify({ x: 'a'.repeat(6000) }));
  verifier('un message au-dessus de 5 Ko est refusé', trop.code === 413, `code ${trop.code}`);

  // 502 : la diffusion échoue faute de vraie identité Twitch, c'est prévu.
  const bonne = await publier(charge(100));
  verifier("la publication passe l'authentification et atteint Twitch", bonne.code === 502,
    `code ${bonne.code} — attendu 502 (refus de Twitch, sans vraies identités)`);

  // --- Divers ------------------------------------------------------------
  const prevol = await appeler('/publier', { method: 'OPTIONS' });
  verifier('le contrôle CORS répond', prevol.code === 204, `code ${prevol.code}`);

  const racine = await appeler('/');
  verifier('la racine dit que la fonction tourne', racine.code === 200, `code ${racine.code}`);

  const inconnu = await appeler('/nimporte-quoi');
  verifier('une route inconnue renvoie 404', inconnu.code === 404, `code ${inconnu.code}`);

  // --- Signature ---------------------------------------------------------
  const vrai = await jetonTwitch('broadcaster');
  const morceaux = vrai.split('.');
  const falsifie = await appeler('/appairage', {
    headers: { authorization: `Bearer ${morceaux[0]}.${morceaux[1]}.${'A'.repeat(morceaux[2].length)}` },
  });
  verifier('une signature falsifiée est rejetée', falsifie.code === 403, `code ${falsifie.code}`);

  const expire = await signer({ channel_id: CANAL, role: 'broadcaster' }, ENV.EXT_SECRET, -60);
  const perime = await appeler('/appairage', { headers: { authorization: `Bearer ${expire}` } });
  verifier('un jeton expiré est rejeté', perime.code === 403, `code ${perime.code}`);

  console.log(`\n${echecs === 0 ? 'Tout passe.' : `${echecs} échec(s).`}\n`);

  /* On pose le code de sortie sans forcer l'arrêt : la requête vers Twitch
     est encore en vol, et la couper net fait râler libuv sous Windows. Node
     s'arrêtera de lui-même une fois la connexion refermée. */
  process.exitCode = echecs === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
