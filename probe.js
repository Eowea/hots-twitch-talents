/* =========================================================================
   SONDE DU DOSSIER TEMPORAIRE — Heroes of the Storm

   Question à trancher : pendant une partie, le client n'écrit-il que le
   battlelobby (une fois, au chargement), ou alimente-t-il aussi le replay au
   fil de l'eau ? Le dossier s'appelle "TempWriteReplayP1", ce qui laisse
   espérer la seconde réponse — et dans ce cas les talents des dix joueurs y
   passent, sans avoir à lire l'écran.

   La sonde relève tout ce qui bouge sous %TEMP%\Heroes of the Storm : fichiers
   qui apparaissent, grossissent, disparaissent. Elle garde une copie à chaque
   changement de taille, parce que le jeu efface son dossier en fin de partie.

   Elle ne fait que lire et copier. Rien n'est écrit dans le dossier du jeu.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_COPY_BYTES = 8 * 1024 * 1024; // Au-delà, on note sans copier.
const MAX_COPIES_PER_FILE = 20; // De quoi voir la progression sans saturer le disque.

/* =========================================================================
   RELEVE
   ========================================================================= */

function walk(dir, base = dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // Dossier effacé en cours de route : normal.
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, base, out); continue; }
    try {
      const st = fs.statSync(full);
      out.push({ rel: path.relative(base, full), full, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // Fichier disparu entre le listage et le stat.
    }
  }
  return out;
}

/* =========================================================================
   SONDE
   ========================================================================= */

function startProbe(root, outDir, { intervalMs = 1000, log = console.log } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const snapshotDir = path.join(outDir, 'copies');
  fs.mkdirSync(snapshotDir, { recursive: true });

  const started = Date.now();
  const seen = new Map(); // rel -> { firstSeen, samples[], copies }
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(5);
  const fmt = (n) => {
    if (n < 0) return '—';
    if (n < 1024) return `${n} o`; // Sans ça, les petits fichiers s'affichent tous "0 Ko".
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
    return `${(n / 1024 / 1024).toFixed(2)} Mo`;
  };

  const copy = (file, entry) => {
    if (entry.copies >= MAX_COPIES_PER_FILE || file.size > MAX_COPY_BYTES) return;
    const safe = file.rel.replace(/[\\/]/g, '_');
    const target = path.join(snapshotDir, `${safe}.${String(entry.copies).padStart(3, '0')}`);
    try {
      fs.copyFileSync(file.full, target);
      entry.copies++;
    } catch {
      // Fichier verrouillé ou déjà effacé : on garde la trace dans le relevé.
    }
  };

  const tick = () => {
    const now = Date.now();
    const current = walk(root);
    const present = new Set();

    for (const file of current) {
      present.add(file.rel);
      let entry = seen.get(file.rel);

      if (!entry) {
        entry = { firstSeen: now, lastSize: -1, samples: [], copies: 0, gone: false };
        seen.set(file.rel, entry);
        log(`${elapsed()}  + ${file.rel}  ${fmt(file.size)}`);
      } else if (file.size !== entry.lastSize) {
        log(`${elapsed()}  ~ ${file.rel}  ${fmt(entry.lastSize)} -> ${fmt(file.size)}`);
      } else {
        continue; // Rien de neuf sur ce fichier.
      }

      entry.lastSize = file.size;
      entry.samples.push({ t: now - started, size: file.size });
      copy(file, entry);
    }

    for (const [rel, entry] of seen) {
      if (!entry.gone && !present.has(rel)) {
        entry.gone = true;
        entry.goneAt = now - started;
        log(`${elapsed()}  - ${rel}  (effacé par le jeu)`);
      }
    }
  };

  const buildReport = () => [...seen].map(([rel, e]) => ({
    fichier: rel,
    apparu: `${((e.firstSeen - started) / 1000).toFixed(0)}s`,
    tailleFinale: e.lastSize,
    nombreDeChangements: e.samples.length,
    // Le point clé : une taille qui bouge après l'apparition = écriture en continu.
    ecritEnContinu: e.samples.length > 1,
    efface: e.gone ? `${(e.goneAt / 1000).toFixed(0)}s` : null,
    copies: e.copies,
    historique: e.samples,
  }));

  const reportFile = path.join(outDir, 'sonde.json');
  const flush = () => {
    const report = buildReport();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  };

  // Le rapport est réécrit à chaque relevé : une partie de vingt minutes ne
  // doit pas être perdue parce que la fenêtre a été fermée d'un coup sec.
  const timer = setInterval(() => { tick(); flush(); }, intervalMs);
  tick();
  flush();

  return {
    stop: () => {
      clearInterval(timer);
      return { report: flush(), file: reportFile, snapshotDir };
    },
  };
}

module.exports = { startProbe };
