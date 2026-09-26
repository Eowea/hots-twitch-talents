# Fiche de l'extension — à recopier dans la console Twitch

Tout ce qu'il faut saisir dans **Extension Version Details**, en français et en
anglais. Twitch affiche un compteur sous chaque champ : si l'un déborde, coupe
par la fin, les textes sont écrits pour rester lisibles tronqués.

> Rappel de séquence : en Test hébergé, modifier les détails de version impose
> de **repasser en Test local**. Saisis donc tout d'un bloc, puis remonte.

---

## 1. Identité

| Champ | Valeur |
|---|---|
| **Extension Name** | `HotS Talents` |
| **Author Name** | `Eowea` |
| **Author Email** | `eowea.contact@gmail.com` |
| **Support Email** | `eowea.contact@gmail.com` |
| **Category** | Utilities *(à défaut : Tools)* |
| **Privacy Policy URL** | `https://eowea.github.io/hots-twitch-talents/privacy.html` |
| **Terms of Service URL** | `https://eowea.github.io/hots-twitch-talents/terms.html` |

**Sur le nom.** J'ai évité « Heroes of the Storm » dans le titre : c'est une
marque de Blizzard, et Twitch refuse les fiches qui laissent croire à un lien
officiel. `HotS Talents` dit la même chose sans l'ambiguïté. Le nom complet du
jeu apparaît dans le résumé et la description, où il est descriptif et non
plus identifiant.

---

## 2. Summary — la ligne qu'on lit en premier

**Anglais**

```
See every talent all ten players pick, live, while you watch the match.
```

**Français**

```
Vois en direct les talents choisis par les dix joueurs, pendant la partie.
```

---

## 3. Description

**Anglais**

```
HotS Talents shows the talent build of all ten players in a Heroes of the
Storm match, updated live as they pick.

Viewers see, for each player: their hero, their team level, and the seven
talents taken so far. Hovering a talent shows its name and what it does.
Banned heroes and the match clock sit in the header. The broadcaster's team is
always on the left, in blue, exactly as the game shows it to them.

It runs from a small reader the broadcaster starts on their own PC, which
reads the tracking file the game writes during a match. It does not modify or
inject into the game and gives no in-game advantage: it only lays out what the
stream already shows.

Free, no ads, no cookies, no viewer identity read. The relay service keeps
nothing — no database, no history. Source code is public.

English and French, following the viewer's own Twitch language.
```

**Français**

```
HotS Talents affiche la construction des dix joueurs d'une partie de Heroes of
the Storm, mise à jour en direct à mesure qu'ils choisissent.

Le spectateur voit, pour chaque joueur : son héros, le niveau d'équipe et les
sept talents pris jusque-là. Survoler un talent affiche son nom et son effet.
Les bans et le chrono tiennent dans l'en-tête. L'équipe du diffuseur est
toujours à gauche, en bleu, comme le jeu la lui montre.

Le tout vient d'un lecteur que le diffuseur lance sur son PC, qui lit le
fichier de suivi écrit par le jeu pendant la partie. Il ne modifie pas le jeu,
ne s'y injecte pas et ne donne aucun avantage : il met en forme ce que la
diffusion montre déjà.

Gratuit, sans publicité, sans cookie, sans lecture de l'identité des
spectateurs. Le service de relais ne conserve rien — ni base, ni historique.
Code source public.

Français et anglais, selon la langue du spectateur.
```

---

Les deux descriptions font moins de 900 caractères. La limite exacte de Twitch
n'est pas publiée dans sa documentation ; celle qu'on rencontre est de 1 024,
et ces textes passent largement en dessous.

---

## 4. Mots-clés de recherche

```
heroes of the storm, hots, talents, build, moba, esports, overlay, panel
```

---

## 5. Domaines à déclarer

| Champ | Valeur |
|---|---|
| **URL Fetching Domains** | `hots-talents.eowea.workers.dev` |
| **Image Domains** | `eowea.github.io` |

Rien d'autre. L'extension ne charge aucune police externe et n'appelle aucun
autre service.

`eowea.github.io` reste déclaré **côté images** : c'est de là que viennent les
portraits et les icônes de talents. Ce n'est pas un lien sortant, et la règle
4.5 ne le vise pas. En revanche la **liste blanche des URL du panneau doit être
vide** : il n'y a plus rien à ouvrir.

---

