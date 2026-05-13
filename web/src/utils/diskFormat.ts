/**
 * Disk image format detector and normalizer.
 *
 * Converts recognized formats to the flat raw layout expected by the FDC
 * emulator: (track * SPT + (sectorId - 1)) * SECTOR_SIZE.
 *
 * Standard 8-inch SD geometry: 77 tracks × 26 sectors × 128 bytes = 256,256 bytes.
 */

// ── Geometry constants ─────────────────────────────────────────────────────────

const TRACKS = 77;
const SPT    = 26;            // sectors per track (CP/M 8-inch SD)
const SS     = 128;           // sector size in bytes

export const RAW_FLAT_SIZE = TRACKS * SPT * SS;           // 256,256
export const DCDD_SIZE     = 77 * 32 * 137;               // 337,568 (Altair 88-DCDD)
export const DCDD_SIZE_96  = DCDD_SIZE + 96;               // 337,664 (SIMH Altair format — 96-byte preamble)

// ── Types ──────────────────────────────────────────────────────────────────────

export type DiskFormatType = 'raw' | 'imd' | 'dcdd' | 'td0' | 'unknown';

export interface NormalizeResult {
  data:        Uint8Array;
  formatType:  DiskFormatType;
  formatLabel: string;          // short human-readable label, e.g. "IMD", "RAW", "88-DCDD"
  warnings:    string[];
  error?:      string;          // non-null if the format was detected but could not be decoded
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detects the disk image format and normalizes it to a flat raw image.
 *
 * @param controllerType  Optional hint about which FDC is active in the
 *   machine, used to generate controller-mismatch warnings:
 *   - 'dcdd'  → expects 88-DCDD 137-byte sector images
 *   - 'flat'  → expects flat 128-byte sector images (FIF, WD1793, legacy FDC)
 */
export function normalizeDiskImage(
  input: Uint8Array,
  controllerType?: 'dcdd' | 'flat',
): NormalizeResult {

  // ── IMD: "IMD " magic at byte 0 ─────────────────────────────────────────────
  if (
    input.length >= 4 &&
    input[0] === 0x49 && input[1] === 0x4D &&
    input[2] === 0x44 && input[3] === 0x20
  ) {
    return decodeIMD(input, controllerType);
  }

  // ── TD0 (Teledisk): "TD" or "td" magic ──────────────────────────────────────
  if (
    input.length >= 2 &&
    (input[0] === 0x54 || input[0] === 0x74) && input[1] === 0x44
  ) {
    return {
      data:        input,
      formatType:  'td0',
      formatLabel: 'Teledisk (TD0)',
      warnings:    [],
      error: 'TD0 (Teledisk) format is not currently supported. ' +
             'Please convert with ImageDisk (imd2td0 tool) or HxCFloppyEmulator.',
    };
  }

  // ── 88-DCDD: 337,568 or 337,664 bytes (SIMH adds a 96-byte preamble) ──────
  if (input.length === DCDD_SIZE || input.length === DCDD_SIZE_96) {
    const warnings: string[] = [];
    if (controllerType === 'flat') {
      warnings.push(
        'This image uses the 88-DCDD hard-sector format (137-byte sectors) ' +
        'and is only compatible with machines using the MITS 88-DCDD disk controller. ' +
        'Your machine uses a different FDC — this disk may not load correctly.',
      );
    }
    return {
      data:        input,
      formatType:  'dcdd',
      formatLabel: '88-DCDD',
      warnings,
    };
  }

  // ── Raw flat ─────────────────────────────────────────────────────────────────
  const warnings: string[] = [];

  if (controllerType === 'dcdd' && input.length !== DCDD_SIZE) {
    warnings.push(
      `The 88-DCDD controller expects images of exactly ${DCDD_SIZE} bytes ` +
      `(77 tracks × 32 sectors × 137 bytes). This image is ${input.length} bytes ` +
      'and may not be read correctly.',
    );
  } else if (input.length !== RAW_FLAT_SIZE && controllerType !== 'dcdd') {
    warnings.push(
      `Non-standard image size: ${input.length} bytes ` +
      `(expected ${RAW_FLAT_SIZE} for 8" SD). The disk may load with errors.`,
    );
  }

  return {
    data:        input,
    formatType:  'raw',
    formatLabel: 'RAW',
    warnings,
  };
}

// ── IMD decoder ───────────────────────────────────────────────────────────────

function decodeIMD(input: Uint8Array, controllerType?: 'dcdd' | 'flat'): NormalizeResult {
  const warnings: string[] = [];

  if (controllerType === 'dcdd') {
    warnings.push(
      'This IMD image will be decoded to a flat 77×26×128-byte image. ' +
      'The 88-DCDD controller expects the native 137-byte sector format — ' +
      'the decoded image may not work with the Altair controller.',
    );
  }

  // ── Find end of ASCII header (0x1A = Ctrl-Z / EOF marker) ───────────────────
  let pos = 0;
  while (pos < input.length && input[pos] !== 0x1A) pos++;
  if (pos >= input.length) {
    return {
      data:        input,
      formatType:  'imd',
      formatLabel: 'IMD',
      warnings,
      error: 'IMD: header terminator (0x1A) not found — file may be corrupt.',
    };
  }
  pos++; // skip 0x1A

  const flat         = new Uint8Array(RAW_FLAT_SIZE);
  let   sectorsPlaced = 0;
  let   skippedSectors = 0;

  // ── Parse per-track records ──────────────────────────────────────────────────
  while (pos < input.length) {
    if (pos + 5 > input.length) break; // truncated track header

    const _mode      = input[pos++]; // density/speed — not needed for layout
    const cylinder   = input[pos++];
    const headField  = input[pos++];
    const sectorCount = input[pos++];
    const sizeCode   = input[pos++];

    const headSide   = headField & 0x01;
    const hasCylMap  = (headField & 0x80) !== 0;
    const hasHeadMap = (headField & 0x40) !== 0;
    const sectorBytes = 128 << sizeCode; // 0→128, 1→256, 2→512 …

    // Validate bounds
    if (pos + sectorCount > input.length) {
      warnings.push(`Track ${cylinder}: sector map truncated — stopping decode.`);
      break;
    }

    // Sector ID map
    const sectorMap = input.slice(pos, pos + sectorCount);
    pos += sectorCount;

    // Optional per-sector cylinder override map
    let cylMap: Uint8Array | null = null;
    if (hasCylMap) {
      if (pos + sectorCount > input.length) break;
      cylMap = input.slice(pos, pos + sectorCount);
      pos   += sectorCount;
    }

    // Optional per-sector head override map (skip — we discard side 1)
    if (hasHeadMap) {
      if (pos + sectorCount > input.length) break;
      pos += sectorCount;
    }

    // ── Read each sector's data record ────────────────────────────────────────
    for (let s = 0; s < sectorCount; s++) {
      if (pos >= input.length) break;

      const recType = input[pos++];

      // Determine actual cylinder from per-sector map if present
      const effectiveCyl = cylMap ? cylMap[s] : cylinder;
      const sectorId     = sectorMap[s];

      if (recType === 0) {
        // Sector unavailable — no data bytes follow
        warnings.push(`Track ${effectiveCyl} sector ${sectorId}: unavailable (skipped).`);
        skippedSectors++;
        continue;
      }

      // Read data bytes (compressed or raw)
      let sectorData: Uint8Array;
      const isCompressed = (recType % 2 === 0);

      if (isCompressed) {
        if (pos >= input.length) break;
        const fill = input[pos++];
        sectorData  = new Uint8Array(sectorBytes).fill(fill);
      } else {
        if (pos + sectorBytes > input.length) {
          warnings.push(`Track ${effectiveCyl} sector ${sectorId}: data truncated.`);
          break;
        }
        sectorData = input.subarray(pos, pos + sectorBytes);
        pos       += sectorBytes;
      }

      // Warn on deleted / error sectors but still copy the data
      if (recType >= 3) {
        warnings.push(
          `Track ${effectiveCyl} sector ${sectorId}: ` +
          (recType >= 5 ? 'read error' : 'deleted') +
          ' sector — data copied anyway.',
        );
      }

      // ── Place into flat image ────────────────────────────────────────────────

      // Skip double-sided (side 1+) tracks
      if (headSide !== 0) { skippedSectors++; continue; }

      // Skip out-of-range tracks or sectors
      if (effectiveCyl >= TRACKS || sectorId < 1 || sectorId > SPT) {
        skippedSectors++;
        continue;
      }

      // Only support 128-byte sectors (standard 8-inch SD)
      if (sectorBytes !== SS) {
        warnings.push(
          `Track ${effectiveCyl} sector ${sectorId}: ` +
          `sector size ${sectorBytes} bytes is not 128 — skipped.`,
        );
        skippedSectors++;
        continue;
      }

      const offset = (effectiveCyl * SPT + (sectorId - 1)) * SS;
      flat.set(sectorData, offset);
      sectorsPlaced++;
    }
  }

  // ── Summary warning if large number of sectors were skipped ─────────────────
  const totalExpected = TRACKS * SPT;
  if (skippedSectors > 0) {
    warnings.push(
      `${skippedSectors} sector(s) were skipped (out-of-range, wrong size, or double-sided).`,
    );
  }
  if (sectorsPlaced < totalExpected / 2) {
    warnings.push(
      `Only ${sectorsPlaced}/${totalExpected} sectors placed — ` +
      'this image may not match the expected 77×26×128 (8" SD) geometry.',
    );
  }

  warnings.unshift(`Decoded from ImageDisk (IMD) → ${sectorsPlaced}/${totalExpected} sectors placed.`);

  return {
    data:        flat,
    formatType:  'imd',
    formatLabel: 'IMD',
    warnings,
  };
}
