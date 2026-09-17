#!/usr/bin/env node
/* =========================================================================
   CLI du lecteur de jeu

     node cli.js talents        suit la partie en cours et affiche, en direct,
                                le tableau des talents des dix joueurs
     node cli.js                surveille et affiche chaque nouveau lobby
     node cli.js once           lit le lobby le plus récent déjà présent
     node cli.js dump           lit le lobby et archive tout (copie brute,
                                chaînes, hexa autour des joueurs)
     node cli.js autotest [n]   rejoue le lecteur sur n replays du disque
     node cli.js probe          relève tout ce que le jeu écrit dans %TEMP%
                                pendant une partie (Ctrl+C pour le rapport)

   Options
     --file <chemin>   force un fichier : un battlelobby brut, un tracker brut,
                       ou un .StormReplay (le contenu en est extrait)
     --json            sortie machine, pour le futur pont vers l'extension
     --save            en surveillance, archive aussi chaque lobby capté
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const bl = require('./battlelobby.js');
const mpq = require('./mpq.js');
const { startProbe } = require('./probe.js');
const tracker = require('./tracker.js');
const { knowsHero } = require('./heroes.js');
const live = require('./live.js');

const DUMP_DIR = path.join(__dirname, 'dumps');

/* =========================================================================
   ARGUMENTS
   ========================================================================= */

function parseArgs(argv) {
  const args = { mode: 'watch', file: null, json: false, save: false, count: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['watch', 'once', 'dump', 'autotest', 'probe', 'talents'].includes(a)) args.mode = a;
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--save') args.save = true;
    else if (a === '--help' || a === '-h') args.mode = 'help';
    else if (/^\d+$/.test(a)) args.count = Number(a);
  }
  return args;
}

/* =========================================================================
   CHARGEMENT
   Un .StormReplay est une archive qui contient le même battlelobby : on
   accepte les deux, ce qui permet de tester sans lancer le jeu.
   ========================================================================= */

const MPQ_MAGIC = 0x51504d; // 'MPQ', suivi de 0x1A ou 0x1B

function loadBuffer(filePath, membre = bl.LOBBY_NAME) {
  const raw = fs.readFileSync(filePath);
  const isArchive = raw.length > 4 && (raw.readUInt32LE(0) & 0xffffff) === MPQ_MAGIC;
  return isArchive ? mpq.extractFile(filePath, membre) : raw;
}

async function loadTarget(args) {
  if (args.file) {
    const st = fs.statSync(args.file);
    return { file: { path: args.file, size: st.size, mtimeMs: st.mtimeMs }, buf: loadBuffer(args.file) };
  }
  const [latest] = bl.findLobbyFiles();
  if (!latest) return null;
  return { file: latest, buf: await bl.readLobby(latest.path) };
}

/* =========================================================================
   AFFICHAGE
   ========================================================================= */

const fmtBytes = (n) => (n < 1024 * 1024
  ? `${(n / 1024).toFixed(0)} Ko`
  : `${(n / 1024 / 1024).toFixed(2)} Mo`);