## 6. La vue mobile — `mobile.html`

La console ouvre un champ à part pour le téléphone, dans **Asset Hosting**. Le
nom du fichier n'est pas au choix :

| Champ | Valeur |
|---|---|
| **Mobile Viewer Path** | `mobile.html` |

C'est la même page que le panneau, à la largeur d'un téléphone. Elle est déjà
dans l'archive.

### La note d'Apple

En cochant le mobile, Twitch affiche un avertissement : une extension mobile
doit respecter la **section 4.7** des consignes d'examen d'Apple, celle des
mini-applications hébergées dans une application hôte. Twitch la répercute
parce que c'est son application à lui qui serait refusée.

Rien à changer chez nous — mais autant savoir pourquoi, si la question vient :

| Ce que 4.7 exige | Chez nous |
|---|---|
| Rien de payant hors achat intégré | Rien n'est vendu, ni dans l'extension ni sur le site lié |
| Ni jeu d'argent, ni loterie, ni don | Aucun |
| Ne pas étendre ni exposer d'API native | La page ne fait qu'afficher un tableau reçu du même service que le panneau |
| Contenu tiers modérable : signalement, blocage, filtre | Le spectateur ne saisit rien — il n'y a pas de contenu tiers |
| Consentement avant tout partage de données | Aucune donnée du spectateur : ni compte, ni cookie, ni stockage local, ni mesure d'audience |
| Classification d'âge adaptée | Tout public : des portraits de héros, des icônes de talents, des pseudos |

Le seul point qui mérite une phrase, ce sont les **pseudos**. Ce sont les noms
Battle.net des dix joueurs de la partie, déjà affichés par le jeu sur le
direct, et amputés de leur discriminant — `Bnet#123456` devient `Bnet`.
L'extension ne les collecte pas et ne les garde pas : elle les montre le temps
de la partie, comme le jeu.

### Ce qui change au doigt

Un appui n'est pas un survol. Sur la vue mobile, un appui sur une icône ouvre
l'infobulle, un deuxième la referme, un appui ailleurs aussi. Le double appui
ne zoome pas sur les icônes, pour ne pas manger l'appui suivant — mais le zoom
à deux doigts reste actif partout, le désactiver aurait été un défaut
d'accessibilité qu'Apple relève.

---

## 7. Les images — onglet **Version Details**

**C'est ce qui a fait refuser la version 0.0.1** (règle 4.1). Les trois champs
sont sur la même page, dans la section *Image Assets*, et les trois sont
obligatoires pour passer en revue.

| Champ dans la console | Spec imposée | Fichier prêt |
|---|---|---|
| **Logo Image** | 100×100 PNG | `visuels/logo-100x100.png` |
| **Discovery Image** | 300×200 PNG, sans transparence | `visuels/discovery-300x200.png` |
| **Screenshot Image** | **ratio 4:3**, minimum 1024×768, < 10 Mo | `visuels/screenshot-2048x1536-en.png` |

**Le 4:3 n'est pas négociable.** La doc l'écrit noir sur blanc : « Images must
have a 4:3 aspect ratio ». Une capture 16:9, le réflexe naturel, est refusée.
La nôtre fait 2048×1536, soit le double du minimum.

Un quatrième champ existe, **Taskbar Icon Image**, 24×24 PNG — mais il ne
concerne que les extensions de type *Video-Component*. Si tu n'as coché que
Panel, Video-Fullscreen et Mobile, il ne s'affiche pas.

La version française de la capture est à côté, `screenshot-2048x1536-fr.png`.
L'anglaise parlera mieux à l'examinateur et aux streamers du catalogue.

Les trois sont prises sur une vraie partie — draft complet, six bans, dix
joueurs, les sept paliers remplis. La règle 4.1 demande que l'icône et la
capture représentent fidèlement le front end : une maquette se fait refuser.
Et **aucune marque Twitch** nulle part, règle 4.3 — donc surtout pas une
capture prise sur une page Twitch, qui embarquerait leur logo.

> **Le piège de l'ordre.** Twitch l'écrit dans son refus : une image ajoutée
> **après** le passage en test hébergé n'est pas vue par l'examen. Et la doc
> ajoute que modifier les détails de version impose de repasser en test local.
> Donc : repasser en test local, envoyer l'archive, poser les trois images,
> revenir en test hébergé, **puis seulement** soumettre.

---

