# hots-twitch-talents

Extension Twitch qui montre aux viewers, en direct, les talents pris par les
dix joueurs d'une partie de Heroes of the Storm.

Le viewer clique un bouton discret posé sur le lecteur, et un tableau se
déploie **par-dessus le stream** : les dix joueurs, sept colonnes de talents,
mis à jour au fil de la partie.

## État actuel

Le **lecteur de jeu est terminé**. Il suit une partie en direct et produit le
tableau complet : les dix joueurs avec leur pseudo, leur héros, leur niveau,
leurs talents dans l'ordre, et les bans du draft.

```
Partie à 18m08   bans : Garrosh, Mei, Chromie, Falstad, Ana, Genji

  Équipe 1
   Mal'Ganis      YoneOTP#2494       niv 20   MalGanisVampiricTouch > ...
   Alarak         Playé#2155         niv 20   AlarakOverwhelmingPower > ...
   Li-Ming        MichałDudek#2924   niv 20   WizardAetherWalker > ...
```

L'**overlay et l'EBS sont écrits**. La chaîne complète fonctionne, du fichier
que le jeu écrit jusqu'au tableau du viewer. Il reste à la brancher sur une
vraie extension Twitch : identifiants, hébergement, validation.

## Ce qui a été établi

Tout est mesuré, pas supposé.

**Le jeu publie les talents en direct.** Pendant une partie, le client écrit
`%TEMP%\Heroes of the Storm\TempWriteReplayP1\replay.tracker.events` **en clair
et au fil de l'eau** — relevé sur une partie complète : 30 écritures, de 12 Ko
à 116 Ko. Le fichier contient les événements `TalentChosen`, `Tier1Talent` à
`Tier7Talent`, `LevelUp`, `PlayerID`, et les héros (`HeroLucio`, `HeroCrusader`
pour Johanna — le jeu nomme les héros par leur personnage d'origine).

C'est la découverte qui rend l'extension possible : **les dix joueurs, sans
rien lire à l'écran, sans rien presser pendant la partie.**

**Les joueurs viennent du battlelobby.** `replay.server.battlelobby`, écrit une
seule fois au chargement de la carte, donne les dix battletags dans l'ordre des
slots. Chaque chaîne est précédée de sa longueur en octets :

```
0d 54 72 75 65 50 79 72 6f 23 31 39 30 33
^^ 13    T  r  u  e  P  y  r  o  #  1  9  0  3
```

Vérifié sur 250 parties tirées au hasard : **2475 battletags, 2475 préfixes
justes**. Les écarts au chiffre de 10 s'expliquent tous (parties contre l'IA,
parties avec observateurs).

**Le héros n'est pas dans le battlelobby.** Vérifié sur 75 parties, ARAM et
cartes classiques : sur 174 noms de héros connus par ailleurs, 12
« correspondances », toutes des collisions fortuites. Normal, vu le moment de
l'écriture : avant le draft, et avant le tirage ARAM. Les chaînes `HeroLcns`,
`HeroPORT`, `HeroICON` qu'on y trouve sont la collection du joueur.

**Rien de tout cela ne touche au jeu.** On lit des fichiers que le client écrit
lui-même. Aucune injection, aucune lecture mémoire, donc aucun risque côté
Blizzard.

**Le discriminant du battletag ne quitte jamais la machine du streamer.**
« Eowea#21654 » devient « Eowea » dans `live.js`, avant tout envoi : ni l'EBS,
ni Twitch, ni les viewers ne le voient. Les neuf autres joueurs d'une partie
n'ont rien demandé — leur identifiant unique n'a aucune raison d'être diffusé à
une audience, quand le pseudo seul suffit à reconnaître quelqu'un.

## Utilisation

Aucune dépendance, aucun `npm install`. Node 18+ suffit.

Suivre la partie en cours et voir le tableau se remplir (à lancer **avant**
de jouer) :

```bash
node cli.js talents
```

Revoir une partie déjà jouée :

```bash
node cli.js talents --file "chemin/vers/partie.StormReplay"
```

Surveiller les lobbies seuls, sans les talents :

```bash
node cli.js
```

Vérifier le lecteur sur les parties déjà enregistrées sur le disque :

```bash
node cli.js autotest 250
```

Relever tout ce que le jeu écrit pendant une partie :

```bash
node cli.js probe
```

Lire un fichier précis — un battlelobby brut, ou directement un replay :

```bash
node cli.js once --file "chemin/vers/partie.StormReplay"
```

## Architecture visée