function printReport({ file, lobby }) {
  const when = file ? new Date(file.mtimeMs).toLocaleTimeString('fr-FR') : '—';
  console.log('');
  console.log('─'.repeat(66));
  console.log(`Lobby   ${file ? file.path : '(tampon fourni)'}`);
  console.log(`Taille  ${fmtBytes(lobby.size)}      Écrit à ${when}`);
  console.log('─'.repeat(66));

  console.log(`\nJoueurs (${lobby.playerCount})`);
  if (lobby.playerCount === 0) {
    console.log('  aucun battletag reconnu — lance « node cli.js dump » et garde le dossier dumps/.');
  }
  lobby.battletags.forEach((bt, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${bt.full}`);
  });

  if (lobby.hasObservers) {
    console.log('\n  (plus de 10 battletags : il y a des observateurs dans ce lobby)');
  }

  // Dit une fois clairement, pour éviter de rechercher ce qui n'y est pas.
  console.log('\nHéros : absent de ce fichier, par construction — voir README.md.');
  console.log('');
}

/* =========================================================================
   ARCHIVAGE
   ========================================================================= */

function hexView(buf, from, to) {
  const lines = [];
  const start = Math.max(0, from);
  const end = Math.min(buf.length, to);

  for (let i = start; i < end; i += 16) {
    const slice = buf.subarray(i, Math.min(i + 16, end));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...slice].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

function dumpAll(buf, lobby, sourcePath) {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(DUMP_DIR, stamp);

  fs.writeFileSync(`${base}-raw.battlelobby`, buf);

  const strings = bl.extractStrings(buf, 4)
    .map((s) => `${String(s.offset).padStart(9)}  ${s.text}`)
    .join('\n');
  fs.writeFileSync(`${base}-chaines.txt`, strings, 'utf8');

  const context = lobby.battletags.map((bt) => [
    `### ${bt.full}  @${bt.offset}`,
    hexView(buf, bt.offset - 256, bt.offset + 512),
    '',
  ].join('\n')).join('\n');
  fs.writeFileSync(`${base}-contexte.txt`, context || '(aucun battletag localisé)', 'utf8');

  // Diagnostic : si un mode de jeu range un jour le héros dans le lobby,
  // c'est cette liste qui le montrera.
  const heroes = bl.findHeroMentions(buf);
  fs.writeFileSync(`${base}-rapport.json`, JSON.stringify({
    source: sourcePath,
    size: lobby.size,
    battletags: lobby.battletags,
    mentionsHeros: heroes,
  }, null, 2), 'utf8');

  console.log(`\nArchivé dans ${DUMP_DIR}`);
  console.log(`  ${stamp}-raw.battlelobby   copie brute`);
  console.log(`  ${stamp}-chaines.txt       toutes les chaînes lisibles`);
  console.log(`  ${stamp}-contexte.txt      hexa autour de chaque joueur`);
  console.log(`  ${stamp}-rapport.json      ce qui a été reconnu`);
  return base;
}

/* =========================================================================
   AUTOTEST
   Le jeu garde les replays, et un replay contient le même battlelobby : on a
   donc un corpus de non-régression sous la main, sans lancer une partie.
   ========================================================================= */

function findReplayFolders() {
  const root = path.join(os.homedir(), 'Documents', 'Heroes of the Storm', 'Accounts');
  const folders = [];

  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const next = path.join(dir, e.name);
      if (e.name === 'Multiplayer') folders.push(next);
      else walk(next, depth + 1);
    }
  };

  walk(root, 0);
  return folders;
}

