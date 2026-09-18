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

---

## 6. Captures d'écran et icônes

La console indique les dimensions exactes attendues ; respecte-les au pixel,
c'est un motif de refus courant. Ce qu'il faut montrer :

1. **Le panneau, partie en cours** — dix joueurs, talents remplis jusqu'au
   palier 13 ou 16. C'est la capture qui vend l'extension : prends-la sur une
   partie serrée, pas sur un début de partie vide.
2. **La superposition ouverte** par-dessus une image de jeu, les deux équipes
   côte à côte.
3. **Une infobulle** ouverte sur un talent, pour montrer la description.

L'icône doit représenter l'extension telle qu'elle est — Twitch refuse les
icônes trompeuses. L'hexagone doré du bouton, sur fond sombre, fait l'affaire.

> **Interdit** : la moindre marque Twitch dans les captures ou l'icône.

---

## 7. Note pour l'examinateur — le point le plus risqué

Twitch rejette d'abord les extensions qu'il **n'arrive pas à voir
fonctionner**. La chaîne doit être en direct pendant l'examen, et personne ne
sait quand il aura lieu.

Deux choses jouent en ta faveur : le **panneau reste visible hors direct**, et
il affiche alors « En attente d'une partie ». L'examinateur peut donc vérifier
la mise en page à tout moment. Écris-le explicitement dans les notes de
soumission :

```
How to test this extension:

The panel is visible on the channel page at all times, including offline, and
shows "Waiting for a game" when no match is running.

To see it filled with live data, the broadcaster must be streaming Heroes of
the Storm with the companion reader running. I stream regularly at
twitch.tv/eowea — if the channel is offline when you review, please contact
eowea.contact@gmail.com and I will schedule a live session at a time that
suits you, or provide a recorded walkthrough.

The reader is a small program the broadcaster runs locally. It reads the
tracking file Heroes of the Storm writes to the Windows temp folder during a
match. It does not modify or inject into the game and gives no in-game
advantage: everything it shows is already visible on the broadcaster's screen.

Source code, including the reader: github.com/Eowea/hots-twitch-talents
```

Le mieux reste de **soumettre en étant en direct**, en train de jouer, avec le
lecteur lancé.

---

## 8. Avant de cliquer sur Submit

- [ ] Les deux URL de politiques répondent en 200.
- [ ] `build/extension.zip` est envoyé, et les quatre fichiers de la console
      pointent sur `panneau.html`, `video_overlay.html`, `config.html`,
      `live_config.html` — attention, c'est déjà tombé une fois.
- [ ] Les deux domaines sont déclarés.
- [ ] Les captures montrent l'extension telle qu'elle est.
- [ ] Le lecteur tourne et le panneau se remplit sur ta chaîne.

Une seule version peut être en examen à la fois, et **toute resoumission te
remet en fin de file** : mieux vaut une vérification de trop.
