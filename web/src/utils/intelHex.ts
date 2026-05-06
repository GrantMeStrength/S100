// Intel HEX format parser
//
// Supports record types:
//   00  Data
//   01  End of File
//   02  Extended Segment Address (shifts base by value << 4)
//   03  Start Segment Address    (CS:IP — low 16 bits give start IP)
//   04  Extended Linear Address  (shifts base by value << 16)
//   05  Start Linear Address     (32-bit EIP — low 16 bits used)

export interface HexSegment {
  address: number;   // absolute load address (16-bit for 8080)
  data: Uint8Array;
}

export interface HexFile {
  segments: HexSegment[];
  startAddress?: number;  // execution start address, if specified
}

export interface HexParseError {
  line: number;
  message: string;
}

export type HexParseResult =
  | { ok: true;  file: HexFile }
  | { ok: false; error: HexParseError };

export function parseIntelHex(text: string): HexParseResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const segments: HexSegment[] = [];
  let startAddress: number | undefined;
  let extBase = 0;  // extended address base (from type 02 or 04)
  let eofSeen = false;

  // Working buffer: accumulate contiguous data runs
  let curAddr = -1;
  let curBuf: number[] = [];

  function flushBuf() {
    if (curBuf.length > 0 && curAddr >= 0) {
      segments.push({ address: curAddr & 0xFFFF, data: new Uint8Array(curBuf) });
      curBuf = [];
      curAddr = -1;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    if (eofSeen) continue;

    if (raw[0] !== ':') {
      return { ok: false, error: { line: i + 1, message: `Expected ':' at start of record` } };
    }

    const hex = raw.slice(1);
    if (hex.length < 10 || hex.length % 2 !== 0) {
      return { ok: false, error: { line: i + 1, message: `Malformed record length` } };
    }

    const bytes: number[] = [];
    for (let b = 0; b < hex.length; b += 2) {
      bytes.push(parseInt(hex.slice(b, b + 2), 16));
    }

    // Verify checksum: sum of all bytes mod 256 must be 0
    const sum = bytes.reduce((a, b) => a + b, 0) & 0xFF;
    if (sum !== 0) {
      return { ok: false, error: { line: i + 1, message: `Checksum error (got 0x${sum.toString(16).padStart(2,'0')})` } };
    }

    const byteCount  = bytes[0];
    const address    = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data       = bytes.slice(4, 4 + byteCount);

    switch (recordType) {
      case 0x00: { // Data
        const absAddr = (extBase + address) & 0xFFFF;
        // If contiguous with current buffer, append; otherwise flush and start new
        if (curAddr >= 0 && absAddr === (curAddr + curBuf.length)) {
          curBuf.push(...data);
        } else {
          flushBuf();
          curAddr = absAddr;
          curBuf.push(...data);
        }
        break;
      }
      case 0x01: // End of File
        eofSeen = true;
        flushBuf();
        break;
      case 0x02: // Extended Segment Address
        flushBuf();
        extBase = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x03: // Start Segment Address (CS:IP)
        // For 8080 we only care about the 16-bit IP offset
        startAddress = (data[2] << 8) | data[3];
        break;
      case 0x04: // Extended Linear Address
        flushBuf();
        extBase = ((data[0] << 8) | data[1]) << 16;
        break;
      case 0x05: // Start Linear Address (EIP)
        startAddress = ((data[2] << 8) | data[3]) & 0xFFFF;
        break;
      default:
        // Unknown record types are ignored (forward compatibility)
        break;
    }
  }

  // Flush any trailing data even if EOF record was missing
  flushBuf();

  return { ok: true, file: { segments, startAddress } };
}

/** Format a load summary for display in the UI */
export function hexLoadSummary(file: HexFile): string {
  const totalBytes = file.segments.reduce((s, seg) => s + seg.data.length, 0);
  const ranges = file.segments
    .map(seg => `$${seg.address.toString(16).toUpperCase().padStart(4,'0')}–$${(seg.address + seg.data.length - 1).toString(16).toUpperCase().padStart(4,'0')}`)
    .join(', ');
  const startStr = file.startAddress !== undefined
    ? ` · Start: $${file.startAddress.toString(16).toUpperCase().padStart(4,'0')}`
    : '';
  return `Loaded ${totalBytes} bytes at ${ranges}${startStr}`;
}
