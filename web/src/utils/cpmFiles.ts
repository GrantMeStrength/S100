/**
 * CP/M 2.2 file browser — parse directory, extract files, write files into disk images.
 *
 * Geometry assumptions (standard 8-inch SSSD / IBM 3740):
 *   77 tracks × 26 sectors × 128 bytes = 256,256 bytes
 *   2 reserved system tracks (tracks 0-1)
 *   Block size (BLS) = 1024 bytes
 *   Directory entries (DRM) = 63 (max 64 entries)
 *   Max disk blocks (DSM) = 242
 *
 * The 88-DCDD format uses 32 sectors × 137 bytes with different geometry,
 * but the CP/M logical layout within the data portion is the same once
 * you account for the sector translation. For DCDD we skip the 9-byte
 * sector headers and read/write just the 128-byte payload per sector.
 */

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface DiskGeometry {
  tracks: number;
  sectorsPerTrack: number;
  sectorSize: number;        // payload bytes (128 for CP/M)
  reservedTracks: number;    // system tracks before data area
  blockSize: number;         // BLS — allocation block size
  dirEntries: number;        // DRM + 1
  totalBlocks: number;       // DSM + 1
}

export const GEOM_8INCH: DiskGeometry = {
  tracks: 77,
  sectorsPerTrack: 26,
  sectorSize: 128,
  reservedTracks: 2,
  blockSize: 1024,
  dirEntries: 64,
  totalBlocks: 243,
};

// DCDD: 77 tracks × 32 sectors × 137 bytes (3-byte preamble + 128 payload + 6 trailer)
// DPB extracted from the Altair CP/M 2.2 BIOS in AltairCPM22.dsk:
//   SPT=32, BSH=4, BLM=15, EXM=0, DSM=149, AL0=C0, OFF=2
// AL0=0xC0 reserves blocks 0-1 for directory (2 × 2048 = 4096 bytes = 128 entry slots).
export const GEOM_DCDD: DiskGeometry = {
  tracks: 77,
  sectorsPerTrack: 32,
  sectorSize: 128,          // logical payload
  reservedTracks: 2,        // Altair CP/M 2.2 uses 2 reserved tracks
  blockSize: 2048,          // BSH=4 → BLS=2048
  dirEntries: 64,           // DRM=63 → 64 entries (1 dir block used)
  totalBlocks: 150,         // DSM+1 = 150
};

// ── CP/M Directory Entry ──────────────────────────────────────────────────────

export interface CpmDirEntry {
  user: number;              // user number (0-15, 0xE5 = deleted)
  name: string;              // 8 chars, trimmed
  ext: string;               // 3 chars, trimmed
  extent: number;            // extent number (low byte)
  s1: number;
  s2: number;                // extent high byte
  records: number;           // RC — records used in this extent (128 bytes each)
  blocks: number[];          // allocation block numbers (8 or 16 entries depending on DSM)
  readOnly: boolean;         // high bit of ext[0]
  system: boolean;           // high bit of ext[1]
}

export interface CpmFile {
  user: number;
  name: string;              // "FILENAME.EXT" format
  basename: string;          // "FILENAME"
  ext: string;               // "EXT"
  size: number;              // total bytes (based on records count)
  readOnly: boolean;
  system: boolean;
  extents: CpmDirEntry[];    // all directory entries for this file
}

/**
 * Altair CP/M 2.2 BIOS SECTRAN table (extracted from live BIOS at E7BE).
 * Maps logical sector (0-based index) → physical sector (1-based value).
 * The DCDD BIOS uses 1-based sector numbers; readSector/writeSector
 * subtract 1 to get the 0-based hardware offset.
 */
const DCDD_SECTRAN = [
  1,  9, 17, 25,  3, 11, 19, 27,  5, 13, 21, 29,  7, 15, 23, 31,
  2, 10, 18, 26,  4, 12, 20, 28,  6, 14, 22, 30,  8, 16, 24, 32,
];

