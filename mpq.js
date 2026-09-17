/* =========================================================================
   LECTEUR MPQ MINIMAL — juste de quoi sortir un fichier d'un .StormReplay

   Un replay Heroes of the Storm est une archive MPQ (le format d'archive de
   Blizzard). Elle contient, entre autres, le fameux replay.server.battlelobby :
   le même fichier que celui écrit dans %TEMP% pendant la partie.

   C'est précieux pour la mise au point : plutôt que de relancer une partie à
   chaque essai, on teste le lecteur de lobby sur les replays déjà sur le
   disque. Seul ce qu'il faut est implémenté (tables chiffrées, secteurs
   zlib et bzip2) ;
   ce n'est pas une bibliothèque MPQ complète.
   ========================================================================= */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const bzip2 = require('./bzip2.js');

/* =========================================================================
   TABLE DE CHIFFREMENT
   Les tables de l'archive sont chiffrées avec un algorithme maison de
   Blizzard, amorcé par une table de 1280 entiers générée à la volée.
   ========================================================================= */

const CRYPT_TABLE = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;

  for (let i = 0; i < 0x100; i++) {
    for (let j = i, k = 0; k < 5; k++, j += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const hi = (seed & 0xffff) << 0x10;
      seed = (seed * 125 + 3) % 0x2aaaab;
      const lo = seed & 0xffff;
      table[j] = (hi | lo) >>> 0;
    }
  }
  return table;
})();

/* Type de hachage : 0 = position dans la table, 1 et 2 = identité du nom,
   3 = clé de déchiffrement du fichier. */
function hashString(str, hashType) {
  let seed1 = 0x7fed7fed;
  let seed2 = 0xeeeeeeee;
  const upper = str.toUpperCase();

  for (let i = 0; i < upper.length; i++) {
    const ch = upper.charCodeAt(i) & 0xff;
    seed1 = (CRYPT_TABLE[(hashType << 8) + ch] ^ (seed1 + seed2)) >>> 0;
    seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
  }
  return seed1 >>> 0;
}