## 8. Chaîne d'examen, guide et journal des modifications

Deux champs, à la fin de la soumission. C'est le moment le plus risqué : Twitch
rejette d'abord les extensions qu'il **n'arrive pas à voir fonctionner**.

### Nom de la chaîne pour l'examen

```
https://www.twitch.tv/eowea
```

La version soumise doit être **activée sur cette chaîne** au moment de
l'examen — panneau, superposition et mobile. Vérifie-le avant de cliquer sur
Submit, pas après.

### Le piège du direct

Une superposition vidéo n'existe pas hors direct, et la vérification tombe
entre 5 et 14 jours plus tard. Personne ne peut rester en direct deux semaines.

La doc dit précisément quoi faire, et c'est plus précis que le courriel de
refus : une extension qui a besoin d'un jeu ou d'un service en marche doit
**annoncer ses créneaux de disponibilité, entre 9h et 17h heure du Pacifique,
dans le guide**. L'équipe reprend contact si la chaîne est éteinte au moment
où elle passe.

**Le décalage joue en ta faveur.** 9h–17h PT, c'est **18h–02h à Paris** : la
plage d'examen tombe entièrement sur tes horaires de stream. Annonce des
créneaux larges, tu n'auras presque rien à changer à tes habitudes.

Deux choses jouent en ta faveur : le **panneau reste visible hors direct**, où
il affiche « En attente d'une partie » — la mise en page, les langues, le lien
et les pages de configuration s'examinent donc à tout moment.

### Guide et journal des modifications

À recopier tel quel. L'anglais est la langue de l'équipe d'examen.