function logicalToPhysical(logicalSector: number, _geom: DiskGeometry): number {
  return DCDD_SECTRAN[logicalSector];
}

// ── Low-level disk access ─────────────────────────────────────────────────────

const DCDD_SECTOR_RAW = 137;  // 3-byte preamble + 128 payload + 6 trailer
const DCDD_HEADER = 3;

function isDcdd(data: Uint8Array): boolean {
  // 337,568 or 337,664 (with 96-byte trailing padding from SIMH)
  return data.length === 77 * 32 * 137 || data.length === 77 * 32 * 137 + 96;
}

/**
 * Read a 128-byte sector from the disk image.
 * For flat images: offset = (track * SPT + (physSector - 1)) * 128
 * For DCDD images: offset = (track * 32 + (physSector - 1)) * 137 + 3  (skip 3-byte preamble)
 */
function readSector(data: Uint8Array, track: number, physSector: number, geom: DiskGeometry): Uint8Array | null {
  if (isDcdd(data)) {
    const off = (track * geom.sectorsPerTrack + (physSector - 1)) * DCDD_SECTOR_RAW + DCDD_HEADER;
    if (off + 128 > data.length) return null;
    return data.slice(off, off + 128);
  }
  const off = (track * geom.sectorsPerTrack + (physSector - 1)) * geom.sectorSize;
  if (off + 128 > data.length) return null;
  return data.slice(off, off + 128);
}

/**
 * Write a 128-byte sector into the disk image (mutates `data` in place).
 * For DCDD images, also updates the checksum byte (sum of payload mod 256)
 * stored at offset +132 within the 137-byte raw sector.
 */
function writeSector(data: Uint8Array, track: number, physSector: number, geom: DiskGeometry, payload: Uint8Array): boolean {
  if (payload.length !== 128) return false;
  if (isDcdd(data)) {
    const sectorBase = (track * geom.sectorsPerTrack + (physSector - 1)) * DCDD_SECTOR_RAW;
    const off = sectorBase + DCDD_HEADER;
    if (off + 128 > data.length) return false;
    data.set(payload, off);
    // Update checksum at byte 132 of the raw sector (sum of 128 payload bytes mod 256)
    let cksum = 0;
    for (let i = 0; i < 128; i++) cksum = (cksum + payload[i]) & 0xFF;
    if (sectorBase + 132 < data.length) data[sectorBase + 132] = cksum;
    return true;
  }
  const off = (track * geom.sectorsPerTrack + (physSector - 1)) * geom.sectorSize;
  if (off + 128 > data.length) return false;
  data.set(payload, off);
  return true;
}

// ── Block-level access ────────────────────────────────────────────────────────

/**
 * Read one allocation block (BLS bytes) from the data area.
 * Block 0 starts at the first sector after the reserved tracks.
 */
function readBlock(data: Uint8Array, blockNum: number, geom: DiskGeometry): Uint8Array | null {
  const sectorsPerBlock = geom.blockSize / geom.sectorSize;
  // First logical sector of this block (within the data area)
  const startLogicalSector = blockNum * sectorsPerBlock;

  const result = new Uint8Array(geom.blockSize);
  for (let i = 0; i < sectorsPerBlock; i++) {
    const logSec = startLogicalSector + i;
    // Convert to track + physical sector
    const absLogSec = logSec; // logical sectors within data area
    const secPerTrack = geom.sectorsPerTrack;
    const track = geom.reservedTracks + Math.floor(absLogSec / secPerTrack);
    const sectorInTrack = absLogSec % secPerTrack;
    const physSector = logicalToPhysical(sectorInTrack, geom);

    const sec = readSector(data, track, physSector, geom);
    if (!sec) return null;
    result.set(sec, i * geom.sectorSize);
  }
  return result;
}

/**
 * Write one allocation block to the data area.
 */
