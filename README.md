# hots-twitch-talents

Extension Twitch qui montre aux viewers, en direct, les talents pris par les
dix joueurs d'une partie de Heroes of the Storm.

Le jeu ne montre au streamer que ses propres talents, et aux viewers rien du
tout. L'extension affiche la grille complète — dix joueurs, sept paliers — au
fur et à mesure des choix, avec les bans du draft, le niveau de chaque équipe,
et le héros et son rôle derrière chaque portrait.

## État actuel

**Soumise à la vérification de Twitch le 19 septembre 2026.** Tout est écrit,
mesuré et en place : le lecteur, les trois surfaces, le service, les deux
langues, les pages légales.

```
Partie à 18m08   bans : Garrosh, Mei, Chromie, Falstad, Ana, Genji

  Équipe 1
   Mal'Ganis      YoneOTP       niv 20   MalGanisVampiricTouch > ...
   Alarak         Playé         niv 20   AlarakOverwhelmingPower > ...
   Li-Ming        MichałDudek   niv 20   WizardAetherWalker > ...
```

La réponse de Twitch est attendue sous 5 à 14 jours ouvrés. Reste ensuite à
distribuer `build/lecteur.exe` par une release GitHub.

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

**Le pseudo se relie au héros par le slot.** `PlayerSetup` donne le slot de
chaque joueur humain ; les battletags du lobby sont dans ce même ordre. Les
apparier par position dans la liste des humains, et non par index brut, corrige
les parties contre l'IA, où les emplacements ne se suivent pas. Vérifié sur
279 parties : aucune régression, et 258 sur 258 justes là où la vérification
était possible.

**L'ARAM marche sans rien de particulier.** 160 parties rejouées, aucun échec :
dix joueurs, dix héros, dix pseudos à chaque fois. Il n'y a simplement pas de
bans à afficher.

**Rien de tout cela ne touche au jeu.** On lit des fichiers que le client écrit
lui-même. Aucune injection, aucune lecture mémoire, donc aucun risque côté
Blizzard, et aucun avantage en jeu : tout ce qui est publié est déjà à l'écran
du streamer, donc déjà sur le stream.

**Le discriminant du battletag ne quitte jamais la machine du streamer.**
« Bnet#123456 » devient « Bnet » dans `live.js`, avant tout envoi : ni le
service, ni Twitch, ni les viewers ne le voient. Les neuf autres joueurs d'une
partie n'ont rien demandé — leur identifiant unique n'a aucune raison d'être
diffusé à une audience, quand le pseudo seul suffit à reconnaître quelqu'un.

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

## Architecture

```
PC du streamer                      Twitch                    Viewer
──────────────                      ──────                    ──────
tracker.events  ->  lecteur  ->  fonction  ->  PubSub  ->  overlay / panneau
   (le jeu)         (son PC)    (Cloudflare)              (chez le viewer)
                    son jeton   le secret
```

**Trois surfaces, un seul code.** La superposition vidéo (`video_overlay.html`)
se déploie au clic par-dessus le lecteur ; le panneau (`panneau.html`) s'affiche
en permanence sous le stream, **y compris hors direct** ; la vue mobile
(`mobile.html`) est ce même panneau à la largeur d'un téléphone. Les trois
partagent `overlay.js` et `overlay.css` ; seul le gabarit change, via
`<body data-mode="panneau">` et `data-plateforme="mobile"`.

Les décisions qui ont tenu :

- **L'état par défaut doit être discret.** Un bouton dans un coin, une
  fermeture évidente. Twitch refuse les extensions qui masquent durablement la
  vidéo. Le bouton est posé haut plutôt qu'en bas : Twitch dessine ses propres
  contrôles par-dessus les extensions, et un bouton à 22 px du bas est visible
  mais **inerte**.
- **Il faut retarder l'affichage.** `Twitch.ext.onContext` donne
  `hlsLatencyBroadcaster` (10-20 s). En overlay le tableau est collé à l'image :
  sans tampon, un talent apparaîtrait avant que le joueur ne le prenne à
  l'écran. Le retard est mesuré depuis l'arrivée du message, pas en comparant
  deux horloges.
- **Les équipes sont nommées par rapport au streamer.** Le lecteur reconnaît
  sa propre équipe en croisant les comptes présents sur le PC avec les
  identifiants du lobby, et le tableau affiche alors « équipe alliée » et
  « équipe adverse » plutôt que deux couleurs arbitraires — c'est ce que le
  viewer a sous les yeux. Vérifié sur 101 parties, 100 accords ; le désaccord
  restant venait d'un lobby tronqué, où l'oracle était la preuve la plus
  faible. Sans reconnaissance, on retombe sur bleue et rouge.