```
PC du streamer                      Twitch                    Viewer
──────────────                      ──────                    ──────
tracker.events  ->  lecteur  ->  fonction  ->  PubSub  ->  overlay / panneau
   (le jeu)         (son PC)    (Cloudflare)              (chez le viewer)
                    son jeton   le secret
```

Cinq points déjà tranchés :

- **Deux surfaces, un seul code.** La superposition vidéo
  (`video_overlay.html`) se déploie au clic par-dessus le lecteur ; le panneau
  (`panneau.html`) s'affiche en permanence sous le stream, **y compris hors
  direct**, ce qui en fait le seul des deux qu'on puisse essayer sans diffuser.
  Les deux partagent `overlay.js` et `overlay.css` ; seul le gabarit change,
  via `<body data-mode="panneau">`.
- **Disposition côte à côte** : les deux équipes en deux colonnes, une par
  moitié de largeur. Le panneau ne prend que la moitié de la hauteur de
  l'image, au prix d'icônes plus petites. Maquette :
  https://claude.ai/artifact/1oL7VMMQHpPWaxnqycVrPd
- **L'état par défaut doit être discret** : un bouton dans un coin, une
  fermeture évidente. Twitch refuse les extensions qui masquent durablement la
  vidéo.
- **Il faut retarder l'affichage.** `Twitch.ext.onContext` donne
  `hlsLatencyBroadcaster` (10-20 s). En overlay le tableau est collé à l'image :
  sans tampon, un talent apparaîtrait avant que le joueur ne le prenne à
  l'écran.
- **Une seule extension, deux langues.** Twitch donne la langue du spectateur
  dans l'adresse de l'iframe (`?language=fr&locale=fr-FR`) ; `langue.js` la lit
  et traduit la page avant le premier rendu, avec repli sur l'anglais pour
  toute autre langue. `talents.json` portait déjà les deux langues. Attention
  au faux ami : le `language` de `onContext()` est celui de la **diffusion**,
  pas du spectateur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `cli.js` | ligne de commande : `talents`, `watch`, `once`, `dump`, `probe`, `autotest` |
