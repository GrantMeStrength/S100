/**
 * 8080 / Z80 instruction disassembler.
 *
 * Usage:
 *   const result = disassemble(addr, readByte, cpuType);
 *   // result = { addr, bytes, mnemonic, length }
 *
 * readByte(addr): returns the byte at the given 16-bit address.
 * cpuType: '8080' | 'z80'
 */

export interface DisasmLine {
  addr: number;
  bytes: number[];
  mnemonic: string;
  length: number;
}

type ReadByte = (addr: number) => number;

// ── 8080 opcode table ─────────────────────────────────────────────────────────

const OPS_8080: string[] = [
  /* 00 */ 'NOP',       'LXI B,@W',  'STAX B',   'INX B',    'INR B',    'DCR B',    'MVI B,@B', 'RLC',
  /* 08 */ '*NOP',      'DAD B',     'LDAX B',   'DCX B',    'INR C',    'DCR C',    'MVI C,@B', 'RRC',
  /* 10 */ '*NOP',      'LXI D,@W',  'STAX D',   'INX D',    'INR D',    'DCR D',    'MVI D,@B', 'RAL',
  /* 18 */ '*NOP',      'DAD D',     'LDAX D',   'DCX D',    'INR E',    'DCR E',    'MVI E,@B', 'RAR',
  /* 20 */ '*NOP',      'LXI H,@W',  'SHLD @W',  'INX H',    'INR H',    'DCR H',    'MVI H,@B', 'DAA',
  /* 28 */ '*NOP',      'DAD H',     'LHLD @W',  'DCX H',    'INR L',    'DCR L',    'MVI L,@B', 'CMA',
  /* 30 */ '*NOP',      'LXI SP,@W', 'STA @W',   'INX SP',   'INR M',    'DCR M',    'MVI M,@B', 'STC',
  /* 38 */ '*NOP',      'DAD SP',    'LDA @W',   'DCX SP',   'INR A',    'DCR A',    'MVI A,@B', 'CMC',
  /* 40 */ 'MOV B,B',   'MOV B,C',   'MOV B,D',  'MOV B,E',  'MOV B,H',  'MOV B,L',  'MOV B,M',  'MOV B,A',
  /* 48 */ 'MOV C,B',   'MOV C,C',   'MOV C,D',  'MOV C,E',  'MOV C,H',  'MOV C,L',  'MOV C,M',  'MOV C,A',
  /* 50 */ 'MOV D,B',   'MOV D,C',   'MOV D,D',  'MOV D,E',  'MOV D,H',  'MOV D,L',  'MOV D,M',  'MOV D,A',
  /* 58 */ 'MOV E,B',   'MOV E,C',   'MOV E,D',  'MOV E,E',  'MOV E,H',  'MOV E,L',  'MOV E,M',  'MOV E,A',
  /* 60 */ 'MOV H,B',   'MOV H,C',   'MOV H,D',  'MOV H,E',  'MOV H,H',  'MOV H,L',  'MOV H,M',  'MOV H,A',
  /* 68 */ 'MOV L,B',   'MOV L,C',   'MOV L,D',  'MOV L,E',  'MOV L,H',  'MOV L,L',  'MOV L,M',  'MOV L,A',
  /* 70 */ 'MOV M,B',   'MOV M,C',   'MOV M,D',  'MOV M,E',  'MOV M,H',  'MOV M,L',  'HLT',      'MOV M,A',
  /* 78 */ 'MOV A,B',   'MOV A,C',   'MOV A,D',  'MOV A,E',  'MOV A,H',  'MOV A,L',  'MOV A,M',  'MOV A,A',
  /* 80 */ 'ADD B',     'ADD C',     'ADD D',    'ADD E',    'ADD H',    'ADD L',    'ADD M',    'ADD A',
  /* 88 */ 'ADC B',     'ADC C',     'ADC D',    'ADC E',    'ADC H',    'ADC L',    'ADC M',    'ADC A',
  /* 90 */ 'SUB B',     'SUB C',     'SUB D',    'SUB E',    'SUB H',    'SUB L',    'SUB M',    'SUB A',
  /* 98 */ 'SBB B',     'SBB C',     'SBB D',    'SBB E',    'SBB H',    'SBB L',    'SBB M',    'SBB A',
  /* A0 */ 'ANA B',     'ANA C',     'ANA D',    'ANA E',    'ANA H',    'ANA L',    'ANA M',    'ANA A',
  /* A8 */ 'XRA B',     'XRA C',     'XRA D',    'XRA E',    'XRA H',    'XRA L',    'XRA M',    'XRA A',
  /* B0 */ 'ORA B',     'ORA C',     'ORA D',    'ORA E',    'ORA H',    'ORA L',    'ORA M',    'ORA A',
  /* B8 */ 'CMP B',     'CMP C',     'CMP D',    'CMP E',    'CMP H',    'CMP L',    'CMP M',    'CMP A',
  /* C0 */ 'RNZ',       'POP B',     'JNZ @W',   'JMP @W',   'CNZ @W',   'PUSH B',   'ADI @B',   'RST 0',
  /* C8 */ 'RZ',        'RET',       'JZ @W',    '*JMP @W',  'CZ @W',    'CALL @W',  'ACI @B',   'RST 1',
  /* D0 */ 'RNC',       'POP D',     'JNC @W',   'OUT @B',   'CNC @W',   'PUSH D',   'SUI @B',   'RST 2',
  /* D8 */ 'RC',        '*RET',      'JC @W',    'IN @B',    'CC @W',    '*CALL @W', 'SBI @B',   'RST 3',
  /* E0 */ 'RPO',       'POP H',     'JPO @W',   'XTHL',     'CPO @W',   'PUSH H',   'ANI @B',   'RST 4',
  /* E8 */ 'RPE',       'PCHL',      'JPE @W',   'XCHG',     'CPE @W',   '*CALL @W', 'XRI @B',   'RST 5',
  /* F0 */ 'RP',        'POP PSW',   'JP @W',    'DI',       'CP @W',    'PUSH PSW', 'ORI @B',   'RST 6',
  /* F8 */ 'RM',        'SPHL',      'JM @W',    'EI',       'CM @W',    '*CALL @W', 'CPI @B',   'RST 7',
];

