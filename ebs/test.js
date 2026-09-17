#!/usr/bin/env node
/* =========================================================================
   TEST DE L'EBS, DE BOUT EN BOUT

   On démarre l'EBS avec un secret d'essai, on forge les jetons que Twitch
   fabriquerait, et on déroule le parcours complet : appairage, publication,
   lecture par un viewer, lecture retardée, statut.

   Le seul appel qu'on ne peut pas jouer est celui vers l'API de Twitch : il
   demande de vraies identités. Le test vérifie donc aussi que son échec est
   traité proprement, et que l'état reste servi malgré lui.

     node ebs/test.js
   ========================================================================= */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const jwt = require('./jwt.js');

const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const SECRET_B64 = Buffer.from('secret-de-test-pour-l-integration').toString('base64');
const SECRET = Buffer.from(SECRET_B64, 'base64');
const CANAL = '123456789';

const jetonTwitch = (role) => jwt.signer({
  channel_id: CANAL,
  user_id: '999',
  role,
  opaque_user_id: 'U999',
}, SECRET, 600);

let echecs = 0;

function verifier(intitule, condition, detail) {
  console.log(`  ${condition ? 'ok  ' : 'ECHEC'} ${intitule}${condition ? '' : ` — ${detail}`}`);
  if (!condition) echecs++;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function appeler(chemin, options = {}) {
  const reponse = await fetch(BASE + chemin, options);
  let corps = null;
  try { corps = await reponse.json(); } catch { /* corps vide */ }
  return { code: reponse.status, corps };
}

const chargeExemple = (t) => ({
  v: 1,
  t,
  carte: 'Les champs de l’éternité',
  bans: ['Garrosh', 'MeiOW'],
  j: [{ e: 1, n: 'Eowea#21654', h: 'Malganis', l: 20, t: ['MalGanisVampiricTouchVampiricAura'] }],
});

async function main() {
  // --http : le test parle en clair, sans dependre du certificat local.
  const serveur = spawn(process.execPath, [path.join(__dirname, 'serveur.js'), '--http'], {
    env: {
      ...process.env,
      EBS_PORT: String(PORT),
      EXT_CLIENT_ID: 'client-de-test',
      EXT_SECRET: SECRET_B64,
      EXT_PROPRIETAIRE: '999',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serveur.stderr.on('data', (d) => {
    const texte = String(d);
    // L'échec de diffusion est attendu : pas de vraie identité Twitch ici.
    if (!texte.includes('diffusion :')) process.stderr.write(texte);
  });

  await dormir(900);
  console.log('\nParcours complet :\n');

  // --- Appairage ---------------------------------------------------------
  const refuse = await appeler('/appairage', {
    headers: { authorization: `Bearer ${jetonTwitch('viewer')}` },
  });
  verifier('un viewer ne peut pas obtenir le jeton d\'appairage', refuse.code === 403, `code ${refuse.code}`);

  const sansJeton = await appeler('/appairage');
  verifier('sans jeton, l\'appairage est refusé', sansJeton.code === 403, `code ${sansJeton.code}`);

  const appairage = await appeler('/appairage', {
    headers: { authorization: `Bearer ${jetonTwitch('broadcaster')}` },
  });
  verifier('le diffuseur obtient un jeton', appairage.code === 200 && Boolean(appairage.corps.jeton),
    `code ${appairage.code}`);
  verifier('le jeton porte sur sa chaîne', appairage.corps && appairage.corps.canal === CANAL,
    JSON.stringify(appairage.corps));

  const jetonPont = appairage.corps.jeton;

  const stable = await appeler('/appairage', {
    headers: { authorization: `Bearer ${jetonTwitch('broadcaster')}` },
  });
  verifier('le jeton ne change pas d\'un appel à l\'autre', stable.corps.jeton === jetonPont,
    'un nouvel appel a régénéré le jeton');

  // --- Publication -------------------------------------------------------
  const usurpe = await appeler('/publier', {
    method: 'POST',
    headers: { authorization: 'Bearer faux-jeton', 'x-canal': CANAL, 'content-type': 'application/json' },
    body: JSON.stringify(chargeExemple(10)),
  });
  verifier('un mauvais jeton d\'appairage est rejeté', usurpe.code === 401, `code ${usurpe.code}`);

  const publier = (t) => appeler('/publier', {
    method: 'POST',
    headers: { authorization: `Bearer ${jetonPont}`, 'x-canal': CANAL, 'content-type': 'application/json' },
    body: JSON.stringify(chargeExemple(t)),
  });

  const ancien = await publier(100);
  // 502 : la diffusion vers Twitch échoue faute de vraie identité, c'est prévu.
  verifier('la publication est acceptée et l\'échec de diffusion signalé', ancien.code === 502,
    `code ${ancien.code}`);

  await dormir(1200);
  await publier(200);

  // --- Lecture par un viewer --------------------------------------------
  const anonyme = await appeler('/etat');
  verifier('sans jeton Twitch, l\'état est refusé', anonyme.code === 401, `code ${anonyme.code}`);

  const courant = await appeler('/etat', {
    headers: { authorization: `Bearer ${jetonTwitch('viewer')}` },
  });
  verifier('un viewer lit l\'état courant', courant.code === 200 && courant.corps.t === 200,
    JSON.stringify(courant.corps && courant.corps.t));

  const retarde = await appeler('/etat?retard=1', {
    headers: { authorization: `Bearer ${jetonTwitch('viewer')}` },
  });
  verifier('avec un retard, il reçoit l\'état d\'avant', retarde.corps.t === 100,
    `t = ${retarde.corps.t}, attendu 100`);

  const tropLoin = await appeler('/etat?retard=600', {
    headers: { authorization: `Bearer ${jetonTwitch('viewer')}` },
  });
  verifier('un retard plus long que l\'historique rend le plus ancien', tropLoin.corps.t === 100,
    `t = ${tropLoin.corps.t}`);

  // --- Statut ------------------------------------------------------------
  const statut = await appeler('/statut', {
    headers: { authorization: `Bearer ${jetonTwitch('broadcaster')}` },
  });
  verifier('le tableau de bord voit le lecteur connecté',
    statut.code === 200 && statut.corps.connecte === true, JSON.stringify(statut.corps));

  // --- Signature ---------------------------------------------------------
  const jetonDiffusion = jwt.jetonDeDiffusion(CANAL, '999', SECRET);
  const relu = jwt.verifier(jetonDiffusion, SECRET);
  verifier('le jeton de diffusion porte les bonnes permissions',
    relu.role === 'external' && relu.pubsub_perms.send.includes('broadcast'), JSON.stringify(relu));

  let alteré = false;
  try {
    const morceaux = jetonDiffusion.split('.');
    jwt.verifier(`${morceaux[0]}.${morceaux[1]}.${'A'.repeat(morceaux[2].length)}`, SECRET);
  } catch {
    alteré = true;
  }
  verifier('une signature falsifiée est rejetée', alteré, 'le jeton falsifié a été accepté');

  serveur.kill();
  console.log(`\n${echecs === 0 ? 'Tout passe.' : `${echecs} échec(s).`}\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