- **Le tableau reste après la partie**, jusqu'à ce que la suivante commence.
  Un viewer qui arrive entre deux parties voit la précédente plutôt qu'un
  écran vide.
- **Deux langues, un seul paquet — des deux côtés.** Dans l'extension, Twitch
  donne la langue du spectateur dans l'adresse de l'iframe
  (`?language=fr&locale=fr-FR`) ; `extension/langue.js` la lit et traduit la
  page avant le premier rendu. Dans le lecteur, il n'y a pas de Twitch pour
  l'annoncer : `textes.js` la déduit des paramètres régionaux
  (`Intl.DateTimeFormat`, les variables `LANG`/`LC_ALL` étant vides sous
  Windows), et `--langue en` la force. Repli sur l'anglais des deux côtés.
  `talents.json` portait déjà les deux langues. Attention au faux ami : le
  `language` de `onContext()` est celui de la **diffusion**, pas du spectateur.

## Fichiers

| Fichier | Rôle |
|---|---|
| `cli.js` | ligne de commande : `talents`, `watch`, `once`, `dump`, `probe`, `autotest` |
| `live.js` | suivi de la partie en cours, et ce que le pont envoie |
| `tracker.js` | décodeur de `replay.tracker.events` : héros, niveaux, talents, bans |
| `battlelobby.js` | trouver, lire et dépouiller le fichier de lobby (les battletags) |
| `affichage.js` | l'écran du lecteur : ce que voit le streamer pendant sa partie |
| `textes.js` | les messages du lecteur, en français et en anglais |
| `pont.js` | tourne sur le PC du streamer : suit la partie et pousse vers la fonction |
| `probe.js` | relever ce que le jeu écrit dans `%TEMP%` pendant une partie |
| `mpq.js` | lecteur d'archive MPQ, pour ouvrir un `.StormReplay` |
| `bzip2.js` | décompression bzip2 en JS pur (Node n'en a pas) |
| `heroes.js` | dictionnaire de noms de héros |
| `serveur-local.js` | sert l'extension et la charge utile, en direct ou en rejeu |
| `extension/video_overlay.html` | la superposition, avec son bouton et sa fermeture |
| `extension/panneau.html` | le panneau permanent, sous le stream |
| `extension/mobile.html` | le même panneau, à la largeur d'un téléphone |
| `extension/config.html` | la page où le streamer récupère son code d'appairage |
| `extension/live_config.html` | l'état du lecteur pendant le direct |
| `extension/overlay.js` | le code commun aux trois surfaces |
| `extension/langue.js` | détection de la langue du viewer et textes de l'interface |
| `extension/talents.json` | la table des talents, dans les deux langues |
| `fonction/` | le service sans état : appairage et diffusion |
| `outils/verifier-langue.js` | refuse une traduction incomplète, des deux côtés |
| `outils/archiver.js` | fabrique `build/extension.zip` pour la console Twitch |
| `outils/construire.js` | fabrique `build/lecteur.exe`, de bout en bout |
| `outils/empaqueter.js` | replie les modules du lecteur en un script unique |
| `outils/generer-talents.js` | reconstruit `extension/talents.json` depuis BUILDS |
| `privacy.html`, `terms.html` | les pages légales, en français et en anglais |
| `fiche-extension.md` | tout ce qui se saisit dans la console Twitch |
| `guide-examen.txt` | le guide remis à l'équipe de vérification |

`mpq.js` et `bzip2.js` ne servent pas en direct : ils donnent accès aux replays
déjà sur le disque, ce qui permet de tester sans lancer le jeu. `bzip2.js` a
été validé contre le `bzip2` du système (multi-blocs, RLE, fichier vide,
binaire aléatoire).

`ebs/` est l'ancienne version du service, un serveur Node à garder allumé.
Remplacée par `fonction/`, elle n'est plus utilisée et peut être supprimée.

## Le décodeur, et comment il a été vérifié

`replay.tracker.events` est au format « versioned struct » : chaque valeur est
précédée d'un octet qui dit son type. Le flux se décode donc entièrement sans
disposer du schéma du jeu — on lit la forme, pas un plan.

Ce qu'on en tire, événement par événement :

| Événement | Ce qu'il donne |
|---|---|
| `PlayerInit` | l'équipe, l'identifiant de compte, et si le joueur est humain |
| `PlayerSpawned` | le héros (`HeroCrusader` pour Johanna) |
| `PlayerSetup` | le slot, qui relie le joueur à son battletag du lobby |
| `LevelUp` | le niveau |
| `TalentChosen` | le talent, par son identifiant interne |
| `HeroBanned` | les bans du draft |
| `EndOfGame*` | la fin de partie |

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

## Le tableau

Pour le voir tourner sans lancer le jeu, en rejouant une vraie partie
accélérée :

```bash
node serveur-local.js --demo "chemin/vers/partie.StormReplay" --vitesse 90
```

Puis ouvrir `https://localhost:8443/` — ou `/panneau.html`, ou `/mobile.html`.
Sans argument, le serveur suit la partie en cours au lieu d'en rejouer une.
`--http` sert sans TLS, pour un simple coup d'oeil.

**Le chrono avance tout seul chez le viewer.** La charge utile porte `t`, la
seconde de jeu, qui changeait à chaque seconde : le dédoublonnage de `pont.js`
ne s'activait donc jamais et le lecteur envoyait au plafond toute la partie,
alors qu'il n'y a que 70 changements de talent en vingt minutes. `pont.js`
compare maintenant tout **sauf** le chrono, et `overlay.js` fait avancer
l'horloge entre deux messages, en se recalant à chaque rappel. Mesuré sur douze
parties, 175 minutes de jeu :

| | avant | après |
|---|---|---|
| envois par minute de partie | 25,6 | **8,9** |
| envois par partie | 375 | **130** |

Soit ~60 diffuseurs actifs sur le palier gratuit de Cloudflare
(100 000 requêtes/jour) au lieu de ~20. Les viewers ne coûtent rien : ils
reçoivent le PubSub de Twitch, qui ne touche pas le service.

**La charge utile est compacte** (identifiants bruts, ~2,7 Ko au pire pour dix
joueurs) parce que le PubSub de Twitch plafonne à 5 Ko par message. C'est le
tableau qui traduit, avec `extension/talents.json`.

**Les images viennent de EOWEA BUILDS** (`eowea.github.io/builds`), pas d'une
copie : une seule source de vérité, et elles suivent les mises à jour du site.
Ce domaine est déclaré dans la liste blanche d'images de la console Twitch.

**Le panneau se déduit de sa largeur.** Twitch lui impose 318 px sur un
navigateur de bureau, en donne 360 à 430 sur mobile, et davantage encore
ailleurs. Les dimensions sont donc calculées en `clamp()` à partir de la
largeur disponible, au lieu d'être calées au pixel : à 318 px on retombe
exactement sur les 24 px d'icône d'avant, à 390 px elles passent à 33. Au-delà
de 720 px, les deux équipes se remettent côte à côte.

### L'appariement d'un talent tient au palier

Le tracker écrit `<Héros><NomInterne><Capacité>`, et ce nom interne a dérivé de
celui qu'on affiche : `Indestructable` pour Indestructible, `NanaBoost` pour
Nano Boost, `ArchlichArmor` pour Armor of the Archlich. Chercher le nom affiché
dans l'identifiant, sans autre contrainte, produisait deux défauts, mesurés sur
18 159 talents de 300 parties :

| | avant | après |
|---|---|---|
| case **fausse** | 1,57 % | **0 %** |
| case **vide** | 1,46 % | **0,02 %** |

Les cases fausses venaient toutes du palier 20 : l'identifiant d'une
amélioration d'héroïque cite le nom de l'héroïque, donc le tableau affichait le
talent du palier 10. Comme les talents arrivent dans l'ordre des paliers,
l'indice de la case donne le sien — on ne compare donc qu'aux trois ou quatre
candidats du bon palier, ce qui supprime l'erreur et rend un appariement
tolérant sans danger. Il n'est retenu que s'il devance nettement le suivant :
une icône fausse est pire qu'une case vide.

Deux autres corrections au passage : `aplatir()` replie les accents en NFD au
lieu de les supprimer (« Rejuvenescência »), et **le nom propre d'un héros
l'emporte sur l'alias d'un autre** — `gall` est l'identifiant de Gall et aussi
un alias de Cho'Gall, si bien que les talents de Gall étaient cherchés, et
trouvés à tort, dans l'arbre de Cho.

Ce qui reste s'affiche en case vide, l'identifiant brut restant lisible dans
l'infobulle.

La table `extension/talents.json` est un instantané de BUILDS. À régénérer
après une mise à jour du site :

```bash
node outils/generer-talents.js
```

## La vue mobile

`extension/mobile.html` est la même page que le panneau, servie par Twitch dans
son application. Le nom du fichier est imposé par la console.

Ce qui change, c'est le doigt. **Un appui n'est pas un survol** : un appui sur
une icône ouvre l'infobulle, un deuxième la referme, un appui ailleurs aussi.
Le piège est le `mouseover` que le navigateur fabrique après le doigt — il
rouvrait l'infobulle que l'appui venait de fermer ; le chemin souris se coupe
donc dès le premier `pointerdown` tactile. Le double appui ne zoome pas sur les
icônes, pour ne pas manger l'appui suivant, mais le zoom à deux doigts reste
actif partout : le couper aurait été un défaut d'accessibilité.

Twitch soumet les vues mobiles à la **section 4.7** des consignes d'Apple,
celle des mini-applications hébergées dans une application hôte. Rien n'est
vendu, aucun don, aucun jeu d'argent, aucune API native étendue, aucune saisie
du spectateur donc aucun contenu tiers à modérer, et aucune donnée du
spectateur : ni compte, ni cookie, ni stockage local, ni mesure d'audience.

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

**Les chaînes sont étanches.** Le code ne s'obtient qu'en prouvant à Twitch
qu'on est le diffuseur de cette chaîne-là ; à la publication, la fonction
revérifie que le jeton correspond au canal annoncé, puis diffuse avec
`broadcaster_id: <cette chaîne>` et `is_global_broadcast: false`. Un jeton de
la chaîne A ne peut rien publier sur la chaîne B.

Elle est écrite en interfaces web (Request, Response, WebCrypto), présentes
aussi bien chez Cloudflare que dans Node. Une seule implémentation, éprouvée
localement, déployée telle quelle.

```bash
node fonction/test.js          # 16 contrôles, sans Cloudflare ni Twitch
node fonction/local.js         # la même fonction, avec tes vraies identités
cd fonction && wrangler deploy # en production
```

## L'exécutable

Le streamer ne doit rien installer. Un fichier, qu'il double-clique.

```bash
node outils/construire.js       # vérifie les deux langues, puis fabrique
node outils/verifier-langue.js  # les deux contrôles, seuls
node outils/archiver.js         # l'archive de l'extension, pour la console
```

Une clé de traduction oubliée ne se voit ni à la compilation ni au chargement,
seulement à l'écran d'un inconnu, la version déjà distribuée.
`outils/verifier-langue.js` compare les deux tables, leurs marqueurs `{n}`, les
clés citées par le balisage et par le code, et la détection de langue. Il est
appelé par `archiver.js` pour l'extension et par `construire.js` pour le
lecteur : ni l'archive ni l'exécutable ne se fabriquent s'il signale quelque
chose.

Quatre étapes automatisées : replier les modules du lecteur en un script unique
(79 Ko), en faire un blob, copier le binaire de Node, y injecter le blob. Le
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

Le lecteur lui parle dans sa langue, déduite de ses paramètres régionaux —
anglais par défaut pour tout ce qui n'est ni français ni anglais. C'est le
premier écran d'un inconnu qui vient de télécharger un exécutable non signé :
il n'a pas à déchiffrer du français en plus. `lecteur.exe --langue en` force le
choix, `--detail` montre le journal technique.

Deux choses à savoir avant de distribuer :

- **Windows affichera un avertissement au premier lancement.** L'exécutable
  n'est pas signé — c'est le lot de tout logiciel distribué sans certificat,
  qui coûte quelques centaines d'euros par an.
- **Les 88 Mo sont le binaire de Node**, pas notre code : le lecteur lui-même
  fait 79 Ko. C'est le prix d'un exécutable autonome.

### Distribuer le lecteur à d'autres streamers

**N'envoyer que `lecteur.exe`.** Le jeton d'appairage n'est pas dans le binaire
— il est lu dans un `pont.config.json` posé à côté, écrit au premier démarrage.
Mais `build/` contient ce fichier pour le poste de développement : zipper le
dossier entier ferait publier les parties des autres sur **ta** chaîne.

Chacun installe l'extension sur sa chaîne, ouvre sa configuration, colle son
propre code. Rien n'est partagé entre chaînes, sauf le quota Cloudflare —
100 000 requêtes par jour pour tout le monde, remis à zéro à minuit UTC.

## Ce qui reste

- **La vérification de Twitch**, puis la mise en ligne publique.
- **Distribuer `lecteur.exe`** par une release GitHub, une fois l'extension
  approuvée.
- **Une police embarquée.** Twitch bloque les polices externes ; l'extension
  utilise la pile système. Embarquer Rajdhani (licence libre) dans l'archive
  serait plus fidèle à l'habillage de BUILDS.
- **Vérifier ce que désigne l'équipe de `HeroBanned`** : celle qui bannit, ou
  celle qui est visée. L'ordre observé est constamment 1-2-1-2-2-1, mais la
  forme est symétrique et ne tranche pas. Correction d'un caractère si besoin.
- **Supprimer `ebs/`**, remplacé par `fonction/`.
