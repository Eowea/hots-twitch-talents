/* =========================================================================
   DECOMPRESSION BZIP2 — pure JS, sans dépendance

   Node sait faire gzip et zlib, mais pas bzip2 ; or c'est ce que Blizzard
   utilise pour la plupart des blocs d'un .StormReplay. Comme le reste de
   l'outil ne dépend de rien, on l'écrit plutôt que d'installer un paquet.

   Décompression seule, sur un flux complet en mémoire — c'est tout ce dont
   on a besoin pour un secteur d'archive MPQ.
   ========================================================================= */
'use strict';

const BLOCK_MAGIC = '314159265359';
const END_MAGIC = '177245385090';

/* =========================================================================
   LECTURE BIT A BIT (poids fort en premier)
   ========================================================================= */

class BitReader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0; // octet courant
    this.bit = 0; // bit courant dans cet octet
  }

  read(n) {
    let value = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.buf.length) throw new Error('bzip2 : flux tronqué');
      const b = (this.buf[this.pos] >> (7 - this.bit)) & 1;
      value = value * 2 + b; // Pas de décalage : n peut valoir 48 bits.
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return value;
  }

  readBit() {
    return this.read(1);
  }

  /* Les marqueurs de bloc font 48 bits : on les compare en hexadécimal
     pour rester exact au-delà de 32 bits. */
  readMagic() {
    const hi = this.read(24);
    const lo = this.read(24);
    return hi.toString(16).padStart(6, '0') + lo.toString(16).padStart(6, '0');
  }
}

/* =========================================================================
   TABLES DE HUFFMAN
   Forme canonique de bzip2 : on ne stocke pas les codes mais, par longueur,
   la borne haute (limit) et le décalage (base) qui mènent au symbole.
   ========================================================================= */

function buildTable(lengths, alphaSize) {
  let minLen = 32;
  let maxLen = 0;
  for (let i = 0; i < alphaSize; i++) {
    if (lengths[i] > maxLen) maxLen = lengths[i];
    if (lengths[i] < minLen) minLen = lengths[i];
  }

  const perm = new Int32Array(alphaSize);
  let pp = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let sym = 0; sym < alphaSize; sym++) {
      if (lengths[sym] === len) perm[pp++] = sym;
    }
  }

  const base = new Int32Array(25);
  const limit = new Int32Array(25);
  for (let i = 0; i < alphaSize; i++) base[lengths[i] + 1]++;
  for (let i = 1; i < 25; i++) base[i] += base[i - 1];

  let vec = 0;
  for (let len = minLen; len <= maxLen; len++) {
    vec += base[len + 1] - base[len];
    limit[len] = vec - 1;
    vec <<= 1;
  }
  for (let len = minLen + 1; len <= maxLen; len++) {
    base[len] = ((limit[len - 1] + 1) << 1) - base[len];
  }

  return { perm, base, limit, minLen, maxLen };
}

function decodeSymbol(reader, table) {
  let len = table.minLen;
  let code = reader.read(len);
  while (code > table.limit[len]) {
    if (++len > table.maxLen) throw new Error('bzip2 : code de Huffman invalide');
    code = (code << 1) | reader.readBit();
  }
  return table.perm[code - table.base[len]];
}

/* =========================================================================
   UN BLOC
   ========================================================================= */