function writeBlock(data: Uint8Array, blockNum: number, geom: DiskGeometry, blockData: Uint8Array): boolean {
  const sectorsPerBlock = geom.blockSize / geom.sectorSize;
  const startLogicalSector = blockNum * sectorsPerBlock;

  for (let i = 0; i < sectorsPerBlock; i++) {
    const logSec = startLogicalSector + i;
    const secPerTrack = geom.sectorsPerTrack;
    const track = geom.reservedTracks + Math.floor(logSec / secPerTrack);
    const sectorInTrack = logSec % secPerTrack;
    const physSector = logicalToPhysical(sectorInTrack, geom);

    const payload = blockData.slice(i * geom.sectorSize, (i + 1) * geom.sectorSize);
    if (!writeSector(data, track, physSector, geom, payload)) return false;
  }
  return true;
}

// ── Directory parsing ─────────────────────────────────────────────────────────

function detectGeometry(data: Uint8Array): DiskGeometry {
  if (isDcdd(data)) return GEOM_DCDD;
  return GEOM_8INCH;
}

function parseDirEntry(raw: Uint8Array, offset: number): CpmDirEntry | null {
  const user = raw[offset];
  if (user === 0xE5) return null; // deleted/empty

  // Extract filename (bytes 1-8) with high bits stripped
  let name = '';
  for (let i = 1; i <= 8; i++) {
    name += String.fromCharCode(raw[offset + i] & 0x7F);
  }
  name = name.trimEnd();

  // Extract extension (bytes 9-11) — high bits carry R/O and SYS flags
  const readOnly = (raw[offset + 9] & 0x80) !== 0;
  const system   = (raw[offset + 10] & 0x80) !== 0;
  let ext = '';
  for (let i = 9; i <= 11; i++) {
    ext += String.fromCharCode(raw[offset + i] & 0x7F);
  }
  ext = ext.trimEnd();

  const extent  = raw[offset + 12];
  const s1      = raw[offset + 13];
  const s2      = raw[offset + 14];
  const records = raw[offset + 15];

  // Block numbers: 8-bit if DSM <= 255, else 16-bit
  // For standard 8-inch (DSM=242) and DCDD (DSM=254), blocks are 8-bit
  const blocks: number[] = [];
  for (let i = 16; i < 32; i++) {
    const b = raw[offset + i];
    if (b !== 0) blocks.push(b);
  }

  return { user, name, ext, extent, s1, s2, records, blocks, readOnly, system };
}

/**
 * Parse the CP/M directory and return a list of files (grouped extents).
 */
