# hots-twitch-talents

Extension Twitch qui montre aux viewers, en direct, les talents pris par les
dix joueurs d'une partie de Heroes of the Storm.

Le viewer ouvre un panneau sous le stream et voit un tableau : dix lignes, sept
colonnes de talents, mis à jour au fil de la partie.

## État actuel

Le **lecteur de jeu** est écrit et vérifié. Le décodeur de talents reste à
faire, mais l'essentiel est acquis : on sait où sont les données, et qu'elles
sont récupérables automatiquement.

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

Surveiller les parties et afficher les joueurs (à lancer **avant** de jouer) :

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
tracker.events  ->  lecteur  ->  EBS  ->  PubSub  ->  panneau (tableau)
   (le jeu)         (Node)      (HTTPS)               318 x 500 px
```

Deux points déjà tranchés :

- **Le panneau suffit.** 318 px de large, c'est ~90 px de pseudo + 7 icônes de
  28 px. Dix lignes de 40 px tiennent dans les 500 px de haut. Pas besoin
  d'overlay vidéo.
- **Il faudra retarder l'affichage.** `Twitch.ext.onContext` donne
  `hlsLatencyBroadcaster` (10-20 s) : sans tampon, les viewers verraient les
  talents avant l'image du stream.

## Fichiers

| Fichier | Rôle |
|---|---|
| `cli.js` | ligne de commande : `watch`, `once`, `dump`, `probe`, `autotest` |
| `battlelobby.js` | trouver, lire et dépouiller le fichier de lobby |
| `probe.js` | relever ce que le jeu écrit dans `%TEMP%` pendant une partie |
| `mpq.js` | lecteur d'archive MPQ, pour ouvrir un `.StormReplay` |
| `bzip2.js` | décompression bzip2 en JS pur (Node n'en a pas) |
| `heroes.js` | dictionnaire de noms de héros |

`mpq.js` et `bzip2.js` ne servent pas en direct : ils donnent accès aux replays
déjà sur le disque, ce qui permet de tester sans lancer le jeu. `bzip2.js` a
été validé contre le `bzip2` du système (multi-blocs, RLE, fichier vide,
binaire aléatoire).

## Prochaine étape

Le décodeur de `replay.tracker.events`. Le format s'auto-décrit — chaque valeur
porte son type — donc il se décode sans disposer du schéma du jeu. Deux
difficultés à traiter :

1. Le fichier est lu **pendant** son écriture : le dernier événement est
   souvent tronqué en plein milieu. Il faut s'arrêter proprement et reprendre
   au bon endroit au relevé suivant.
2. Les noms de talents sont des identifiants internes, à relier aux icônes et
   aux libellés de EOWEA BUILDS.

Le dossier `captures/` (hors git) contient 20 copies horodatées d'un
`tracker.events` en cours d'écriture, de 12 à 104 Ko, totalisant 20
`TalentChosen` — de quoi mettre au point le décodeur, cas tronqué compris.