function autotest(limit) {
  const folders = findReplayFolders();
  const all = [];
  for (const dir of folders) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.StormReplay')) all.push(path.join(dir, f));
    }
  }

  if (all.length === 0) {
    console.log('\nAucun replay trouvé sous Documents\\Heroes of the Storm\\Accounts.');
    return;
  }

  // Échantillon réparti sur tout le stock plutôt que sur les dernières parties.
  const step = Math.max(1, Math.floor(all.length / limit));
  const sample = all.filter((_, i) => i % step === 0).slice(0, limit);

  console.log(`\n${all.length} replays sur le disque, échantillon de ${sample.length}\n`);

  const counts = new Map();
  let prefixOk = 0;
  let prefixKo = 0;
  let missing = 0;
  let failed = 0;

  const trk = {
    ok: 0, ko: 0, incomplet: 0, talents: 0, tropDeTalents: 0, sansHeros: 0,
    inconnus: new Set(),
  };

  for (const file of sample) {
    let buf;
    try {
      buf = mpq.extractFile(file, bl.LOBBY_NAME);
    } catch (err) {
      if (/absent de l'archive/.test(err.message)) missing++;
      else { failed++; console.log(`  ECHEC ${path.basename(file)} : ${err.message}`); }
      continue;
    }

    // On relit sans le filtre pour mesurer la qualité du préfixe de longueur.
    for (const t of bl.findBattletags(buf, { requireLengthPrefix: false })) {
      if (t.prefixed) prefixOk++; else prefixKo++;
    }
    const n = bl.parseLobby(buf).playerCount;
    counts.set(n, (counts.get(n) || 0) + 1);

    // Le décodeur de talents passe sur le même corpus. Des années de patchs et
    // tous les modes de jeu : c'est le meilleur test de robustesse qu'on ait.
    try {
      const raw = mpq.extractFile(file, 'replay.tracker.events');
      const stream = new tracker.TrackerStream();
      const events = stream.push(raw);
      if (stream.offset !== raw.length) {
        trk.incomplet++;
        console.log(`  INCOMPLET ${path.basename(file)} : ${stream.offset}/${raw.length} octets`);
      }

      const vue = tracker.table(tracker.apply(tracker.newGame(), events));
      trk.ok++;
      for (const p of vue.joueurs) {
        trk.talents += p.talents.length;
        if (!p.heros) trk.sansHeros++;
        if (p.talents.length > 7) trk.tropDeTalents++; // Sept paliers, pas plus.
        if (p.herosId && !knowsHero(p.herosId)) trk.inconnus.add(p.herosId);
      }
    } catch (err) {
      trk.ko++;
      if (trk.ko <= 5) console.log(`  TRACKER ${path.basename(file)} : ${err.message}`);
    }
  }

  console.log('  Joueurs détectés par partie');
  [...counts].sort((a, b) => a[0] - b[0])
    .forEach(([n, times]) => console.log(`    ${String(n).padStart(2)} joueurs : ${times} partie(s)`));

  console.log(`\n  Préfixes de longueur justes : ${prefixOk} / ${prefixOk + prefixKo}`);
  if (missing) console.log(`  Replays sans battlelobby     : ${missing}`);
  if (failed) console.log(`  Lectures en échec            : ${failed}`);

  console.log(`\n  Tracker décodé              : ${trk.ok} / ${trk.ok + trk.ko}`);
  console.log(`  Talents relevés             : ${trk.talents}`);
  if (trk.incomplet) console.log(`  Flux incomplets             : ${trk.incomplet}`);
  if (trk.tropDeTalents) console.log(`  Joueurs à plus de 7 talents : ${trk.tropDeTalents}`);
  if (trk.sansHeros) console.log(`  Joueurs sans héros          : ${trk.sansHeros}`);
  if (trk.inconnus.size) {
    console.log(`  Héros hors dictionnaire     : ${[...trk.inconnus].sort().join(', ')}`);
  }
  console.log('');
}

/* =========================================================================
   TABLEAU DES TALENTS
   C'est la vue que le viewer verra dans le panneau Twitch. Au terminal, on
   l'affiche telle quelle, une équipe après l'autre.
   ========================================================================= */

const mmss = (s) => Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0');

function printTalents(vue) {
  console.log('');
  console.log('─'.repeat(78));
  console.log('Partie à ' + mmss(vue.seconde)
    + (vue.bans.length ? '   bans : ' + vue.bans.map((b) => b.heros).join(', ') : ''));
  console.log('─'.repeat(78));

  let equipe = null;
  for (const p of vue.joueurs) {
    if (p.equipe !== equipe) {
      equipe = p.equipe;
      console.log('');
      console.log(`  Équipe ${equipe}`);
    }
    const qui = p.battletag || ('joueur ' + p.joueur);
    console.log('   ' + String(p.heros).padEnd(14) + ' ' + qui.padEnd(20)
      + ' niv ' + String(p.niveau).padStart(2) + '   ' + p.talents.join(' > '));
  }
  console.log('');
}