export function listFiles(data: Uint8Array): CpmFile[] {
  const geom = detectGeometry(data);

  // Directory occupies the first N blocks (ceil(dirEntries * 32 / blockSize))
  const dirBytes = geom.dirEntries * 32;
  const dirBlocks = Math.ceil(dirBytes / geom.blockSize);

  // Read all directory blocks
  const dirData = new Uint8Array(dirBlocks * geom.blockSize);
  for (let b = 0; b < dirBlocks; b++) {
    const block = readBlock(data, b, geom);
    if (!block) return [];
    dirData.set(block, b * geom.blockSize);
  }

  // Parse all entries
  const entries: CpmDirEntry[] = [];
  for (let i = 0; i < geom.dirEntries; i++) {
    const entry = parseDirEntry(dirData, i * 32);
    if (entry) entries.push(entry);
  }

  // Group by user + name + ext
  const fileMap = new Map<string, CpmFile>();
  for (const entry of entries) {
    const key = `${entry.user}:${entry.name}:${entry.ext}`;
    if (!fileMap.has(key)) {
      fileMap.set(key, {
        user: entry.user,
        name: entry.ext ? `${entry.name}.${entry.ext}` : entry.name,
        basename: entry.name,
        ext: entry.ext,
        size: 0,
        readOnly: entry.readOnly,
        system: entry.system,
        extents: [],
      });
    }
    fileMap.get(key)!.extents.push(entry);
  }

  // Calculate sizes and sort extents
  for (const file of fileMap.values()) {
    file.extents.sort((a, b) => {
      const extA = a.s2 * 32 + a.extent;
      const extB = b.s2 * 32 + b.extent;
      return extA - extB;
    });
    // Total size = sum of records × 128
    // Last extent uses its record count; earlier extents are full (128 records = 16KB per extent for BLS=1024)
    const recordsPerExtent = geom.blockSize / 128 * 8; // 8 blocks per extent entry × BLS/128 records per block
    let totalRecords = 0;
    for (let i = 0; i < file.extents.length; i++) {
      if (i < file.extents.length - 1) {
        totalRecords += recordsPerExtent;
      } else {
        totalRecords += file.extents[i].records;
      }
    }
    file.size = totalRecords * 128;
  }

  // Sort by name
  return Array.from(fileMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract a file's contents from the disk image.
 */
export function extractFile(data: Uint8Array, file: CpmFile): Uint8Array | null {
  const geom = detectGeometry(data);
  const chunks: Uint8Array[] = [];

  // Read blocks from each extent in order
  for (const ext of file.extents) {
    for (const blockNum of ext.blocks) {
      const block = readBlock(data, blockNum, geom);
      if (!block) return null;
      chunks.push(block);
    }
  }

  if (chunks.length === 0) return new Uint8Array(0);

  // Assemble and trim to file size
  const full = new Uint8Array(chunks.length * geom.blockSize);
  for (let i = 0; i < chunks.length; i++) {
    full.set(chunks[i], i * geom.blockSize);
  }

  return full.slice(0, file.size);
}

/**
 * Write a file into the disk image. Returns the modified image or null on failure.
 * Finds free blocks and directory entries to accommodate the file.
 */
export function writeFile(
  data: Uint8Array,
  fileName: string,
  fileData: Uint8Array,
  user: number = 0,
): { data: Uint8Array; error?: string } {
  const geom = detectGeometry(data);
  const result = new Uint8Array(data); // work on a copy

  // Parse filename → 8.3
  const { basename, ext, error: nameErr } = parseCpmFilename(fileName);
  if (nameErr) return { data, error: nameErr };

  // First, delete any existing file with the same name
  deleteFileFromImage(result, basename, ext, user, geom);

  // Calculate blocks needed
  const blocksNeeded = Math.ceil(fileData.length / geom.blockSize);
  if (blocksNeeded === 0) return { data: result };

  // Find free blocks (by scanning directory to see which are in use)
  const usedBlocks = new Set<number>();
  const dirBlocks = Math.ceil(geom.dirEntries * 32 / geom.blockSize);

  // Directory blocks are implicitly allocated (blocks 0..dirBlocks-1)
  for (let b = 0; b < dirBlocks; b++) usedBlocks.add(b);

  // Scan directory for in-use blocks
  const dirData = new Uint8Array(dirBlocks * geom.blockSize);
  for (let b = 0; b < dirBlocks; b++) {
    const block = readBlock(result, b, geom);
    if (block) dirData.set(block, b * geom.blockSize);
  }
  for (let i = 0; i < geom.dirEntries; i++) {
    const user_byte = dirData[i * 32];
    if (user_byte === 0xE5) continue;
    for (let j = 16; j < 32; j++) {
      const b = dirData[i * 32 + j];
      if (b !== 0) usedBlocks.add(b);
    }
  }

  // Collect free blocks
  const freeBlocks: number[] = [];
  for (let b = dirBlocks; b < geom.totalBlocks; b++) {
    if (!usedBlocks.has(b)) freeBlocks.push(b);
    if (freeBlocks.length >= blocksNeeded) break;
  }
  if (freeBlocks.length < blocksNeeded) {
    return { data, error: `Disk full: need ${blocksNeeded} blocks, only ${freeBlocks.length} free.` };
  }

  // Write data blocks
  for (let i = 0; i < blocksNeeded; i++) {
    const blockData = new Uint8Array(geom.blockSize);
    const srcOff = i * geom.blockSize;
    const srcLen = Math.min(geom.blockSize, fileData.length - srcOff);
    blockData.set(fileData.subarray(srcOff, srcOff + srcLen));
    // Fill remainder with 0x1A (CP/M EOF) for text files, 0x00 for binary
    // Use 0xE5 as fill (standard for unused disk space)
    for (let j = srcLen; j < geom.blockSize; j++) blockData[j] = 0x1A;
    if (!writeBlock(result, freeBlocks[i], geom, blockData)) {
      return { data, error: `Failed to write block ${freeBlocks[i]}.` };
    }
  }

  // Create directory entries (extents)
  // Each extent covers up to 16384 bytes (128 records × 128 bytes).
  // With 8-bit block numbers (DSM < 256), all 16 pointer slots are available,
  // but only blocksPerExtent slots are used per CP/M extent.
  const blocksPerExtent = Math.floor(16384 / geom.blockSize); // 8 for BLS=2048, 16 for BLS=1024
  const extentsNeeded = Math.ceil(blocksNeeded / blocksPerExtent);

  // Find free directory slots
  const freeSlots: number[] = [];
  for (let i = 0; i < geom.dirEntries; i++) {
    if (dirData[i * 32] === 0xE5) {
      freeSlots.push(i);
      if (freeSlots.length >= extentsNeeded) break;
    }
  }
  if (freeSlots.length < extentsNeeded) {
    return { data, error: `Directory full: need ${extentsNeeded} entries, only ${freeSlots.length} free.` };
  }

  // Write directory entries
  let blockIdx = 0;
  for (let e = 0; e < extentsNeeded; e++) {
    const slot = freeSlots[e];
    const offset = slot * 32;

    dirData[offset] = user;

    // Filename (8 bytes, space-padded)
    for (let i = 0; i < 8; i++) {
      dirData[offset + 1 + i] = i < basename.length ? basename.charCodeAt(i) : 0x20;
    }
    // Extension (3 bytes, space-padded)
    for (let i = 0; i < 3; i++) {
      dirData[offset + 9 + i] = i < ext.length ? ext.charCodeAt(i) : 0x20;
    }

    // Extent number
    dirData[offset + 12] = e & 0x1F;
    dirData[offset + 13] = 0; // S1
    dirData[offset + 14] = (e >> 5) & 0x3F; // S2

    // Records in this extent
    const blocksInExtent = Math.min(blocksPerExtent, blocksNeeded - blockIdx);
    const bytesInExtent = Math.min(blocksInExtent * geom.blockSize, fileData.length - blockIdx * geom.blockSize);
    const records = Math.ceil(bytesInExtent / 128);
    dirData[offset + 15] = records > 128 ? 128 : records;

    // Block pointers (only first blocksPerExtent slots used, rest must be 0)
    for (let i = 0; i < 16; i++) {
      if (i < blocksPerExtent && blockIdx < blocksNeeded) {
        dirData[offset + 16 + i] = freeBlocks[blockIdx++];
      } else {
        dirData[offset + 16 + i] = 0;
      }
    }
  }

  // Write directory blocks back to disk
  for (let b = 0; b < dirBlocks; b++) {
    const blockData = dirData.slice(b * geom.blockSize, (b + 1) * geom.blockSize);
    if (!writeBlock(result, b, geom, blockData)) {
      return { data, error: `Failed to write directory block ${b}.` };
    }
  }

  return { data: result };
}

/**
 * Delete a file from the disk image (marks directory entries as 0xE5).
 */
function deleteFileFromImage(
  data: Uint8Array,
  basename: string,
  ext: string,
  user: number,
  geom: DiskGeometry,
): void {
  const dirBlocks = Math.ceil(geom.dirEntries * 32 / geom.blockSize);
  const dirData = new Uint8Array(dirBlocks * geom.blockSize);
  for (let b = 0; b < dirBlocks; b++) {
    const block = readBlock(data, b, geom);
    if (block) dirData.set(block, b * geom.blockSize);
  }

  let changed = false;
  for (let i = 0; i < geom.dirEntries; i++) {
    const off = i * 32;
    if (dirData[off] !== user) continue;

    let nameMatch = true;
    for (let j = 0; j < 8; j++) {
      const ch = String.fromCharCode(dirData[off + 1 + j] & 0x7F);
      const expected = j < basename.length ? basename[j] : ' ';
      if (ch !== expected) { nameMatch = false; break; }
    }
    if (!nameMatch) continue;

    let extMatch = true;
    for (let j = 0; j < 3; j++) {
      const ch = String.fromCharCode(dirData[off + 9 + j] & 0x7F);
      const expected = j < ext.length ? ext[j] : ' ';
      if (ch !== expected) { extMatch = false; break; }
    }
    if (!extMatch) continue;

    dirData[off] = 0xE5;
    changed = true;
  }

  if (changed) {
    for (let b = 0; b < dirBlocks; b++) {
      writeBlock(data, b, geom, dirData.slice(b * geom.blockSize, (b + 1) * geom.blockSize));
    }
  }
}

/**
 * Delete a file by CpmFile reference. Returns modified image.
 */
export function deleteFile(data: Uint8Array, file: CpmFile): Uint8Array {
  const geom = detectGeometry(data);
  const result = new Uint8Array(data);
  deleteFileFromImage(result, file.basename, file.ext, file.user, geom);
  return result;
}

/**
 * Parse a filename string into CP/M 8.3 format.
 */
function parseCpmFilename(name: string): { basename: string; ext: string; error?: string } {
  // Strip path
  const parts = name.replace(/\\/g, '/').split('/');
  let fn = parts[parts.length - 1].toUpperCase();

  // Split on dot
  const dotIdx = fn.lastIndexOf('.');
  let basename: string;
  let ext: string;
  if (dotIdx >= 0) {
    basename = fn.substring(0, dotIdx);
    ext = fn.substring(dotIdx + 1);
  } else {
    basename = fn;
    ext = '';
  }

  // Validate
  if (basename.length === 0) return { basename: '', ext: '', error: 'Filename cannot be empty.' };
  if (basename.length > 8) basename = basename.substring(0, 8);
  if (ext.length > 3) ext = ext.substring(0, 3);

  // Only allow valid CP/M characters
  const valid = /^[A-Z0-9$#&@!%'()\-{}~^_`]+$/;
  if (!valid.test(basename) || (ext && !valid.test(ext))) {
    return { basename, ext, error: `Invalid CP/M filename: ${basename}.${ext}` };
  }

  return { basename, ext };
}

/**
 * Get disk usage statistics.
 */
export function getDiskStats(data: Uint8Array): {
  totalBlocks: number;
  usedBlocks: number;
  freeBlocks: number;
  totalKb: number;
  usedKb: number;
  freeKb: number;
  fileCount: number;
} {
  const geom = detectGeometry(data);
  const files = listFiles(data);
  const dirBlocks = Math.ceil(geom.dirEntries * 32 / geom.blockSize);

  const usedBlocks = new Set<number>();
  for (let b = 0; b < dirBlocks; b++) usedBlocks.add(b);

  // Read directory to count used blocks
  const dirData = new Uint8Array(dirBlocks * geom.blockSize);
  for (let b = 0; b < dirBlocks; b++) {
    const block = readBlock(data, b, geom);
    if (block) dirData.set(block, b * geom.blockSize);
  }
  for (let i = 0; i < geom.dirEntries; i++) {
    if (dirData[i * 32] === 0xE5) continue;
    for (let j = 16; j < 32; j++) {
      const b = dirData[i * 32 + j];
      if (b !== 0) usedBlocks.add(b);
    }
  }

  const totalBlocks = geom.totalBlocks;
  const used = usedBlocks.size;
  const free = totalBlocks - used;

  return {
    totalBlocks,
    usedBlocks: used,
    freeBlocks: free,
    totalKb: totalBlocks * geom.blockSize / 1024,
    usedKb: used * geom.blockSize / 1024,
    freeKb: free * geom.blockSize / 1024,
    fileCount: files.length,
  };
}