// ── Z80 opcode table ──────────────────────────────────────────────────────────

const OPS_Z80: string[] = [
  /* 00 */ 'NOP',        'LD BC,@W',   'LD (BC),A',  'INC BC',    'INC B',     'DEC B',     'LD B,@B',   'RLCA',
  /* 08 */ "EX AF,AF'",  'ADD HL,BC',  'LD A,(BC)',  'DEC BC',    'INC C',     'DEC C',     'LD C,@B',   'RRCA',
  /* 10 */ 'DJNZ @R',    'LD DE,@W',   'LD (DE),A',  'INC DE',    'INC D',     'DEC D',     'LD D,@B',   'RLA',
  /* 18 */ 'JR @R',      'ADD HL,DE',  'LD A,(DE)',  'DEC DE',    'INC E',     'DEC E',     'LD E,@B',   'RRA',
  /* 20 */ 'JR NZ,@R',   'LD HL,@W',   'LD (@W),HL', 'INC HL',    'INC H',     'DEC H',     'LD H,@B',   'DAA',
  /* 28 */ 'JR Z,@R',    'ADD HL,HL',  'LD HL,(@W)', 'DEC HL',    'INC L',     'DEC L',     'LD L,@B',   'CPL',
  /* 30 */ 'JR NC,@R',   'LD SP,@W',   'LD (@W),A',  'INC SP',    'INC (HL)',  'DEC (HL)',  'LD (HL),@B','SCF',
  /* 38 */ 'JR C,@R',    'ADD HL,SP',  'LD A,(@W)',  'DEC SP',    'INC A',     'DEC A',     'LD A,@B',   'CCF',
  /* 40 */ 'LD B,B',     'LD B,C',     'LD B,D',     'LD B,E',    'LD B,H',    'LD B,L',    'LD B,(HL)', 'LD B,A',
  /* 48 */ 'LD C,B',     'LD C,C',     'LD C,D',     'LD C,E',    'LD C,H',    'LD C,L',    'LD C,(HL)', 'LD C,A',
  /* 50 */ 'LD D,B',     'LD D,C',     'LD D,D',     'LD D,E',    'LD D,H',    'LD D,L',    'LD D,(HL)', 'LD D,A',
  /* 58 */ 'LD E,B',     'LD E,C',     'LD E,D',     'LD E,E',    'LD E,H',    'LD E,L',    'LD E,(HL)', 'LD E,A',
  /* 60 */ 'LD H,B',     'LD H,C',     'LD H,D',     'LD H,E',    'LD H,H',    'LD H,L',    'LD H,(HL)', 'LD H,A',
  /* 68 */ 'LD L,B',     'LD L,C',     'LD L,D',     'LD L,E',    'LD L,H',    'LD L,L',    'LD L,(HL)', 'LD L,A',
  /* 70 */ 'LD (HL),B',  'LD (HL),C',  'LD (HL),D',  'LD (HL),E', 'LD (HL),H', 'LD (HL),L', 'HALT',      'LD (HL),A',
  /* 78 */ 'LD A,B',     'LD A,C',     'LD A,D',     'LD A,E',    'LD A,H',    'LD A,L',    'LD A,(HL)', 'LD A,A',
  /* 80 */ 'ADD A,B',    'ADD A,C',    'ADD A,D',    'ADD A,E',   'ADD A,H',   'ADD A,L',   'ADD A,(HL)','ADD A,A',
  /* 88 */ 'ADC A,B',    'ADC A,C',    'ADC A,D',    'ADC A,E',   'ADC A,H',   'ADC A,L',   'ADC A,(HL)','ADC A,A',
  /* 90 */ 'SUB B',      'SUB C',      'SUB D',      'SUB E',     'SUB H',     'SUB L',     'SUB (HL)',  'SUB A',
  /* 98 */ 'SBC A,B',    'SBC A,C',    'SBC A,D',    'SBC A,E',   'SBC A,H',   'SBC A,L',   'SBC A,(HL)','SBC A,A',
  /* A0 */ 'AND B',      'AND C',      'AND D',      'AND E',     'AND H',     'AND L',     'AND (HL)',  'AND A',
  /* A8 */ 'XOR B',      'XOR C',      'XOR D',      'XOR E',     'XOR H',     'XOR L',     'XOR (HL)',  'XOR A',
  /* B0 */ 'OR B',       'OR C',       'OR D',       'OR E',      'OR H',      'OR L',      'OR (HL)',   'OR A',
  /* B8 */ 'CP B',       'CP C',       'CP D',       'CP E',      'CP H',      'CP L',      'CP (HL)',   'CP A',
  /* C0 */ 'RET NZ',     'POP BC',     'JP NZ,@W',   'JP @W',     'CALL NZ,@W','PUSH BC',   'ADD A,@B',  'RST 00h',
  /* C8 */ 'RET Z',      'RET',        'JP Z,@W',    'CB!',       'CALL Z,@W', 'CALL @W',   'ADC A,@B',  'RST 08h',
  /* D0 */ 'RET NC',     'POP DE',     'JP NC,@W',   'OUT (@B),A','CALL NC,@W','PUSH DE',   'SUB @B',    'RST 10h',
  /* D8 */ 'RET C',      'EXX',        'JP C,@W',    'IN A,(@B)', 'CALL C,@W', 'DD!',       'SBC A,@B',  'RST 18h',
  /* E0 */ 'RET PO',     'POP HL',     'JP PO,@W',   'EX (SP),HL','CALL PO,@W','PUSH HL',   'AND @B',    'RST 20h',
  /* E8 */ 'RET PE',     'JP (HL)',    'JP PE,@W',   'EX DE,HL',  'CALL PE,@W','ED!',       'XOR @B',    'RST 28h',
  /* F0 */ 'RET P',      'POP AF',     'JP P,@W',    'DI',        'CALL P,@W', 'PUSH AF',   'OR @B',     'RST 30h',
  /* F8 */ 'RET M',      'LD SP,HL',   'JP M,@W',    'EI',        'CALL M,@W', 'FD!',       'CP @B',     'RST 38h',
];