```
CHANNEL FOR REVIEW: https://www.twitch.tv/eowea
The submitted version is installed and activated on that channel: panel,
video overlay and mobile.

AVAILABILITY FOR REVIEW - PLEASE READ FIRST

This extension includes a video overlay and depends on a live Heroes of the
Storm match, so the channel needs to be live for that view to be reviewable,
and I cannot stay live continuously while the review is pending.

My availability, in Pacific Time as requested:

  Every day, 10:00 AM - 3:00 PM Pacific Time.

I am in France, so these hours are my evening and I can be flexible around
them. If none of these windows work, or if you find the channel offline when
you pass, please email eowea.contact@gmail.com and I will go live at whatever
time suits your team. I can also provide a recorded walkthrough on request.

The PANEL view can be reviewed at any time, live or offline. It is visible on
the channel page permanently and shows "Waiting for a game" when no match is
running. Layout, viewer language, the off-site link and both broadcaster
pages can all be checked without the channel being live.

WHAT THE EXTENSION DOES

Heroes of the Storm is a MOBA in which each of the ten players picks a talent
at levels 1, 4, 7, 10, 13, 16 and 20. The game shows the broadcaster their
own talents only; viewers see none at all. This extension displays the full
talent grid of all ten players, live, as the picks happen, along with the
draft bans, each team's level, and the hero and role behind every portrait.

VIEWS SUBMITTED

- Panel (panneau.html) - always visible on the channel page.
- Video overlay (video_overlay.html) - a TALENTS button that opens the same
  grid over the player. It is closed by default and the video is never
  covered until the viewer opens it.
- Mobile (mobile.html) - the panel at phone width.
- Broadcaster config (config.html) and live dashboard (live_config.html).

HOW TO TEST WITHOUT A LIVE GAME

1. Open https://www.twitch.tv/eowea. The panel is below the player.
2. With no match running it reads "Waiting for a game": the extension is
   loaded and its service is answering.
3. The language follows the VIEWER, not the channel. A viewer whose Twitch
   language is French gets French, everyone else gets English. Switching your
   Twitch language and reloading the page switches the panel.
4. There is no link out of Twitch anywhere in the extension.

HOW TO TEST DURING A LIVE MATCH

1. Portraits, player names, team levels and bans fill in as the game runs.
2. A talent icon appears the moment that player picks it.
3. Hovering a talent icon shows its name and its in-game description;
   hovering a portrait shows the hero name and role. On mobile, tap instead
   of hover, and tap again to close.
4. The grid stays on screen after the match ends, until the next one starts.

THE COMPANION READER - the point most likely to raise a question

The data comes from a small program the broadcaster runs on their own PC. It
reads "replay.tracker.events", a file Heroes of the Storm itself writes to
the Windows temp folder while a match is in progress. The reader does not
attach to the game process, does not read its memory, does not inject
anything and modifies no game file. It gives no in-game advantage: every
talent it publishes is already on the broadcaster's screen, and therefore
already on the stream.

It sends only what the panel shows: map, elapsed time, the ten heroes, their
levels, their talents, the bans, and the players' Battle.net display names
with the discriminator stripped (Bnet#123456 becomes Bnet) - the same names
the game itself prints on the broadcaster's screen.

Full source code, reader included:
https://github.com/Eowea/hots-twitch-talents

SETUP FLOW

The broadcaster config page shows a pairing code. The broadcaster pastes it
into the reader once and it is stored on their PC. That token authorises
exactly one thing: publishing this panel to that channel. It grants no access
to the Twitch account. The extension uses no Required Configuration, so it
activates normally.

VIEWER DATA

None. The extension asks for no identity, sets no cookie, writes nothing to
local storage and runs no analytics. Viewers are never identified, not even
anonymously. The privacy policy and terms are published in English and French
at the URLs given in the version details.

MOBILE AND APPLE GUIDELINE 4.7

The mobile view is the same panel at phone width, from the same data. Nothing
is sold: no digital goods, no subscriptions, no donations, no gambling. There
is no viewer input of any kind, therefore no third-party content to report,
filter or block. No native API is extended or exposed. The content is general
audience: hero portraits, talent icons and player display names.

CHANGELOG - version 0.0.2

This version answers both points raised in the review of 0.0.1, and one
further issue found while re-reading the guidelines.

- 4.5, off-site linking: the "BUILDS SITE" button has been REMOVED from all
  three views. The extension now contains no link out of Twitch at all. The
  domain eowea.github.io remains declared as an image domain only - hero
  portraits and talent icons are loaded from it - and nothing in the
  extension links to it or points viewers to it.
- 4.1, required images: a screenshot of the running extension, plus the
  300x200 and 100x100 discovery images, have been added before this
  submission rather than after moving to hosted test.
- 3.4, mobile layout: the panel and mobile views could not scroll, because a
  rule meant for the video overlay was applied to all three views. With ten
  players the table is 621 px tall while a panel is 496 px, so the bottom of
  the second team was cut off and unreachable. Both views now scroll; the
  overlay still does not, since it is scaled to fit the player.

- 3.3, mobile load time: the talent descriptions, which are two thirds of the
  data and are only used by the tooltip, have been moved to a second file that
  is fetched on the first hover instead of at page load. The initial load drops
  from 786 KB to 322 KB (201 KB to 72 KB gzipped), which is about 1.2 s at
  500 Kb/s instead of 3.3 s.

One data correction, unrelated to the review: two Abathur talents had their
tiers swapped in the source database. Survival Instincts is tier 1 and Locust
Brood is tier 16, as in the game.

Nothing else changed: same behaviour, same permissions, same domains.
```

Le mieux reste quand même de **soumettre en étant en direct**, en train de
jouer, avec le lecteur lancé : l'examinateur qui tombe sur un tableau rempli
n'a plus de question à poser.

---

## 9. Avant de cliquer sur Submit

- [ ] Les deux URL de politiques répondent en 200.
- [ ] `build/extension.zip` est envoyé, et les cinq fichiers de la console
      pointent sur `panneau.html`, `video_overlay.html`, `config.html`,
      `live_config.html` et `mobile.html` — attention, c'est déjà tombé une fois.
- [ ] Les deux domaines sont déclarés, et la **liste blanche des URL du
      panneau est vide** — il n'y a plus de lien à ouvrir.
- [ ] Les **trois images** sont posées : la capture 1920×1080, la découverte
      300×200, la découverte 100×100. C'est le motif du premier refus.
- [ ] Elles ont été posées **avant** la soumission, pas après.
- [ ] Le lecteur tourne et le panneau se remplit sur ta chaîne.
- [ ] La version soumise est **activée sur twitch.tv/eowea** — c'est la chaîne
      que tu déclares pour l'examen, et l'examinateur n'y verra rien sinon.
- [ ] Le guide de la section 8 est collé dans « Guide et journal des
      modifications », avec le paragraphe SCHEDULING en tête : c'est lui qui
      évite le refus quand la chaîne est hors direct.

Une seule version peut être en examen à la fois, et **toute resoumission te
remet en fin de file** : mieux vaut une vérification de trop.
