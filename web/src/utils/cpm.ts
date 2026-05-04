/**
 * CP/M boot helpers — 8080 machine code for a minimal BIOS and full CCP.
 *
 * Memory map:
 *   0x0000–0x0002  JMP 0xFA00  (boot vector)
 *   0x0005         BDOS entry  (intercepted by CPU trap)
 *   0x0080         command tail length byte (written by CCP before transient launch)
 *   0xDC00–0xDEFF  CCP code (~700 bytes)
 *   0xDF00–0xDF23  FCB  (36 bytes)
 *   0xDF24         COL_CTR  (DIR column counter)
 *   0xDF25–0xDF26  LOAD_PTR (transient load-address scratch: lo, hi)
 *   0xDF40–0xDFBF  DMA buffer (128 bytes, 128-byte aligned)
 *   0xE000–0xE07F  CMDBUF
 *   0xFA00–0xFA05  Minimal BIOS
 */

const BDOS     = 0x0005;
const FCB      = 0xDF00;   // File Control Block (36 bytes)
const DMA      = 0xDF40;   // 128-byte DMA / sector buffer
const COL_CTR  = 0xDF24;   // 1-byte column counter for DIR (0–3)
const LOAD_PTR = 0xDF25;   // 2-byte transient load address (lo at +0, hi at +1)
const CMDBUF   = 0xE000;   // console input buffer
const CCP_BASE = 0xDC00;

// ── BIOS ───────────────────────────────────────────────────────────────────────

/** 6-byte BIOS stub: set up stack, jump to CCP. */
export function buildBios(): Uint8Array {
  return new Uint8Array([
    0x31, 0xFF, 0xEF,  // LXI SP, 0xEFFF
    0xC3, 0x00, 0xDC,  // JMP 0xDC00 (CCP entry)
  ]);
}

/** 3-byte boot vector written at 0x0000. */
export function buildBootVector(): Uint8Array {
  return new Uint8Array([0xC3, 0x00, 0xFA]);
}

// ── CCP ────────────────────────────────────────────────────────────────────────

/**
 * Builds a full CCP that handles DIR, TYPE, ERA, and transient .COM loading.
 *
 * Layout inside 0xDC00–0xDEFF:
 *   0xDC00  JMP CCP_START          (skip over PRINT_CHAR subroutine)
 *   0xDC03  PRINT_CHAR             (A = char → BDOS fn 2, preserves HL/BC)
 *   0xDC0E  CCP_START              (set DMA, fall into PROMPT_LOOP)
 *   …       PROMPT_LOOP / dispatch / DO_DIR / DO_TYPE / DO_ERA / TRAN_LOAD
 */