| `live.js` | suivi de la partie en cours : c'est ici que le pont Twitch se branchera |
| `tracker.js` | décodeur de `replay.tracker.events` : héros, niveaux, talents, bans |
| `battlelobby.js` | trouver, lire et dépouiller le fichier de lobby (les battletags) |
| `probe.js` | relever ce que le jeu écrit dans `%TEMP%` pendant une partie |
| `mpq.js` | lecteur d'archive MPQ, pour ouvrir un `.StormReplay` |
| `bzip2.js` | décompression bzip2 en JS pur (Node n'en a pas) |
| `heroes.js` | dictionnaire de noms de héros |
| `serveur-local.js` | sert l'overlay et la charge utile, en direct ou en rejeu |
| `extension/` | l'extension Twitch : overlay, panneau, habillage, table des talents |
| `extension/langue.js` | détection de la langue du viewer et textes de l'interface |
| `outils/verifier-langue.js` | refuse une traduction incomplète avant l'archive |
| `outils/generer-talents.js` | reconstruit `extension/talents.json` depuis BUILDS |
| `outils/construire.js` | fabrique `build/lecteur.exe`, de bout en bout |
| `outils/empaqueter.js` | replie les modules du lecteur en un script unique |
| `fonction/` | le service sans état : appairage et diffusion |
| `ebs/serveur.js` | l'EBS : appairage, diffusion PubSub, état courant, statut |
| `ebs/jwt.js` | signature et vérification HS256, avec le seul module crypto |
| `ebs/test.js` | le parcours complet de l'EBS, sans Twitch |
| `pont.js` | tourne sur ton PC : suit la partie et pousse vers l'EBS |

`mpq.js` et `bzip2.js` ne servent pas en direct : ils donnent accès aux replays
déjà sur le disque, ce qui permet de tester sans lancer le jeu. `bzip2.js` a
été validé contre le `bzip2` du système (multi-blocs, RLE, fichier vide,
binaire aléatoire).

## Le décodeur, et comment il a été vérifié

`replay.tracker.events` est au format « versioned struct » : chaque valeur est
précédée d'un octet qui dit son type. Le flux se décode donc entièrement sans
disposer du schéma du jeu — on lit la forme, pas un plan.

Ce qu'on en tire, événement par événement :

| Événement | Ce qu'il donne |
|---|---|
| `PlayerInit` | l'équipe, et si le joueur est humain ou IA |
| `PlayerSpawned` | le héros (`HeroCrusader` pour Johanna) |
| `LevelUp` | le niveau |
| `TalentChosen` | le talent, par son identifiant interne |
| id 13 / 14 / 15 | bans, picks et échanges du draft |
| PlayerSetup (id 9) | le slot, qui relie le joueur à son battletag du lobby |

**Le cas difficile est la lecture pendant l'écriture.** Le jeu écrit par blocs
de 4 Ko : le dernier événement est presque toujours coupé en plein milieu.
`TrackerStream` revient alors à la dernière frontière saine et reprend là au
relevé suivant.

Vérifications :

- **299 / 299** flux décodés intégralement sur un échantillon de 300 replays
  étalé sur tout le stock, **18 686 talents** relevés, aucun héros inconnu.
- Les 20 copies d'un `tracker.events` en cours d'écriture (dossier `captures/`,
  hors git) rejouées une à une à travers un seul flux : chacune avec une queue
  tronquée de 1 à 59 octets, et le résultat final **identique** à celui d'une
  lecture unique du fichier complet.

## L'overlay

`extension/video_overlay.html` est l'extension telle que les viewers la
verront. Pour la voir tourner sans lancer le jeu, en rejouant une vraie partie
accélérée :

```bash
node serveur-local.js --demo "chemin/vers/partie.StormReplay" --vitesse 90
```

Puis ouvrir `https://localhost:8080/`. Sans argument, le serveur suit la partie
en cours au lieu d'en rejouer une. `--http` sert sans TLS, pour un simple coup
d'oeil.

Trois choix de conception :

- **La charge utile est compacte** (identifiants bruts, ~2,3 Ko pour dix
  joueurs) parce que le PubSub de Twitch plafonne à 5 Ko par message. C'est
  l'overlay qui traduit, avec `extension/talents.json`.
- **Les images viennent de EOWEA BUILDS** (`eowea.github.io/builds`), pas d'une
  copie : une seule source de vérité, et elles suivent tes mises à jour. Il
  faudra déclarer ce domaine dans la liste blanche d'images de la console
  Twitch.
- **Le tableau est dessiné à taille fixe puis mis à l'échelle** du lecteur, en
  largeur et en hauteur. Sous 62 % il ne montre plus qu'une équipe, avec une
  bascule : à cette taille, les icônes des deux équipes deviennent illisibles.

La table `extension/talents.json` est un instantané de BUILDS. À régénérer
après une mise à jour du site :

```bash
node outils/generer-talents.js
```

## La fonction

Le service qui relie les PC des streamers aux viewers. Deux points d'entrée,
et **aucun stockage** :

| Entrée | Qui appelle | Ce qui se passe |
|---|---|---|
| `GET /appairage` | la page de configuration | le diffuseur, authentifié par Twitch, obtient son code |
| `POST /publier` | le lecteur d'un streamer | on vérifie son jeton, on signe, on diffuse |

**Le secret de l'extension ne vit que là.** Un PC de streamer ne connaît que
son propre jeton, qui ne vaut que pour sa chaîne. C'est la raison d'être de ce
service : distribuer le secret dans un exécutable le rendrait extractible, et
n'importe qui pourrait alors diffuser sur la chaîne de n'importe qui.

**Les jetons d'appairage sont dérivés, pas stockés** :

```
jeton = HMAC(secret, "appairage:" + identifiant_de_chaîne)
```

Recalculé à chaque appel des deux côtés. La fonction n'a donc ni fichier, ni
base de données : elle peut démarrer, mourir et renaître ailleurs sans rien
perdre. Contrepartie assumée : on ne révoque pas un jeton isolément sans
changer le secret — cas rare, qui ne doit pas imposer une base de données au
cas courant.

Elle est écrite en interfaces web (Request, Response, WebCrypto), présentes
aussi bien chez Cloudflare que dans Node. Une seule implémentation, éprouvée
localement, déployée telle quelle.

```bash
node fonction/test.js          # 16 contrôles, sans Cloudflare ni Twitch
node fonction/local.js         # la même fonction, avec tes vraies identités
cd fonction && wrangler deploy # en production
```

L'appel réel à l'API de Twitch a été vérifié depuis le lanceur local : la
signature WebCrypto est acceptée, la diffusion passe.

`ebs/` est l'ancienne version, un service Node à garder allumé. Elle est
remplacée par `fonction/` et peut être supprimée.

```bash
EXT_CLIENT_ID=... EXT_SECRET=... EXT_PROPRIETAIRE=... node ebs/serveur.js
node pont.js                      # sur ton PC, pendant que tu joues
node ebs/test.js                  # le parcours complet, sans Twitch
```

**Les secrets ne sont jamais dans le dépôt.** L'EBS lit le secret de
l'extension dans son environnement ; ton PC ne le voit pas. Il s'authentifie
avec un **jeton d'appairage** propre à ta chaîne, que `config.html` te montre
et que tu peux révoquer. `ebs/appairages.json` et `pont.config.json` sont
ignorés par git.

Le **retard** est traité aux deux bouts. En direct, l'overlay diffère chaque
message de `hlsLatencyBroadcaster` secondes, mesurées depuis son arrivée pour
ne pas dépendre de deux horloges. À l'ouverture du tableau en pleine partie,
l'overlay demande à l'EBS l'état **tel qu'il était** il y a ce même délai :
l'EBS garde pour cela les 40 derniers états, soit environ 80 secondes de recul.
Sans ça, un viewer verrait des talents que son image ne montre pas encore.

`ebs/test.js` déroule le parcours complet avec des jetons forgés : appairage
refusé à un viewer, publication refusée sans le bon jeton, état retardé,
signature falsifiée rejetée, code d'appairage vérifié. Seize contrôles,
tous au vert.

## Reprendre après une pause

Trois choses doivent tourner en même temps, chacune dans son terminal :

```bash
node ebs/serveur.js --http                         # 1. l'EBS
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8444
node pont.js --dernier --vitesse 5                 # 3. une partie, ou sans --dernier pour la vraie
```

**Le piège** : une adresse de tunnel rapide change à chaque démarrage de
cloudflared. Quand elle change, il faut la reporter à trois endroits, sinon
le panneau reste vide :

1. `extension/reglages.js`, puis commiter et pousser (GitHub Pages sert
   l'extension) ;
2. la liste blanche des requêtes, dans la console développeur Twitch ;
3. `pont.config.json`, sur ton PC.

Une adresse fixe — un vrai hébergement pour l'EBS — supprime les trois.

Pour diagnostiquer, l'EBS journalise chaque appel qu'il reçoit. Un panneau qui
se charge correctement produit deux lignes :

```
  00:50:04  OPTIONS /etat -> 204     le contrôle CORS du navigateur
  00:50:04  GET     /etat -> 200     le panneau reçoit les données
```

Aucune ligne signifie que la page ne s'exécute pas — le plus souvent un chemin
de fichier erroné dans la console Twitch, qui renvoie une page 404 invisible
dans une iframe.

## L'exécutable

Le streamer ne doit rien installer. Un fichier, qu'il double-clique.

```bash
node outils/construire.js
```

Quatre étapes automatisées : replier les sept modules du lecteur en un script
unique, en faire un blob, copier le binaire de Node, y injecter le blob. Le
résultat est `build/lecteur.exe`, **88 Mo, à distribuer tel quel**.

`outils/empaqueter.js` est un assembleur de quarante lignes, écrit ici plutôt
qu'emprunté : le projet n'a aucune dépendance, et ce n'était pas la peine d'en
introduire une pour résoudre des `require` relatifs. Seule l'injection finale
utilise un outil extérieur, récupéré à la volée par npx — un outil d'atelier,
qui ne part pas dans le produit.

Ce que vit le streamer :

1. il installe l'extension sur sa chaîne ;
2. il ouvre la configuration, un code s'affiche ;
3. il lance `lecteur.exe`, colle le code. Une fois.
4. il joue.

La configuration se range **à côté de l'exécutable**, pas dans un dossier
caché : il peut la voir, la sauvegarder, ou la supprimer pour se réappairer.

Deux choses à savoir avant de distribuer :

- **Windows affichera un avertissement au premier lancement.** L'exécutable
  n'est pas signé — c'est le lot de tout logiciel distribué sans certificat,
  qui coûte quelques centaines d'euros par an.
- **Les 88 Mo sont le binaire de Node**, pas notre code : le lecteur lui-même
  fait 58 Ko. C'est le prix d'un exécutable autonome.

## Prochaine étape

Brancher sur la vraie extension.

1. **Identifiants** — créer l'extension dans la console Twitch, en type *Vidéo
   - Plein écran*, et passer `EXT_CLIENT_ID`, `EXT_SECRET` et
   `EXT_PROPRIETAIRE` à l'EBS.
2. **Listes blanches** — déclarer `eowea.github.io` côté images et le domaine
   de l'EBS côté requêtes, sinon la politique de contenu de Twitch les bloque.
3. **Hébergement** — l'EBS doit être joignable en HTTPS depuis l'extérieur.
4. **Police** — Twitch bloque les polices externes. Embarquer Rajdhani (licence
   libre) dans l'archive remplacerait la pile système actuelle.

Le panneau tient dans les 318 px imposés par Twitch : portrait 18, nom 72,
niveau 16, sept icônes de 24, plus les espaces — 298 px exactement. Chaque
pixel donné au nom est pris aux icônes, c'est tout l'arbitrage de cette
largeur.
