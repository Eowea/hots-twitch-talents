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

Reste la partie Twitch : le serveur (EBS) et le panneau.

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
tracker.events  ->  lecteur  ->  EBS  ->  PubSub  ->  overlay vidéo
   (le jeu)         (Node)      (HTTPS)               (sur le lecteur)
```

Trois points déjà tranchés :

- **Extension de type video overlay**, pas panel. Le tableau se déploie sur le
  lecteur au clic, et non sous le stream. On garde ainsi la main sur la taille
  et sur l'ouverture, là où une extension « component » impose son cadre.
- **L'état par défaut doit être discret** : un bouton dans un coin, une
  fermeture évidente. Twitch refuse les extensions qui masquent durablement la
  vidéo.
- **Il faut retarder l'affichage.** `Twitch.ext.onContext` donne
  `hlsLatencyBroadcaster` (10-20 s). En overlay le tableau est collé à l'image :
  sans tampon, un talent apparaîtrait avant que le joueur ne le prenne à
  l'écran.

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

## Prochaine étape

La partie Twitch. `live.js` produit déjà le tableau à jour : il reste à le
pousser vers les viewers.

1. **EBS** — un petit serveur HTTPS qui signe le jeton et relaie vers
   `POST /helix/extensions/pubsub`. Il faut aussi un point d'entrée « état
   courant » : le PubSub ne rejoue pas l'historique, donc un viewer qui ouvre
   le panneau en milieu de partie ne verrait rien.
2. **Overlay** — le tableau 10 × 7 déployé sur le lecteur, avec les icônes et
   les libellés de talents de EOWEA BUILDS, à relier aux identifiants internes
   (`WizardAetherWalker`).
3. **Tampon de retard** — `hlsLatencyBroadcaster` donne les 10-20 s de décalage
   du flux ; sans ça les viewers voient les talents avant l'image.
