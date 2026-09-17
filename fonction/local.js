/* =========================================================================
   LANCEUR LOCAL DE LA FONCTION

   Fait tourner exactement le même code que chez Cloudflare, derrière un
   serveur HTTP ordinaire. Sert à l'éprouver avec de vraies identités Twitch
   avant de déployer — c'est le seul moyen de vérifier que la signature
   WebCrypto est bien acceptée par l'API.

   Les identités sont lues dans ebs/config.json, le même fichier qu'avant,
   toujours hors de git.

     node fonction/local.js [port]
   ========================================================================= */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { router } from './index.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8445);

function identites() {
  const chemin = join(ICI, '..', 'ebs', 'config.json');
  try {
    const c = JSON.parse(readFileSync(chemin, 'utf8'));
    return {
      EXT_CLIENT_ID: process.env.EXT_CLIENT_ID || c.clientId,
      EXT_SECRET: process.env.EXT_SECRET || c.secret,
      EXT_PROPRIETAIRE: process.env.EXT_PROPRIETAIRE || c.proprietaire,
      EBS_PUBLIQUE: process.env.EBS_PUBLIQUE || '',
    };
  } catch {
    console.error(`Identités introuvables. Renseigne ${chemin} :`);
    console.error('  { "clientId": "...", "secret": "...", "proprietaire": "..." }');
    return process.exit(1);
  }
}

const env = identites();

/* Traduction entre le serveur de Node et les objets web qu'attend la fonction.
   C'est tout ce que Cloudflare fait pour nous en production. */
const serveur = createServer(async (entrante, sortante) => {
  const morceaux = [];
  for await (const morceau of entrante) morceaux.push(morceau);

  const requete = new Request(`http://localhost:${PORT}${entrante.url}`, {
    method: entrante.method,
    headers: entrante.headers,
    body: morceaux.length ? Buffer.concat(morceaux) : undefined,
  });

  const debut = Date.now();
  const reponse = await router(requete, env);
  const corps = await reponse.text();

  const chemin = entrante.url.split('?')[0];
  if (!(chemin === '/publier' && reponse.status === 200)) {
    console.log(`  ${new Date().toLocaleTimeString('fr-FR')}  ${entrante.method} ${chemin}`
      + ` -> ${reponse.status} (${Date.now() - debut} ms)`);
  }

  sortante.writeHead(reponse.status, Object.fromEntries(reponse.headers));
  sortante.end(corps);
});

serveur.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\nLe port ${PORT} est déjà pris. Relance avec un autre : node fonction/local.js 8446`);
  process.exit(1);
});

serveur.listen(PORT, () => {
  console.log(`Fonction (locale) sur http://localhost:${PORT}`);
  console.log('Même code qu\'en production, identités réelles.\n');
});