function runTalents(args) {
  // Depuis un fichier : pratique pour revoir une partie déjà jouée.
  if (args.file) {
    const raw = loadBuffer(args.file, live.TRACKER_NAME);
    const partie = tracker.apply(tracker.newGame(), new tracker.TrackerStream().push(raw));

    // Un replay contient aussi le lobby : autant en tirer les vrais pseudos.
    try {
      const lobby = bl.parseLobby(loadBuffer(args.file, bl.LOBBY_NAME));
      live.attachNames(partie, lobby.battletags.map((t) => t.full));
    } catch {
      // Pas de lobby dans ce fichier : on affichera les numéros de joueur.
    }

    const vue = tracker.table(partie);
    if (args.json) console.log(JSON.stringify(vue, null, 2));
    else printTalents(vue);
    return;
  }

  console.log('Suivi de la partie en cours (' + bl.lobbyRoot() + ')');
  console.log('Lance ta partie : le tableau se remplira ici. Ctrl+C pour arrêter.');

  live.watchGame((vue) => {
    if (vue === null) {
      console.log('');
      console.log('(partie terminée, le jeu a effacé son dossier)');
      return;
    }
    if (args.json) console.log(JSON.stringify(vue));
    else printTalents(vue);
  });
}

/* =========================================================================
   POINT D'ENTREE
   ========================================================================= */

function noLobbyFound() {
  console.log('');
  console.log(`Aucun fichier de lobby sous ${bl.lobbyRoot()}`);
  console.log('Le jeu l\'écrit au chargement de la carte et Windows nettoie le dossier');
  console.log('après coup : garde « node cli.js » ouvert avant de lancer ta partie.');
  console.log('');
  console.log('Pour essayer tout de suite sur une partie déjà jouée :');
  console.log('  node cli.js autotest');
  console.log('  node cli.js once --file "<un fichier .StormReplay>"');
  console.log('');
}

/* Relève tout ce que le jeu écrit pendant une partie. Le rapport est produit
   à l'arrêt, parce que la disparition du dossier en fin de partie est
   elle-même une information à consigner. */
function runProbe() {
  const outDir = path.join(DUMP_DIR, `sonde-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  const root = bl.lobbyRoot();

  console.log(`Sonde sur ${root}`);
  console.log('Lance ta partie maintenant, joue-la normalement, puis Ctrl+C ici.');
  console.log('Relevé :  + apparition   ~ changement de taille   - effacement\n');

  const probe = startProbe(root, outDir);

  process.on('SIGINT', () => {
    const { report, file, snapshotDir } = probe.stop();
    const live = report.filter((r) => r.ecritEnContinu);

    console.log('\n\n' + '─'.repeat(66));
    console.log(`${report.length} fichier(s) observé(s)`);
    for (const r of report) {
      console.log(`  ${r.fichier}`);
      console.log(`     apparu à ${r.apparu}, ${r.nombreDeChangements} écriture(s)`
        + `${r.efface ? `, effacé à ${r.efface}` : ''}`);
    }

    console.log('');
    console.log(live.length
      ? `=> ${live.length} fichier(s) écrits EN CONTINU : ${live.map((r) => r.fichier).join(', ')}\n`
        + '   Piste sérieuse pour récupérer les talents sans lire l\'écran.'
      : '=> Aucun fichier écrit en continu : le jeu ne publie rien pendant la partie.\n'
        + '   Les talents devront venir de l\'écran.');
    console.log(`\nRapport : ${file}`);
    console.log(`Copies  : ${snapshotDir}\n`);
    process.exit(0);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }

  if (args.mode === 'autotest') return autotest(args.count);
  if (args.mode === 'probe') return runProbe();
  if (args.mode === 'talents') return runTalents(args);

  if (args.mode === 'once' || args.mode === 'dump') {
    const target = await loadTarget(args);
    if (!target) return noLobbyFound();

    const lobby = bl.parseLobby(target.buf);
    if (args.json) console.log(JSON.stringify({ file: target.file, lobby }, null, 2));
    else printReport({ file: target.file, lobby });

    if (args.mode === 'dump') dumpAll(target.buf, lobby, target.file.path);
    return;
  }

  console.log(`Surveillance de ${bl.lobbyRoot()}`);
  console.log('Lance ta partie : le lobby s\'affichera ici au chargement de la carte.');
  console.log('Ctrl+C pour arrêter.');

  bl.watchLobbies(async ({ file, buf, lobby }) => {
    if (args.json) console.log(JSON.stringify({ file, lobby }));
    else printReport({ file, lobby });
    if (args.save) dumpAll(buf, lobby, file.path);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
