/* =========================================================================
   LECTEUR replay.tracker.events — Heroes of the Storm

   C'est la source de l'extension. Pendant la partie, le client écrit ce
   fichier en clair dans %TEMP%, au fil de l'eau, et y consigne tout ce qu'il
   faut : le héros de chacun, son équipe, son niveau, et chaque talent pris.

   Le format est le "versioned struct" de Blizzard : chaque valeur est
   précédée d'un octet qui dit son type. Le flux se décode donc entièrement
   sans disposer du schéma du jeu — on lit la forme, pas un plan.

   Le fichier étant lu PENDANT son écriture, le dernier événement est presque
   toujours coupé en plein milieu. TrackerStream s'arrête alors proprement sur
   la dernière frontière saine et reprend là au relevé suivant.
   ========================================================================= */
'use strict';

const { heroName } = require('./heroes.js');

/* Le jeu tourne à 16 pas par seconde : c'est ce qui convertit un "gameloop"
   en temps de partie affichable. */
const LOOPS_PER_SECOND = 16;

const TRUNCATED = Symbol('flux tronqué');

/* =========================================================================
   LECTURE BRUTE
   ========================================================================= */

class Reader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos; }

  u8() {
    if (this.pos >= this.buf.length) throw TRUNCATED;
    return this.buf[this.pos++];
  }

  bytes(n) {
    if (this.pos + n > this.buf.length) throw TRUNCATED;
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  /* Entier de taille variable : le premier octet porte le signe en bit 0 et
     six bits utiles ; les suivants en ajoutent sept. On multiplie au lieu de
     décaler, les décalages de JavaScript étant bornés à 32 bits. */
  vint() {
    let b = this.u8();
    const negative = b & 1;
    let result = (b >> 1) & 0x3f;
    let bits = 6;
    while (b & 0x80) {
      b = this.u8();
      result += (b & 0x7f) * 2 ** bits;
      bits += 7;
    }
    return negative ? -result : result;
  }
}

const TAG = {
  ARRAY: 0x00,
  BITBLOB: 0x01,
  BLOB: 0x02,
  CHOICE: 0x03,
  OPTIONAL: 0x04,
  STRUCT: 0x05,
  U8: 0x06,
  U32: 0x07,
  U64: 0x08,
  VINT: 0x09,
};

function readValue(r) {
  const tag = r.u8();
  switch (tag) {
    case TAG.ARRAY: {
      const n = r.vint();
      const out = [];
      for (let i = 0; i < n; i++) out.push(readValue(r));
      return out;
    }
    case TAG.BITBLOB: return r.bytes(Math.floor((r.vint() + 7) / 8));
    case TAG.BLOB: return r.bytes(r.vint());
    case TAG.CHOICE: return { choix: r.vint(), valeur: readValue(r) };
    case TAG.OPTIONAL: return r.u8() ? readValue(r) : null;
    case TAG.STRUCT: {
      const n = r.vint();
      const out = {};
      for (let i = 0; i < n; i++) out[r.vint()] = readValue(r);
      return out;
    }
    case TAG.U8: return r.bytes(1)[0];
    case TAG.U32: return r.bytes(4).readUInt32BE(0);
    case TAG.U64: return Number(r.bytes(8).readBigUInt64BE(0));
    case TAG.VINT: return r.vint();
    default:
      throw new Error(`tracker : type inconnu 0x${tag.toString(16)} à l'octet ${r.pos - 1}`);
  }
}

/* =========================================================================
   MISE EN FORME DES EVENEMENTS

   Les événements nommés (PlayerInit, TalentChosen...) rangent leurs données
   en trois listes clé-valeur : chaînes, entiers, décimaux. On les aplatit en
   objets simples, plus commodes à manipuler.
   ========================================================================= */

const text = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v);

function pairs(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const key = item && item[0] && item[0][0];
    if (key === undefined) continue;
    out[text(key)] = text(item[1]);
  }
  return out;
}

/* Les événements utiles qui ne portent pas de nom de stat. Les trois derniers
   n'apparaissent qu'en draft : une partie contre l'IA n'en produit aucun. */
const EVENT_ID = {
  PLAYER_SETUP: 9,
  STAT: 10,
  HERO_BANNED: 13,
  HERO_PICKED: 14,
  HERO_SWAPPED: 15,
};

function shape(id, ev, gameloop) {
  const base = { id, gameloop, seconde: gameloop / LOOPS_PER_SECOND };

  if (id === EVENT_ID.PLAYER_SETUP) {
    // { joueur, type (1 = humain, 2 = IA), utilisateur, slot }
    return {
      ...base,
      nom: 'PlayerSetup',
      joueur: ev[0],
      humain: ev[1] === 1,
      utilisateur: ev[2],
      slot: ev[3],
    };
  }

  // Ces trois-là partagent la même forme : un héros, puis une équipe ou un
  // joueur selon le cas.
  if (id === EVENT_ID.HERO_BANNED || id === EVENT_ID.HERO_PICKED || id === EVENT_ID.HERO_SWAPPED) {
    const nom = { 13: 'HeroBanned', 14: 'HeroPicked', 15: 'HeroSwapped' }[id];
    return { ...base, nom, herosId: text(ev[0]), cible: ev[1] };
  }

  // Un événement de stat porte son nom en clair, et range ses données en
  // listes clé-valeur. On ne s'y fie que si la forme est bien celle-là.
  if (id === EVENT_ID.STAT && Buffer.isBuffer(ev[0])) {
    const chaines = pairs(ev[1]);
    const entiers = pairs(ev[2]);
    return {
      ...base, nom: ev[0].toString('utf8'), chaines, entiers, joueur: entiers.PlayerID,
    };
  }

  return { ...base, nom: null, brut: ev };
}