// Z80 CB-prefix (bit operations)
const R8 = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
function decodeCB(op: number): string {
  const r = R8[op & 7];
  const y = (op >> 3) & 7;
  if (op < 0x08) return `RLC ${r}`;
  if (op < 0x10) return `RRC ${r}`;
  if (op < 0x18) return `RL ${r}`;
  if (op < 0x20) return `RR ${r}`;
  if (op < 0x28) return `SLA ${r}`;
  if (op < 0x30) return `SRA ${r}`;
  if (op < 0x38) return `SLL ${r}`;
  if (op < 0x40) return `SRL ${r}`;
  if (op < 0x80) return `BIT ${y},${r}`;
  if (op < 0xC0) return `RES ${y},${r}`;
  return `SET ${y},${r}`;
}

// Z80 ED-prefix (extended)
const OPS_ED: Record<number, string> = {
  0x40: 'IN B,(C)',   0x41: 'OUT (C),B', 0x42: 'SBC HL,BC', 0x43: 'LD (@W),BC',
  0x44: 'NEG',        0x45: 'RETN',      0x46: 'IM 0',      0x47: 'LD I,A',
  0x48: 'IN C,(C)',   0x49: 'OUT (C),C', 0x4A: 'ADC HL,BC', 0x4B: 'LD BC,(@W)',
  0x4C: '*NEG',       0x4D: 'RETI',      0x4E: '*IM 0',     0x4F: 'LD R,A',
  0x50: 'IN D,(C)',   0x51: 'OUT (C),D', 0x52: 'SBC HL,DE', 0x53: 'LD (@W),DE',
  0x54: '*NEG',       0x55: '*RETN',     0x56: 'IM 1',      0x57: 'LD A,I',
  0x58: 'IN E,(C)',   0x59: 'OUT (C),E', 0x5A: 'ADC HL,DE', 0x5B: 'LD DE,(@W)',
  0x5C: '*NEG',       0x5D: '*RETN',     0x5E: 'IM 2',      0x5F: 'LD A,R',
  0x60: 'IN H,(C)',   0x61: 'OUT (C),H', 0x62: 'SBC HL,HL', 0x63: 'LD (@W),HL',
  0x64: '*NEG',       0x65: '*RETN',     0x66: '*IM 0',     0x67: 'RRD',
  0x68: 'IN L,(C)',   0x69: 'OUT (C),L', 0x6A: 'ADC HL,HL', 0x6B: 'LD HL,(@W)',
  0x6C: '*NEG',       0x6D: '*RETN',     0x6E: '*IM 0',     0x6F: 'RLD',
  0x70: 'IN (C)',     0x71: 'OUT (C),0', 0x72: 'SBC HL,SP', 0x73: 'LD (@W),SP',
  0x74: '*NEG',       0x75: '*RETN',     0x76: '*IM 1',     0x77: '*NOP',
  0x78: 'IN A,(C)',   0x79: 'OUT (C),A', 0x7A: 'ADC HL,SP', 0x7B: 'LD SP,(@W)',
  0x7C: '*NEG',       0x7D: '*RETN',     0x7E: '*IM 2',     0x7F: '*NOP',
  0xA0: 'LDI',        0xA1: 'CPI',       0xA2: 'INI',       0xA3: 'OUTI',
  0xA8: 'LDD',        0xA9: 'CPD',       0xAA: 'IND',       0xAB: 'OUTD',
  0xB0: 'LDIR',       0xB1: 'CPIR',      0xB2: 'INIR',      0xB3: 'OTIR',
  0xB8: 'LDDR',       0xB9: 'CPDR',      0xBA: 'INDR',      0xBB: 'OTDR',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hex2(n: number): string { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n: number): string { return n.toString(16).toUpperCase().padStart(4, '0'); }

function formatOperands(template: string, bytes: number[], instrAddr: number): string {
  let result = template;
  let idx = 1; // byte index (0 = opcode)

  // @R = relative jump target (signed byte offset from instruction end)
  if (result.includes('@R')) {
    const offset = bytes[idx] < 128 ? bytes[idx] : bytes[idx] - 256;
    const target = (instrAddr + bytes.length + offset) & 0xFFFF;
    // The instruction length isn't finalized yet at this point, but for JR/DJNZ it's always 2
    const jr_target = (instrAddr + 2 + offset) & 0xFFFF;
    result = result.replace('@R', hex4(jr_target) + 'h');
    idx++;
  }

  // @W = 16-bit word (little-endian)
  if (result.includes('@W')) {
    const word = bytes[idx] | (bytes[idx + 1] << 8);
    result = result.replace('@W', hex4(word) + 'h');
    idx += 2;
  }

  // @B = 8-bit byte
  if (result.includes('@B')) {
    result = result.replace('@B', hex2(bytes[idx]) + 'h');
    idx++;
  }

  return result;
}

function instrLength(template: string): number {
  let len = 1;
  if (template.includes('@W')) len += 2;
  if (template.includes('@B')) len += 1;
  if (template.includes('@R')) len += 1;
  return len;
}

// ── Disassemble one instruction ───────────────────────────────────────────────

function disassembleZ80(addr: number, read: ReadByte): DisasmLine {
  const op = read(addr & 0xFFFF);
  const bytes = [op];

  const template = OPS_Z80[op];

  // CB prefix — bit operations
  if (template === 'CB!') {
    const cb = read((addr + 1) & 0xFFFF);
    bytes.push(cb);
    return { addr, bytes, mnemonic: decodeCB(cb), length: 2 };
  }

  // ED prefix — extended instructions
  if (template === 'ED!') {
    const ed = read((addr + 1) & 0xFFFF);
    bytes.push(ed);
    const edTemplate = OPS_ED[ed];
    if (!edTemplate) {
      return { addr, bytes, mnemonic: `DB EDh,${hex2(ed)}h`, length: 2 };
    }
    const len = instrLength(edTemplate);
    for (let i = 0; i < len - 1; i++) bytes.push(read((addr + 2 + i) & 0xFFFF));
    return { addr, bytes, mnemonic: formatOperands(edTemplate, bytes.slice(1), addr), length: bytes.length };
  }

  // DD/FD prefix — IX/IY indexed instructions
  if (template === 'DD!' || template === 'FD!') {
    const reg = template === 'DD!' ? 'IX' : 'IY';
    const next = read((addr + 1) & 0xFFFF);
    bytes.push(next);

    // DD CB / FD CB — indexed bit operations
    if (next === 0xCB) {
      const d = read((addr + 2) & 0xFFFF);
      const cb = read((addr + 3) & 0xFFFF);
      bytes.push(d, cb);
      let mn = decodeCB(cb);
      const disp = d < 128 ? `+${hex2(d)}h` : `-${hex2(256 - d)}h`;
      mn = mn.replace('(HL)', `(${reg}${disp})`);
      return { addr, bytes, mnemonic: mn, length: 4 };
    }

    // Use the base Z80 table, substituting HL→IX/IY and (HL)→(IX+d)/(IY+d)
    const baseTemplate = OPS_Z80[next];
    if (!baseTemplate || baseTemplate.endsWith('!')) {
      return { addr, bytes, mnemonic: `DB ${hex2(op)}h,${hex2(next)}h`, length: 2 };
    }

    let mn = baseTemplate;
    let needsDisp = mn.includes('(HL)');

    if (needsDisp) {
      const d = read((addr + 2) & 0xFFFF);
      bytes.push(d);
      const disp = d < 128 ? `+${hex2(d)}h` : `-${hex2(256 - d)}h`;
      mn = mn.replace('(HL)', `(${reg}${disp})`);
    }

    mn = mn.replace(/\bHL\b/g, reg);

    // Collect remaining operand bytes
    const baseLen = instrLength(mn);
    while (bytes.length < baseLen + 1) {
      bytes.push(read((addr + bytes.length) & 0xFFFF));
    }

    return { addr, bytes, mnemonic: formatOperands(mn, bytes.slice(1), addr), length: bytes.length };
  }

  // Normal instruction
  const len = instrLength(template);
  for (let i = 1; i < len; i++) bytes.push(read((addr + i) & 0xFFFF));

  return { addr, bytes, mnemonic: formatOperands(template, bytes, addr), length: len };
}

function disassemble8080(addr: number, read: ReadByte): DisasmLine {
  const op = read(addr & 0xFFFF);
  const bytes = [op];
  const template = OPS_8080[op];
  const len = instrLength(template);
  for (let i = 1; i < len; i++) bytes.push(read((addr + i) & 0xFFFF));
  return { addr, bytes, mnemonic: formatOperands(template, bytes, addr), length: len };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function disassemble(
  addr: number,
  readByte: ReadByte,
  cpuType: '8080' | 'z80' = '8080',
): DisasmLine {
  return cpuType === 'z80'
    ? disassembleZ80(addr, readByte)
    : disassemble8080(addr, readByte);
}

/**
 * Disassemble `count` instructions starting at `startAddr`.
 */
export function disassembleBlock(
  startAddr: number,
  count: number,
  readByte: ReadByte,
  cpuType: '8080' | 'z80' = '8080',
): DisasmLine[] {
  const lines: DisasmLine[] = [];
  let addr = startAddr;
  for (let i = 0; i < count; i++) {
    const line = disassemble(addr & 0xFFFF, readByte, cpuType);
    lines.push(line);
    addr = (addr + line.length) & 0xFFFF;
  }
  return lines;
}
