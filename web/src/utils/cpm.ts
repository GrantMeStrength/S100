/**
 * CP/M boot helpers: generates hand-crafted 8080 machine code for
 * a minimal BIOS (6 bytes at 0xFA00) and minimal CCP (at 0xDC00).
 *
 * Memory map:
 *   0x0000 - 0x0002  JMP 0xFA00 (written by bootCpm after loadMachine)
 *   0x0005           BDOS entry (intercepted by CPU trap; no code needed)
 *   0xDC00 - 0xDFFF  CCP + CMDBUF (0xDF00)
 *   0xFA00 - 0xFA05  Minimal BIOS
 */

// ── BIOS (6 bytes) ─────────────────────────────────────────────────────────────
// LXI SP, 0xEFFF   →  31 FF EF
// JMP 0xDC00       →  C3 00 DC

export function buildBios(): Uint8Array {
  return new Uint8Array([
    0x31, 0xFF, 0xEF,  // LXI SP, 0xEFFF  — set stack safely away from DMA area
    0xC3, 0x00, 0xDC,  // JMP 0xDC00      — jump to CCP
  ]);
}

// ── Boot vector (3 bytes at 0x0000) ───────────────────────────────────────────
// JMP 0xFA00  →  C3 00 FA

export function buildBootVector(): Uint8Array {
  return new Uint8Array([0xC3, 0x00, 0xFA]);
}

// ── Minimal CCP (8080 machine code, loads at 0xDC00) ─────────────────────────
// Implements:
//   1. Print "\r\nA> " prompt
//   2. BDOS fn 10 (readline) into buffer at 0xDF00
//   3. If empty line → loop to 1
//   4. Else print "\r\n?\r\n" and loop to 1

const BDOS = 0x0005;
const CMDBUF = 0xDF00;
const CCP_BASE = 0xDC00;

export function buildCcp(): Uint8Array {
  const code: number[] = [];
  const emit = (...bytes: number[]) => code.push(...bytes);

  // Helper: emit BDOS CONOUT (fn 2) for a single char
  const conout = (ch: number) => {
    emit(0x0E, 0x02);                        // MVI C, 2
    emit(0x1E, ch);                          // MVI E, ch
    emit(0xCD, BDOS & 0xFF, BDOS >> 8);      // CALL BDOS
  };

  // ── Prompt loop ────────────────────────────────────────────────────────────
  const promptOffset = code.length;  // = 0 (start of CCP)

  // Print \r\n
  conout(0x0D);
  conout(0x0A);

  // Print "A> "
  conout(0x41);  // A
  conout(0x3E);  // >
  conout(0x20);  // space

  // Set up CMDBUF max-len byte then call BDOS fn 10 (readline)
  emit(0x3E, 126);                                       // MVI A, 126
  emit(0x32, CMDBUF & 0xFF, CMDBUF >> 8);               // STA CMDBUF
  emit(0x0E, 0x0A);                                      // MVI C, 10
  emit(0x11, CMDBUF & 0xFF, CMDBUF >> 8);               // LXI D, CMDBUF
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);                   // CALL BDOS

  // Check if line is empty (actual length at CMDBUF+1)
  emit(0x3A, (CMDBUF + 1) & 0xFF, (CMDBUF + 1) >> 8);  // LDA CMDBUF+1
  emit(0xB7);                                            // ORA A
  const jzPatchAt = code.length;
  emit(0xCA, 0x00, 0x00);                               // JZ prompt (patched below)

  // Unknown command: print "\r\n?\r\n"
  conout(0x0D);
  conout(0x0A);
  conout(0x3F);  // ?
  conout(0x0D);
  conout(0x0A);

  // JMP back to prompt
  const promptAbs = CCP_BASE + promptOffset;
  emit(0xC3, promptAbs & 0xFF, promptAbs >> 8);

  // Patch the JZ forward reference
  code[jzPatchAt + 1] = promptAbs & 0xFF;
  code[jzPatchAt + 2] = promptAbs >> 8;

  return new Uint8Array(code);
}