function decodeBlock(reader, blockSize) {
  reader.read(32); // CRC du bloc : on ne vérifie pas.
  if (reader.readBit()) throw new Error('bzip2 : blocs "randomized" non gérés');
  const origPtr = reader.read(24);

  // Quels octets apparaissent dans le bloc : une carte à deux niveaux.
  const used = [];
  const used16 = reader.read(16);
  for (let i = 0; i < 16; i++) {
    if (!(used16 & (0x8000 >> i))) continue;
    const bits = reader.read(16);
    for (let j = 0; j < 16; j++) {
      if (bits & (0x8000 >> j)) used.push(i * 16 + j);
    }
  }
  const symCount = used.length;
  const alphaSize = symCount + 2; // RUNA, RUNB, puis les symboles MTF, puis EOB.

  const groupCount = reader.read(3);
  const selectorCount = reader.read(15);

  // Sélecteurs : quel groupe de Huffman sert pour chaque tranche de 50 symboles.
  const groupMtf = [];
  for (let i = 0; i < groupCount; i++) groupMtf.push(i);
  const selectors = new Int32Array(selectorCount);
  for (let i = 0; i < selectorCount; i++) {
    let j = 0;
    while (reader.readBit()) {
      if (++j >= groupCount) throw new Error('bzip2 : sélecteur invalide');
    }
    selectors[i] = groupMtf.splice(j, 1)[0];
    groupMtf.unshift(selectors[i]);
  }

  // Longueurs de code, transmises en delta depuis une valeur de départ.
  const tables = [];
  for (let g = 0; g < groupCount; g++) {
    const lengths = new Int32Array(alphaSize);
    let curr = reader.read(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (curr < 1 || curr > 20) throw new Error('bzip2 : longueur de code invalide');
        if (!reader.readBit()) break;
        curr += reader.readBit() ? -1 : 1;
      }
      lengths[s] = curr;
    }
    tables.push(buildTable(lengths, alphaSize));
  }

  // Décodage MTF + RLE2 vers la chaîne transformée par Burrows-Wheeler.
  const mtf = used.slice();
  const bwt = Buffer.alloc(blockSize);
  const counts = new Int32Array(256);
  let length = 0;

  const EOB = alphaSize - 1;
  let groupIndex = -1;
  let groupPos = 0;
  let table = null;

  let runLength = 0;
  let runBit = 1;

  const flushRun = () => {
    if (runLength === 0) return;
    const byte = mtf[0];
    if (length + runLength > blockSize) throw new Error('bzip2 : bloc trop grand');
    bwt.fill(byte, length, length + runLength);
    counts[byte] += runLength;
    length += runLength;
    runLength = 0;
    runBit = 1;
  };

  for (;;) {
    if (groupPos === 0) {
      groupPos = 50;
      table = tables[selectors[++groupIndex]];
    }
    groupPos--;

    const sym = decodeSymbol(reader, table);

    if (sym === 0) { runLength += runBit; runBit <<= 1; continue; } // RUNA
    if (sym === 1) { runLength += 2 * runBit; runBit <<= 1; continue; } // RUNB

    flushRun();
    if (sym === EOB) break;

    // Move-to-front : le symbole lu est un rang dans la liste, pas un octet.
    const rank = sym - 1;
    const byte = mtf.splice(rank, 1)[0];
    mtf.unshift(byte);

    if (length >= blockSize) throw new Error('bzip2 : bloc trop grand');
    bwt[length++] = byte;
    counts[byte]++;
  }

  // Transformation de Burrows-Wheeler inverse.
  const cumulative = new Int32Array(256);
  let total = 0;
  for (let i = 0; i < 256; i++) { cumulative[i] = total; total += counts[i]; }

  const next = new Int32Array(length);
  for (let i = 0; i < length; i++) next[cumulative[bwt[i]]++] = i;

  const out = Buffer.alloc(length);
  let pos = next[origPtr];
  for (let i = 0; i < length; i++) { out[i] = bwt[pos]; pos = next[pos]; }
  return out;
}

/* =========================================================================
   RLE INITIAL
   Quatre octets identiques sont suivis d'un compteur de répétitions en plus.
   ========================================================================= */

function undoRunLength(buf) {
  const parts = [];
  let run = 0;
  let prev = -1;
  let start = 0;

  for (let i = 0; i < buf.length; i++) {
    if (run === 4) {
      parts.push(buf.subarray(start, i));
      parts.push(Buffer.alloc(buf[i], prev));
      start = i + 1;
      run = 0;
      prev = -1;
      continue;
    }
    run = buf[i] === prev ? run + 1 : 1;
    prev = buf[i];
  }
  parts.push(buf.subarray(start));
  return Buffer.concat(parts);
}

/* =========================================================================
   API
   ========================================================================= */

function decompress(input) {
  if (input[0] !== 0x42 || input[1] !== 0x5a || input[2] !== 0x68) {
    throw new Error('bzip2 : en-tête BZh absent');
  }
  const level = input[3] - 0x30;
  if (level < 1 || level > 9) throw new Error('bzip2 : niveau invalide');

  const reader = new BitReader(input);
  reader.read(32); // 'BZh' + niveau, déjà lus ci-dessus.

  const blocks = [];
  for (;;) {
    const magic = reader.readMagic();
    if (magic === END_MAGIC) break;
    if (magic !== BLOCK_MAGIC) throw new Error('bzip2 : marqueur de bloc inattendu');
    blocks.push(undoRunLength(decodeBlock(reader, level * 100000)));
  }
  return Buffer.concat(blocks);
}

module.exports = { decompress };