export function buildCcp(): Uint8Array {
  const code: number[] = [];
  const labels: Record<string, number> = {};
  const fixups: Array<{ at: number; lbl: string }> = [];

  function here(): number { return CCP_BASE + code.length; }
  function emit(...bytes: number[]) { code.push(...bytes); }
  function mark(name: string) { labels[name] = here(); }

  /** Emit 2-byte little-endian placeholder and record a fixup. */
  function ref16(name: string) {
    fixups.push({ at: code.length, lbl: name });
    emit(0, 0);
  }

  function JMP(lbl: string)  { emit(0xC3); ref16(lbl); }
  function CALL(lbl: string) { emit(0xCD); ref16(lbl); }
  function JZ(lbl: string)   { emit(0xCA); ref16(lbl); }
  function JNZ(lbl: string)  { emit(0xC2); ref16(lbl); }
  function JC(lbl: string)   { emit(0xDA); ref16(lbl); }
  function JNC(lbl: string)  { emit(0xD2); ref16(lbl); }

  // ── 0xDC00: JMP CCP_START ─────────────────────────────────────────────────
  JMP('CCP_START');

  // ── 0xDC03: PRINT_CHAR (A = char to print) ────────────────────────────────
  mark('PRINT_CHAR');
  emit(0xE5);                             // PUSH H
  emit(0xC5);                             // PUSH B
  emit(0x0E, 0x02);                       // MVI C, 2  (CONOUT)
  emit(0x5F);                             // MOV E, A  (char in E)
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);    // CALL BDOS
  emit(0xC1);                             // POP B
  emit(0xE1);                             // POP H
  emit(0xC9);                             // RET

  // ── CCP_START: set DMA to 0xDE40, fall into PROMPT_LOOP ──────────────────
  mark('CCP_START');
  emit(0x0E, 26);                         // MVI C, 26  (SET_DMA)
  emit(0x11, DMA & 0xFF, DMA >> 8);      // LXI D, DMA
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);    // CALL BDOS

  // ── PROMPT_LOOP ───────────────────────────────────────────────────────────
  mark('PROMPT_LOOP');

  // Print "\r\nA> "
  emit(0x3E, 0x0D); CALL('PRINT_CHAR');
  emit(0x3E, 0x0A); CALL('PRINT_CHAR');
  emit(0x3E, 0x41); CALL('PRINT_CHAR');  // 'A'
  emit(0x3E, 0x3E); CALL('PRINT_CHAR');  // '>'
  emit(0x3E, 0x20); CALL('PRINT_CHAR');  // ' '

  // BDOS fn 10 (readline) into CMDBUF
  emit(0x3E, 126);                                        // MVI A, 126
  emit(0x32, CMDBUF & 0xFF, CMDBUF >> 8);                // STA CMDBUF
  emit(0x0E, 0x0A);                                       // MVI C, 10
  emit(0x11, CMDBUF & 0xFF, CMDBUF >> 8);                // LXI D, CMDBUF
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);                    // CALL BDOS

  // Uppercase the input; CMDBUF+1 = actual length, CMDBUF+2 = first char
  emit(0x21, (CMDBUF + 1) & 0xFF, (CMDBUF + 1) >> 8);   // LXI H, CMDBUF+1
  emit(0x4E);                                             // MOV C, M  (length)
  emit(0x23);                                             // INX H  → CMDBUF+2
  emit(0x79);                                             // MOV A, C
  emit(0xB7);                                             // ORA A  (0 = empty)
  JZ('PROMPT_LOOP');

  mark('UCASE_LOOP');
  emit(0x7E);                 // MOV A, M
  emit(0xFE, 0x61); JC('UCASE_NEXT');   // CPI 'a', JC (< 'a')
  emit(0xFE, 0x7B); JNC('UCASE_NEXT'); // CPI 'z'+1, JNC (> 'z')
  emit(0xE6, 0xDF);           // ANI 0xDF  (clear bit 5 → uppercase)
  emit(0x77);                 // MOV M, A
  mark('UCASE_NEXT');
  emit(0x23);                 // INX H
  emit(0x0D);                 // DCR C
  JNZ('UCASE_LOOP');
  emit(0x36, 0x00);           // MVI M, 0  (null-terminate)

  // ── Command dispatch: "DIR" ───────────────────────────────────────────────
  // Match D-I-R at CMDBUF+2,3,4 then check CMDBUF+5 is null or space.
  emit(0x3A, (CMDBUF + 2) & 0xFF, (CMDBUF + 2) >> 8); // LDA CMDBUF+2
  emit(0xFE, 0x44); JNZ('CHK_TYPE');                   // CPI 'D'
  emit(0x3A, (CMDBUF + 3) & 0xFF, (CMDBUF + 3) >> 8); // LDA CMDBUF+3
  emit(0xFE, 0x49); JNZ('CHK_TYPE');                   // CPI 'I'
  emit(0x3A, (CMDBUF + 4) & 0xFF, (CMDBUF + 4) >> 8); // LDA CMDBUF+4
  emit(0xFE, 0x52); JNZ('CHK_TYPE');                   // CPI 'R'
  emit(0x3A, (CMDBUF + 5) & 0xFF, (CMDBUF + 5) >> 8); // LDA CMDBUF+5
  emit(0xB7); JZ('DO_DIR');                             // ORA A  (null = end)
  emit(0xFE, 0x20); JZ('DO_DIR');                       // CPI ' '
  // Fall through to CHK_TYPE (e.g. "DIRECTORY" → not a match)

  // ── Command dispatch: "TYPE " ─────────────────────────────────────────────
  mark('CHK_TYPE');
  emit(0x3A, (CMDBUF + 2) & 0xFF, (CMDBUF + 2) >> 8); // LDA CMDBUF+2
  emit(0xFE, 0x54); JNZ('CHK_ERA');                    // CPI 'T'
  emit(0x3A, (CMDBUF + 3) & 0xFF, (CMDBUF + 3) >> 8); // LDA CMDBUF+3
  emit(0xFE, 0x59); JNZ('CHK_ERA');                    // CPI 'Y'
  emit(0x3A, (CMDBUF + 4) & 0xFF, (CMDBUF + 4) >> 8); // LDA CMDBUF+4
  emit(0xFE, 0x50); JNZ('CHK_ERA');                    // CPI 'P'
  emit(0x3A, (CMDBUF + 5) & 0xFF, (CMDBUF + 5) >> 8); // LDA CMDBUF+5
  emit(0xFE, 0x45); JNZ('CHK_ERA');                    // CPI 'E'
  emit(0x3A, (CMDBUF + 6) & 0xFF, (CMDBUF + 6) >> 8); // LDA CMDBUF+6
  emit(0xFE, 0x20); JZ('DO_TYPE');                     // CPI ' '
  JMP('CHK_ERA');

  // ── Command dispatch: "ERA " (erase files) ───────────────────────────────
  mark('CHK_ERA');
  emit(0x3A, (CMDBUF + 2) & 0xFF, (CMDBUF + 2) >> 8); // LDA CMDBUF+2
  emit(0xFE, 0x45); JNZ('TRAN_LOAD');                  // CPI 'E'
  emit(0x3A, (CMDBUF + 3) & 0xFF, (CMDBUF + 3) >> 8); // LDA CMDBUF+3
  emit(0xFE, 0x52); JNZ('TRAN_LOAD');                  // CPI 'R'
  emit(0x3A, (CMDBUF + 4) & 0xFF, (CMDBUF + 4) >> 8); // LDA CMDBUF+4
  emit(0xFE, 0x41); JNZ('TRAN_LOAD');                  // CPI 'A'
  emit(0x3A, (CMDBUF + 5) & 0xFF, (CMDBUF + 5) >> 8); // LDA CMDBUF+5
  emit(0xFE, 0x20); JNZ('TRAN_LOAD');                  // CPI ' '
  emit(0x3A, (CMDBUF + 6) & 0xFF, (CMDBUF + 6) >> 8); // LDA CMDBUF+6
  emit(0xB7); JZ('TRAN_LOAD');                          // ORA A → no filename

  mark('DO_ERA');
  // Zero FCB
  emit(0x21, FCB & 0xFF, FCB >> 8);                     // LXI H, FCB
  emit(0x06, 36);                                         // MVI B, 36
  mark('ERA_FCB_CLR');
  emit(0x36, 0x00); emit(0x23); emit(0x05); JNZ('ERA_FCB_CLR');
  // Space-pad FCB[1..11]
  emit(0x21, (FCB + 1) & 0xFF, (FCB + 1) >> 8);        // LXI H, FCB+1
  emit(0x06, 11);                                         // MVI B, 11
  mark('ERA_FCB_SP');
  emit(0x36, 0x20); emit(0x23); emit(0x05); JNZ('ERA_FCB_SP');
  // Parse name from CMDBUF+6 into FCB[1..8]
  emit(0x21, (CMDBUF + 6) & 0xFF, (CMDBUF + 6) >> 8);  // LXI H, CMDBUF+6
  emit(0x11, (FCB + 1) & 0xFF, (FCB + 1) >> 8);         // LXI D, FCB+1
  emit(0x06, 8);                                          // MVI B, 8
  mark('ERA_NAME');
  emit(0x7E);                               // MOV A, M
  emit(0xB7); JZ('ERA_OPEN');              // ORA A → null
  emit(0xFE, 0x2E); JZ('ERA_EXT_START');  // CPI '.'
  emit(0xFE, 0x20); JZ('ERA_OPEN');       // CPI ' '
  emit(0x12); emit(0x23); emit(0x13); emit(0x05); JNZ('ERA_NAME');
  mark('ERA_SKIP_DOT');
  emit(0x7E); emit(0xB7); JZ('ERA_OPEN');        // null
  emit(0xFE, 0x2E); JZ('ERA_EXT_START');          // '.'
  emit(0x23); JMP('ERA_SKIP_DOT');                 // INX H; loop
  mark('ERA_EXT_START');
  emit(0x23);                                       // INX H (skip '.')
  emit(0x11, (FCB + 9) & 0xFF, (FCB + 9) >> 8);  // LXI D, FCB+9
  emit(0x06, 3);                                    // MVI B, 3
  mark('ERA_EXT');
  emit(0x7E); emit(0xB7); JZ('ERA_OPEN');
  emit(0xFE, 0x20); JZ('ERA_OPEN');
  emit(0x12); emit(0x23); emit(0x13); emit(0x05); JNZ('ERA_EXT');
  mark('ERA_OPEN');
  emit(0x0E, 19);                                // MVI C, 19 (ERASE)
  emit(0x11, FCB & 0xFF, FCB >> 8);             // LXI D, FCB
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);           // CALL BDOS
  JMP('PROMPT_LOOP');

  // ════════════════════════════════════════════════════════════════════════════
  // TRAN_LOAD — parse command as NAME.COM, load into TPA, jump to 0x0100
  // ════════════════════════════════════════════════════════════════════════════
  mark('TRAN_LOAD');
  // Zero FCB
  emit(0x21, FCB & 0xFF, FCB >> 8);                     // LXI H, FCB
  emit(0x06, 36);                                         // MVI B, 36
  mark('TRAN_FCB_CLR');
  emit(0x36, 0x00); emit(0x23); emit(0x05); JNZ('TRAN_FCB_CLR');
  // Space-pad FCB[1..11]
  emit(0x21, (FCB + 1) & 0xFF, (FCB + 1) >> 8);        // LXI H, FCB+1
  emit(0x06, 11);                                         // MVI B, 11
  mark('TRAN_FCB_SP');
  emit(0x36, 0x20); emit(0x23); emit(0x05); JNZ('TRAN_FCB_SP');
  // Copy command name from CMDBUF+2 into FCB[1..8] (stop at space/null)
  emit(0x21, (CMDBUF + 2) & 0xFF, (CMDBUF + 2) >> 8);  // LXI H, CMDBUF+2
  emit(0x11, (FCB + 1) & 0xFF, (FCB + 1) >> 8);         // LXI D, FCB+1
  emit(0x06, 8);                                          // MVI B, 8
  mark('TRAN_NAME');
  emit(0x7E);                               // MOV A, M
  emit(0xB7); JZ('TRAN_EXT');             // ORA A → null
  emit(0xFE, 0x20); JZ('TRAN_EXT');      // CPI ' '
  emit(0x12); emit(0x23); emit(0x13); emit(0x05); JNZ('TRAN_NAME');
  mark('TRAN_EXT');
  // FCB[9..11] = "COM"
  emit(0x21, (FCB + 9) & 0xFF, (FCB + 9) >> 8);        // LXI H, FCB+9
  emit(0x36, 0x43); emit(0x23);                          // MVI M,'C'; INX H
  emit(0x36, 0x4F); emit(0x23);                          // MVI M,'O'; INX H
  emit(0x36, 0x4D);                                      // MVI M,'M'
  // Open file (BDOS fn 15)
  emit(0x0E, 15);                                        // MVI C, 15
  emit(0x11, FCB & 0xFF, FCB >> 8);                     // LXI D, FCB
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);                   // CALL BDOS
  emit(0xFE, 0xFF); JZ('TRAN_NOT_FOUND');                // CPI 0xFF; JZ → not found
  // Init load pointer: lo=0x00, hi=0x01 → starts at 0x0100
  emit(0x3E, 0x00); emit(0x32, LOAD_PTR & 0xFF, LOAD_PTR >> 8);
  emit(0x3E, 0x01); emit(0x32, (LOAD_PTR + 1) & 0xFF, (LOAD_PTR + 1) >> 8);
  mark('TRAN_LOOP');
  // Set DMA = load pointer (DE = hi:lo)
  emit(0x0E, 26);                                                          // MVI C, 26
  emit(0x3A, LOAD_PTR & 0xFF, LOAD_PTR >> 8); emit(0x5F);                // LDA lo; MOV E, A
  emit(0x3A, (LOAD_PTR + 1) & 0xFF, (LOAD_PTR + 1) >> 8); emit(0x57);  // LDA hi; MOV D, A
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);                                     // CALL BDOS
  // Read sequential
  emit(0x0E, 20);                                // MVI C, 20
  emit(0x11, FCB & 0xFF, FCB >> 8);             // LXI D, FCB
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);           // CALL BDOS
  emit(0xB7); JNZ('TRAN_RUN');                   // ORA A; JNZ → EOF
  // Advance load pointer by 0x80
  emit(0x3A, LOAD_PTR & 0xFF, LOAD_PTR >> 8);            // LDA lo
  emit(0xC6, 0x80);                                        // ADI 0x80
  emit(0x32, LOAD_PTR & 0xFF, LOAD_PTR >> 8);             // STA lo
  JNC('TRAN_LOOP');                                         // no carry → loop
  emit(0x3A, (LOAD_PTR + 1) & 0xFF, (LOAD_PTR + 1) >> 8); // LDA hi
  emit(0x3C);                                               // INR A
  emit(0x32, (LOAD_PTR + 1) & 0xFF, (LOAD_PTR + 1) >> 8); // STA hi
  JMP('TRAN_LOOP');
  mark('TRAN_RUN');
  // Reset DMA to standard buffer; zero command tail; jump to TPA
  emit(0x0E, 26);                                // MVI C, 26
  emit(0x11, DMA & 0xFF, DMA >> 8);             // LXI D, DMA
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);           // CALL BDOS
  emit(0x3E, 0x00); emit(0x32, 0x80, 0x00);    // MVI A,0; STA 0x0080 (empty tail)
  emit(0xC3, 0x00, 0x01);                        // JMP 0x0100
  mark('TRAN_NOT_FOUND');
  emit(0x3E, 0x3F); CALL('PRINT_CHAR');          // '?'
  emit(0x3E, 0x0D); CALL('PRINT_CHAR');
  emit(0x3E, 0x0A); CALL('PRINT_CHAR');
  JMP('PROMPT_LOOP');

  // ════════════════════════════════════════════════════════════════════════════
  // DO_DIR — wildcard directory listing
  // ════════════════════════════════════════════════════════════════════════════
  mark('DO_DIR');

  // FCB[0] = 0 (current drive); also zero the column counter
  emit(0x3E, 0x00);
  emit(0x32, FCB & 0xFF, FCB >> 8);                    // STA FCB
  emit(0x32, COL_CTR & 0xFF, COL_CTR >> 8);            // STA COL_CTR

  // FCB[1..11] = '?' (wildcard)
  emit(0x21, (FCB + 1) & 0xFF, (FCB + 1) >> 8); // LXI H, FCB+1
  emit(0x06, 11);                                 // MVI B, 11
  mark('DIR_WILD_LOOP');
  emit(0x36, 0x3F);                               // MVI M, '?'
  emit(0x23);                                     // INX H
  emit(0x05);                                     // DCR B
  JNZ('DIR_WILD_LOOP');

  // FCB[12..15] = 0 (EX/S1/S2/RC)
  emit(0x06, 4);                                  // MVI B, 4
  mark('DIR_CLR_LOOP');
  emit(0x36, 0x00);                               // MVI M, 0
  emit(0x23);                                     // INX H
  emit(0x05);                                     // DCR B
  JNZ('DIR_CLR_LOOP');

  // BDOS fn 17 (Search First)
  emit(0x0E, 17);
  emit(0x11, FCB & 0xFF, FCB >> 8);
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);
  emit(0xFE, 0xFF); JZ('DIR_DONE');  // 0xFF = no files

  // ── DIR_ENTRY_LOOP: A = entry index in DMA block (0–3) ──────────────────
  mark('DIR_ENTRY_LOOP');

  // Compute HL = DMA + A*32  (5× ADD A = left-shift by 5)
  emit(0x87); emit(0x87); emit(0x87); emit(0x87); emit(0x87); // ADD A ×5
  emit(0x21, DMA & 0xFF, DMA >> 8);  // LXI H, DMA
  emit(0x85);                         // ADD L
  emit(0x6F);                         // MOV L, A
  JNC('DIR_CHECK_EX');
  emit(0x24);                         // INR H  (carry)
  mark('DIR_CHECK_EX');

  // Check EX byte (offset 12 from entry base); skip entry if EX != 0
  emit(0xE5);            // PUSH H
  emit(0x01, 12, 0);     // LXI B, 12
  emit(0x09);            // DAD B
  emit(0x7E);            // MOV A, M  (EX byte)
  emit(0xE1);            // POP H
  emit(0xB7);            // ORA A
  JNZ('DIR_SKIP');       // EX != 0 → higher extent, skip

  // Skip status byte; check name[0] – blank names are empty/deleted slots
  emit(0x23);            // INX H  (skip status → HL = name[0])
  emit(0x7E);            // MOV A, M
  emit(0xE6, 0x7F);      // ANI 0x7F
  emit(0xFE, 0x21); JC('DIR_SKIP');  // char < '!' (null or space) → blank name, skip

  // Print name bytes, stopping at first space (CP/M names have no spaces)
  emit(0x06, 8);         // MVI B, 8
  mark('DIR_NAME_LOOP');
  emit(0x7E);            // MOV A, M
  emit(0xE6, 0x7F);      // ANI 0x7F
  emit(0xFE, 0x21); JC('DIR_NAME_DONE');  // char < '!' → stop (null or space)
  CALL('PRINT_CHAR');
  emit(0x23);            // INX H
  emit(0x05);            // DCR B
  JNZ('DIR_NAME_LOOP');
  JMP('DIR_EXT_CHECK');  // B=0: all 8 chars printed, HL already at entry+9

  // Stopped early: advance HL the remaining B steps to reach entry+9
  mark('DIR_NAME_DONE');
  mark('DIR_NAME_SKIP');
  emit(0x23);            // INX H
  emit(0x05);            // DCR B
  JNZ('DIR_NAME_SKIP');

  // HL is now at entry+9 (first ext byte); print dot+ext only if ext is non-blank
  mark('DIR_EXT_CHECK');
  emit(0x7E);            // MOV A, M  (ext[0])
  emit(0xE6, 0x7F);      // ANI 0x7F
  emit(0xFE, 0x21); JC('DIR_NOEXT');  // char < '!' → no extension (null or space)

  emit(0x3E, 0x2E); CALL('PRINT_CHAR');  // '.'

  // Print up to 3 ext bytes, stopping at first space
  emit(0x06, 3);         // MVI B, 3
  mark('DIR_EXT_LOOP');
  emit(0x7E);            // MOV A, M
  emit(0xE6, 0x7F);      // ANI 0x7F
  emit(0xFE, 0x21); JC('DIR_NOEXT');  // char < '!' → stop (null or space)
  CALL('PRINT_CHAR');
  emit(0x23);            // INX H
  emit(0x05);            // DCR B
  JNZ('DIR_EXT_LOOP');

  mark('DIR_NOEXT');

  // Column counter: increment; CR/LF every 4 files, else print "  " separator
  emit(0x3A, COL_CTR & 0xFF, COL_CTR >> 8);  // LDA COL_CTR
  emit(0x3C);                                  // INR A
  emit(0xFE, 4);                               // CPI 4
  JZ('DIR_NEWLINE');
  emit(0x32, COL_CTR & 0xFF, COL_CTR >> 8);  // STA COL_CTR (1, 2, or 3)
  emit(0x3E, 0x20); CALL('PRINT_CHAR');       // print ' '
  emit(0x3E, 0x20); CALL('PRINT_CHAR');       // print ' '
  JMP('DIR_SKIP');

  mark('DIR_NEWLINE');
  emit(0x3E, 0x00);
  emit(0x32, COL_CTR & 0xFF, COL_CTR >> 8);  // STA COL_CTR (reset to 0)
  emit(0x3E, 0x0D); CALL('PRINT_CHAR');       // '\r'
  emit(0x3E, 0x0A); CALL('PRINT_CHAR');       // '\n'

  mark('DIR_SKIP');
  // BDOS fn 18 (Search Next)
  emit(0x0E, 18);
  emit(0x11, FCB & 0xFF, FCB >> 8);
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);
  emit(0xFE, 0xFF); JZ('DIR_DONE');
  JMP('DIR_ENTRY_LOOP');

  mark('DIR_DONE');
  // Trailing newline if last line was partial (counter > 0)
  emit(0x3A, COL_CTR & 0xFF, COL_CTR >> 8);  // LDA COL_CTR
  emit(0xB7); JZ('PROMPT_LOOP');               // ORA A; JZ (already on new line)
  emit(0x3E, 0x0D); CALL('PRINT_CHAR');
  emit(0x3E, 0x0A); CALL('PRINT_CHAR');
  JMP('PROMPT_LOOP');

  // ════════════════════════════════════════════════════════════════════════════
  // DO_TYPE — display file contents (stops at ^Z or EOF)
  // ════════════════════════════════════════════════════════════════════════════
  mark('DO_TYPE');

  // Guard: filename must be present at CMDBUF+7
  emit(0x3A, (CMDBUF + 7) & 0xFF, (CMDBUF + 7) >> 8); // LDA CMDBUF+7
  emit(0xB7); JZ('TYPE_DONE');  // empty → back to prompt

  // Zero FCB[0..35]
  emit(0x21, FCB & 0xFF, FCB >> 8);  // LXI H, FCB
  emit(0x06, 36);                     // MVI B, 36
  mark('FCB_ZERO_LOOP');
  emit(0x36, 0x00);   // MVI M, 0
  emit(0x23);         // INX H
  emit(0x05);         // DCR B
  JNZ('FCB_ZERO_LOOP');

  // Fill FCB[1..11] = ' ' (space-pad name and extension)
  emit(0x21, (FCB + 1) & 0xFF, (FCB + 1) >> 8); // LXI H, FCB+1
  emit(0x06, 11);     // MVI B, 11
  mark('FCB_SP_LOOP');
  emit(0x36, 0x20);   // MVI M, ' '
  emit(0x23);         // INX H
  emit(0x05);         // DCR B
  JNZ('FCB_SP_LOOP');

  // Parse filename from CMDBUF+7 into FCB[1..11]
  emit(0x21, (CMDBUF + 7) & 0xFF, (CMDBUF + 7) >> 8); // LXI H, CMDBUF+7
  emit(0x11, (FCB + 1) & 0xFF, (FCB + 1) >> 8);        // LXI D, FCB+1
  emit(0x06, 8);      // MVI B, 8  (name chars remaining)

  mark('PARSE_NAME');
  emit(0x7E);                           // MOV A, M
  emit(0xB7);           JZ('TYPE_OPEN');       // null = end of input
  emit(0xFE, 0x2E);    JZ('PARSE_EXT_START'); // '.'
  emit(0xFE, 0x20);    JZ('TYPE_OPEN');       // space = end of filename
  emit(0x12);          // STAX D  (write char to FCB name)
  emit(0x23);          // INX H
  emit(0x13);          // INX D
  emit(0x05);          // DCR B
  JNZ('PARSE_NAME');

  // Name is full (8 chars); skip input until '.' or end
  mark('SKIP_TO_DOT');
  emit(0x7E); emit(0xB7); JZ('TYPE_OPEN');        // null
  emit(0xFE, 0x2E);       JZ('PARSE_EXT_START');  // '.'
  emit(0x23);             JMP('SKIP_TO_DOT');      // INX H

  mark('PARSE_EXT_START');
  emit(0x23);          // INX H  (skip the '.')
  emit(0x11, (FCB + 9) & 0xFF, (FCB + 9) >> 8); // LXI D, FCB+9
  emit(0x06, 3);       // MVI B, 3  (extension chars)

  mark('PARSE_EXT');
  emit(0x7E);                        // MOV A, M
  emit(0xB7);       JZ('TYPE_OPEN'); // null
  emit(0xFE, 0x20); JZ('TYPE_OPEN'); // space
  emit(0x12);       // STAX D
  emit(0x23);       // INX H
  emit(0x13);       // INX D
  emit(0x05);       // DCR B
  JNZ('PARSE_EXT');

  mark('TYPE_OPEN');
  // BDOS fn 15 (Open File)
  emit(0x0E, 15);
  emit(0x11, FCB & 0xFF, FCB >> 8);
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);
  emit(0xFE, 0xFF); JZ('TYPE_NOTFOUND');  // 0xFF = not found

  mark('TYPE_READ_LOOP');
  // BDOS fn 20 (Read Sequential)
  emit(0x0E, 20);
  emit(0x11, FCB & 0xFF, FCB >> 8);
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);
  emit(0xB7); JNZ('TYPE_DONE');  // A != 0 = EOF / error

  // Print 128 bytes from DMA, stopping at ^Z (0x1A)
  emit(0x21, DMA & 0xFF, DMA >> 8); // LXI H, DMA
  emit(0x06, 128);                    // MVI B, 128 (0x80)
  mark('TYPE_PRINT_LOOP');
  emit(0x7E);                         // MOV A, M
  emit(0xFE, 0x1A); JZ('TYPE_DONE'); // CPI ^Z
  CALL('PRINT_CHAR');
  emit(0x23);                         // INX H
  emit(0x05);                         // DCR B
  JNZ('TYPE_PRINT_LOOP');
  JMP('TYPE_READ_LOOP');

  mark('TYPE_NOTFOUND');
  emit(0x0E, 9);      // MVI C, 9  (Print String)
  emit(0x11); ref16('STR_NOTFOUND');
  emit(0xCD, BDOS & 0xFF, BDOS >> 8);

  mark('TYPE_DONE');
  JMP('PROMPT_LOOP');

  // ── String data ───────────────────────────────────────────────────────────
  mark('STR_NOTFOUND');
  for (const c of '\r\nFile not found\r\n$') emit(c.charCodeAt(0));

  // ── Patch forward references ──────────────────────────────────────────────
  for (const { at, lbl } of fixups) {
    const addr = labels[lbl];
    if (addr === undefined) throw new Error(`Undefined label: ${lbl}`);
    code[at]     = addr & 0xFF;
    code[at + 1] = addr >> 8;
  }

  return new Uint8Array(code);
}