/* =========================================================================
   FLUX INCREMENTAL

   On garde la position atteinte et le gameloop courant entre deux lectures :
   le fichier grossit, on ne relit jamais ce qui a déjà été décodé.
   ========================================================================= */

class TrackerStream {
  constructor() {
    this.offset = 0; // Fin du dernier événement complet.
    this.gameloop = 0;
  }

  /* Décode tout ce qui est nouveau et complet dans le tampon fourni, qui doit
     être le fichier entier depuis le début. Renvoie les événements lus. */
  push(buf) {
    const events = [];
    const r = new Reader(buf, this.offset);

    for (;;) {
      if (r.pos >= buf.length) break;
      const mark = r.pos;
      const loop = this.gameloop;

      try {
        const delta = readValue(r);
        this.gameloop += (delta && typeof delta === 'object' ? delta.valeur : delta) || 0;
        const id = readValue(r);
        const ev = readValue(r);
        events.push(shape(id, ev, this.gameloop));
        this.offset = r.pos;
      } catch (err) {
        // Événement coupé par une écriture en cours : on revient à la
        // dernière frontière saine et on réessaiera au prochain relevé.
        if (err === TRUNCATED) { r.pos = mark; this.gameloop = loop; break; }
        throw err;
      }
    }
    return events;
  }
}

/* =========================================================================
   ETAT DE LA PARTIE
   Les événements sont un journal ; l'extension a besoin d'un tableau. On
   replie l'un sur l'autre au fur et à mesure.
   ========================================================================= */

function newGame() {
  return { demarree: false, gameloop: 0, joueurs: new Map(), bans: [] };
}

function player(game, id) {
  if (!game.joueurs.has(id)) {
    game.joueurs.set(id, {
      joueur: id, equipe: null, battletag: null, heros: null, herosId: null,
      niveau: 0, talents: [], humain: null, slot: null, toon: null,
    });
  }
  return game.joueurs.get(id);
}

function apply(game, events) {
  for (const e of events) {
    game.gameloop = e.gameloop;

    switch (e.nom) {
      case 'PlayerSetup':
        Object.assign(player(game, e.joueur), { humain: e.humain, slot: e.slot });
        break;

      case 'PlayerInit':
        /* Le ToonHandle identifie le compte Blizzard du joueur, et il a la
           meme forme que le dossier de compte sur le disque — c'est ainsi que
           le lecteur reconnait le streamer parmi les dix, et donc son equipe. */
        Object.assign(player(game, e.joueur), {
          equipe: e.entiers.Team,
          toon: e.chaines.ToonHandle || null,
        });
        break;

      case 'PlayerSpawned': {
        // Le tracker nomme les héros par leur personnage d'origine
        // ("HeroCrusader" pour Johanna) : on garde les deux.
        const p = player(game, e.joueur);
        p.herosId = String(e.chaines.Hero || '').replace(/^Hero/, '');
        p.heros = heroName(p.herosId);
        break;
      }

      case 'LevelUp': {
        const p = player(game, e.joueur);
        p.niveau = Math.max(p.niveau, e.entiers.Level || 0);
        break;
      }

      case 'TalentChosen': {
        const p = player(game, e.joueur);
        // L'événement ne dit pas le palier : c'est l'ordre des prises qui le
        // donne, et il est toujours croissant.
        p.talents.push({ id: e.chaines.PurchaseName, seconde: e.seconde });
        break;
      }

      case 'HeroBanned':
        // Les bans n'existent qu'en draft, et valent la peine d'être montrés.
        game.bans.push({ heros: heroName(e.herosId), herosId: e.herosId, equipe: e.cible });
        break;

      case 'GameStart':
        game.demarree = true;
        break;

      default:
        break; // Le reste du journal ne sert pas au tableau.
    }
  }
  return game;
}

/* Vue prête à envoyer : deux équipes, joueurs triés, talents dans l'ordre. */
function table(game) {
  // Seuls les joueurs qui ont vraiment pris place comptent : dans une partie
  // avortée, le journal annonce dix joueurs dont aucun n'apparaitra jamais, et
  // le tableau du viewer n'a pas a montrer dix lignes vides.
  const joueurs = [...game.joueurs.values()]
    .filter((p) => p.heros)
    .sort((a, b) => (a.equipe - b.equipe) || (a.joueur - b.joueur));

  return {
    seconde: Math.round(game.gameloop / LOOPS_PER_SECOND),
    bans: game.bans,
    joueurs: joueurs.map((p) => ({
      joueur: p.joueur,
      equipe: p.equipe,
      battletag: p.battletag || null, // Renseigné par live.js, via le lobby.
      heros: p.heros,
      herosId: p.herosId,
      toon: p.toon,
      niveau: p.niveau,
      talents: p.talents.map((t) => t.id),
    })),
  };
}

module.exports = {
  LOOPS_PER_SECOND,
  TrackerStream,
  readValue,
  Reader,
  newGame,
  apply,
  table,
};