function decryptBlock(buf, key) {
  let seed1 = key >>> 0;
  let seed2 = 0xeeeeeeee;

  for (let i = 0; i + 4 <= buf.length; i += 4) {
    seed2 = (seed2 + CRYPT_TABLE[0x400 + (seed1 & 0xff)]) >>> 0;
    const value = (buf.readUInt32LE(i) ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed1 = ((((~seed1 << 0x15) + 0x11111111) | (seed1 >>> 0x0b)) >>> 0);
    seed2 = (value + seed2 + (seed2 << 5) + 3) >>> 0;
    buf.writeUInt32LE(value, i);
  }
  return buf;
}

/* =========================================================================
   EN-TETES
   Un .StormReplay commence par un bloc « user data » (MPQ\x1B) qui indique où
   se trouve la vraie archive (MPQ\x1A). Toutes les positions internes sont
   relatives au début de cette archive, pas au début du fichier.
   ========================================================================= */

const MPQ_ARCHIVE = 0x1a51504d; // 'MPQ\x1A' en petit-boutiste
const MPQ_USERDATA = 0x1b51504d; // 'MPQ\x1B'

function readHeader(buf) {
  let base = 0;
  if (buf.readUInt32LE(0) === MPQ_USERDATA) base = buf.readUInt32LE(8);
  if (buf.readUInt32LE(base) !== MPQ_ARCHIVE) throw new Error('archive MPQ introuvable');

  return {
    base,
    sectorSize: 512 << buf.readUInt16LE(base + 0x0e),
    hashTablePos: base + buf.readUInt32LE(base + 0x10),
    blockTablePos: base + buf.readUInt32LE(base + 0x14),
    hashTableSize: buf.readUInt32LE(base + 0x18),
    blockTableSize: buf.readUInt32LE(base + 0x1c),
  };
}

function readTable(buf, pos, entries, keyName) {
  const raw = Buffer.from(buf.subarray(pos, pos + entries * 16));
  return decryptBlock(raw, hashString(keyName, 3));
}

/* =========================================================================
   RECHERCHE D'UN FICHIER
   La table de hachage est un tableau ouvert : on part de la position donnée
   par le nom et on avance tant que la case est occupée.
   ========================================================================= */

const EMPTY = 0xffffffff;
const DELETED = 0xfffffffe;

function findBlockIndex(hashTable, header, name) {
  const size = header.hashTableSize;
  const start = hashString(name, 0) % size;
  const nameA = hashString(name, 1);
  const nameB = hashString(name, 2);

  for (let i = 0; i < size; i++) {
    const at = ((start + i) % size) * 16;
    const blockIndex = hashTable.readUInt32LE(at + 12);
    if (blockIndex === EMPTY) return -1; // Case vierge : le fichier n'est pas là.
    if (blockIndex === DELETED) continue;
    if (hashTable.readUInt32LE(at) === nameA && hashTable.readUInt32LE(at + 4) === nameB) {
      return blockIndex;
    }
  }
  return -1;
}

/* =========================================================================
   DECOMPRESSION
   Chaque secteur compressé commence par un masque disant quelle méthode a
   servi. Les replays panachent zlib et bzip2 selon les blocs.
   ========================================================================= */

function decompressSector(chunk, expectedSize) {
  if (chunk.length >= expectedSize) return chunk; // Secteur stocké tel quel.

  const mask = chunk[0];
  const body = chunk.subarray(1);

  if (mask === 0x02) return zlib.inflateSync(body);
  if (mask === 0x10) return bzip2.decompress(body);
  if (mask === 0x00) return body;
  throw new Error(`compression 0x${mask.toString(16)} non gérée`);
}

const FLAG_EXISTS = 0x80000000;
const FLAG_COMPRESSED = 0x00000200;
const FLAG_IMPLODED = 0x00000100;
const FLAG_SINGLE_UNIT = 0x01000000;
const FLAG_ENCRYPTED = 0x00010000;

function readFileFromBlock(buf, header, blockTable, index, name) {
  const at = index * 16;
  const filePos = header.base + blockTable.readUInt32LE(at);
  const compressedSize = blockTable.readUInt32LE(at + 4);
  const fileSize = blockTable.readUInt32LE(at + 8);
  const flags = blockTable.readUInt32LE(at + 12) >>> 0;

  if (!(flags & FLAG_EXISTS)) throw new Error(`${name} : bloc absent`);
  if (flags & FLAG_ENCRYPTED) throw new Error(`${name} : fichier chiffré, non géré`);

  const data = buf.subarray(filePos, filePos + compressedSize);
  const compressed = (flags & FLAG_COMPRESSED) || (flags & FLAG_IMPLODED);

  if (!compressed) return Buffer.from(data.subarray(0, fileSize));
  if (flags & FLAG_SINGLE_UNIT) return decompressSector(data, fileSize);

  // Fichier en secteurs : une table de positions précède les données.
  const sectorCount = Math.ceil(fileSize / header.sectorSize);
  const offsets = [];
  for (let i = 0; i <= sectorCount; i++) offsets.push(data.readUInt32LE(i * 4));

  const parts = [];
  for (let i = 0; i < sectorCount; i++) {
    const remaining = fileSize - i * header.sectorSize;
    const plainSize = Math.min(header.sectorSize, remaining);
    parts.push(decompressSector(data.subarray(offsets[i], offsets[i + 1]), plainSize));
  }
  return Buffer.concat(parts, fileSize);
}

/* =========================================================================
   API
   ========================================================================= */

function extractFile(archivePath, name) {
  const buf = fs.readFileSync(archivePath);
  const header = readHeader(buf);

  const hashTable = readTable(buf, header.hashTablePos, header.hashTableSize, '(hash table)');
  const blockTable = readTable(buf, header.blockTablePos, header.blockTableSize, '(block table)');

  const index = findBlockIndex(hashTable, header, name);
  if (index === -1) throw new Error(`${name} : absent de l'archive`);

  return readFileFromBlock(buf, header, blockTable, index, name);
}

module.exports = { extractFile, hashString, readHeader };
