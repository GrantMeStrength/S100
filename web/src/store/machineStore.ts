import { create } from 'zustand';
import type { MachineState, TraceEntry } from '../wasm/index';
import * as wasm from '../wasm/index';
import { buildBootVector, buildBios, buildCcp } from '../utils/cpm';
import { normalizeDiskImage } from '../utils/diskFormat';

/** Prepend the Vite base URL to a public asset path. Handles GitHub Pages
 *  sub-directory deployments where BASE_URL = '/S100/' instead of '/'. */
const pub = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;

// ── Slot / config types ────────────────────────────────────────────────────────

export interface SlotEntry {
  slot: number;
  card: string;
  params: Record<string, unknown>;
}

export interface ToggleEntry {
  addr: string;   // 4-digit hex, e.g. "F800"
  bytes: string;  // even-length hex pairs, e.g. "3EAA"
}

export interface ActionEntry {
  id: string;
  type: 'toggle';
  params: { entries: ToggleEntry[] };
}

export interface ParsedConfig {
  name: string;
  slots: SlotEntry[];
  actions: ActionEntry[];
}

function parseMachineConfig(json: string): ParsedConfig {
  try {
    const m = JSON.parse(json) as { name?: string; slots?: unknown[]; actions?: unknown[] };
    const slots: SlotEntry[] = (m.slots ?? []).map((s) => {
      const e = s as Record<string, unknown>;
      return {
        slot: e.slot as number,
        card: e.card as string,
        params: (e.params ?? {}) as Record<string, unknown>,
      };
    });
    const actions: ActionEntry[] = (m.actions ?? []).map((a) => {
      const e = a as Record<string, unknown>;
      return {
        id: (e.id ?? crypto.randomUUID()) as string,
        type: (e.type ?? 'toggle') as 'toggle',
        params: (e.params ?? { entries: [] }) as ActionEntry['params'],
      };
    });
    return { name: m.name ?? 'S-100 System', slots, actions };
  } catch {
    return { name: 'S-100 System', slots: [], actions: [] };
  }
}

/** Serialise config to machine JSON, stripping UI-only keys (prefixed _). */
function configToJson(name: string, slots: SlotEntry[], actions: ActionEntry[]): string {
  const obj: Record<string, unknown> = {
    name,
    slots: slots
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map(s => {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s.params)) {
          if (!k.startsWith('_')) clean[k] = v;
        }
        const entry: Record<string, unknown> = { slot: s.slot, card: s.card };
        if (Object.keys(clean).length > 0) entry.params = clean;
        return entry;
      }),
  };
  if (actions.length > 0) obj.actions = actions;
  return JSON.stringify(obj);
}

/**
 * Validate and parse a set of toggle entries.  Returns an error string or null.
 * On success, writes all bytes via wasm.writeMemory.
 */
export function applyToggleEntries(entries: ToggleEntry[]): string | null {
  const HEX4 = /^[0-9A-Fa-f]{4}$/;
  const HEX2P = /^(?:[0-9A-Fa-f]{2})+$/;
  // Validate all before writing any
  for (const e of entries) {
    if (!HEX4.test(e.addr)) return `Bad address: "${e.addr}" — must be 4 hex digits`;
    const cleanBytes = e.bytes.replace(/\s/g, '');
    if (!cleanBytes || !HEX2P.test(cleanBytes)) return `Bad bytes for ${e.addr}: must be pairs of hex digits`;
    const addr = parseInt(e.addr, 16);
    const count = cleanBytes.length / 2;
    if (addr + count - 1 > 0xFFFF) return `Entry at ${e.addr}: ${count} bytes would overflow past 0xFFFF`;
  }
  // Write
  for (const e of entries) {
    const addr = parseInt(e.addr, 16);
    const cleanBytes = e.bytes.replace(/\s/g, '');
    for (let i = 0; i < cleanBytes.length; i += 2) {
      const byte = parseInt(cleanBytes.slice(i, i + 2), 16);
      wasm.writeMemory(addr + i / 2, byte);
    }
  }
  return null;
}

// ── Demo machine ───────────────────────────────────────────────────────────────

function buildDemoRom(): string {
  const rom: number[] = [];
  const push = (...bytes: number[]) => rom.push(...bytes);
  const pushStr = (s: string) => {
    for (const ch of s) {
      push(0x3E, ch.charCodeAt(0));
      push(0xD3, 0x00);
    }
  };

  push(0x31, 0xFF, 0xEF);
  pushStr('S-100 READY\r\n');

  const loopAddr = rom.length;
  push(0xDB, 0x01);
  push(0xE6, 0x01);
  push(0xCA, loopAddr & 0xFF, (loopAddr >> 8) & 0xFF);
  push(0xDB, 0x00);
  push(0xD3, 0x00);
  push(0xC3, loopAddr & 0xFF, (loopAddr >> 8) & 0xFF);

  return rom.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_MACHINE = JSON.stringify({
  name: 'S-100 Demo System',
  slots: [
    { slot: 0, card: 'cpu_8080' },
    { slot: 1, card: 'rom',    params: { base: 0x0000, data_hex: buildDemoRom() } },
    { slot: 2, card: 'ram',    params: { base: 0x8000, size: 32768 } },
    { slot: 3, card: 'serial', params: { data_port: 0, status_port: 1 } },
  ],
});

export const ALTAIR_CPM_MACHINE = JSON.stringify({
  name: 'Altair 8800 CP/M 2.2',
  slots: [
    { slot: 0, card: 'cpu_8080',    params: { speed_hz: 2_000_000 } },
    { slot: 1, card: 'ram',         params: { base: 0, size: 65536 } },
    { slot: 2, card: 'sio_88_2sio' },
    { slot: 3, card: 'dcdd_88' },
  ],
  // Toggle in JMP 0xFF00 at the reset vector — exactly as you would on a real Altair
  // front panel before pressing RUN to start the 88-DCDD bootstrap ROM.
  actions: [
    { id: 'altair-boot-vector', type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 FF' }] } },
  ],
});

export const ALTAIR_CPM_Z80_MACHINE = JSON.stringify({
  name: 'Altair Z80 CP/M 2.2',
  slots: [
    { slot: 0, card: 'cpu_z80',     params: { speed_hz: 2_000_000 } },
    { slot: 1, card: 'ram',         params: { base: 0, size: 65536 } },
    { slot: 2, card: 'sio_88_2sio' },
    { slot: 3, card: 'dcdd_88' },
  ],
  actions: [
    { id: 'altair-boot-vector', type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 FF' }] } },
  ],
});

// Keep CPM_MACHINE as alias so IMSAI preset still works temporarily
export const CPM_MACHINE = ALTAIR_CPM_MACHINE;

// MITS 88-DCDD bootstrap ROM — loads at 0xFF00, jumps to DSKBOOT at 0xFF30
// Source: SIMH altair_dsk.c "bootrom_dsk" array
// Burcon Altair CP/M 2.2 bootstrap loader (77 bytes at 0xFF00).
// Loads disk sector 0 (128 data bytes) to 0x0000 and sector 2 to 0x0080,
// then JMPs to 0x0000 where the disk's own bootstrap takes over.
// Each 137-byte sector has a 3-byte preamble (0x80, track, sector) which is skipped.
export const ALTAIR_BOOT_ROM = new Uint8Array([
  // FF00: XRA A; OUT 08 — select drive 0
  0xAF, 0xD3, 0x08,
  // FF03: MVI A,04; OUT 09 — load head
  0x3E, 0x04, 0xD3, 0x09,
  // FF07: MVI B,0 — target sector 0
  0x06, 0x00,
  // FF09: wait for sector 0 (sector_true=0 and counter=B=0)
  0xDB, 0x09,        // IN 09 — port returns (counter<<1)|sector_true
  0x1F,              // RAR  → carry=sector_true, A=counter
  0xDA, 0x09, 0xFF,  // JC FF09  (loop while sector_true=1)
  0xE6, 0x1F,        // ANI 1F
  0xB8,              // CMP B
  0xC2, 0x09, 0xFF,  // JNZ FF09 (loop until counter=B)
  // FF15: skip 3 preamble bytes
  0x0E, 0x03,        // MVI C,3
  0xDB, 0x0A,        // FF17: IN 0A
  0x0D,              // DCR C
  0xC2, 0x17, 0xFF,  // JNZ FF17
  // FF1D: LXI H,0000; MVI B,80 — read 128 bytes to 0x0000
  0x21, 0x00, 0x00,
  0x06, 0x80,
  0xDB, 0x0A,        // FF22: IN 0A
  0x77,              // MOV M,A
  0x23,              // INX H
  0x05,              // DCR B
  0xC2, 0x22, 0xFF,  // JNZ FF22
  // FF2A: MVI B,2 — target sector 2
  0x06, 0x02,
  // FF2C: wait for sector 2
  0xDB, 0x09,        // IN 09
  0x1F,              // RAR
  0xDA, 0x2C, 0xFF,  // JC FF2C
  0xE6, 0x1F,        // ANI 1F
  0xB8,              // CMP B
  0xC2, 0x2C, 0xFF,  // JNZ FF2C
  // FF38: skip 3 preamble bytes
  0x0E, 0x03,        // MVI C,3
  0xDB, 0x0A,        // FF3A: IN 0A
  0x0D,              // DCR C
  0xC2, 0x3A, 0xFF,  // JNZ FF3A
  // FF40: MVI B,80 — read 128 bytes to 0x0080 (HL already at 0x0080)
  0x06, 0x80,
  0xDB, 0x0A,        // FF42: IN 0A
  0x77,              // MOV M,A
  0x23,              // INX H
  0x05,              // DCR B
  0xC2, 0x42, 0xFF,  // JNZ FF42
  // FF4A: JMP 0000 — run disk bootstrap
  0xC3, 0x00, 0x00,
  // padding to 256 bytes
  ...new Array(256 - 77).fill(0),
]);

// ── System presets ─────────────────────────────────────────────────────────────

export interface SystemPreset {
  id: string;
  label: string;
  machine: string;   // JSON
  /** If set, boots CP/M after loading (fetches disk image). */
  cpm?: boolean;
  /** Boot ROM to inject when cpm is true. Defaults to ALTAIR_BOOT_ROM. */
  cpmBootRom?: Uint8Array;
  /** URL to a binary ROM image to fetch and inject instead of cpmBootRom. */
  cpmBootRomUrl?: string;
  /** Address to inject the boot ROM at. Defaults to 0xFF00. */
  cpmBootRomAddr?: number;
  /** Disk image URL to auto-mount in drive A when cpm is true. Defaults to '/AltairCPM22.dsk'. */
  cpmDiskUrl?: string;
  /** Display name for the auto-mounted disk. Defaults to 'AltairCPM22.dsk'. */
  cpmDiskLabel?: string;
  /** Fetch a binary and load it into RAM at this address, then run from startupPc. */
  binaryUrl?: string;
  binaryLoadAddr?: number;
  /** If set, override PC after loading (default 0x0000). */
  startupPc?: number;
  /** If set, fetch this ROM binary and inject as data_base64 into the 'rom' card slot. */
  romUrl?: string;
}

export const SYSTEM_PRESETS: SystemPreset[] = [
  {
    id: 'altair_8k',
    label: 'Altair 8800 — 8K Demo',
    machine: JSON.stringify({
      name: 'Altair 8800 (8K)',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'rom',  params: { base: 0x0000, data_hex: buildDemoRom() } },
        { slot: 2, card: 'ram',  params: { base: 0x0000, size: 8192 } },
        { slot: 3, card: 'serial', params: { data_port: 0, status_port: 1 } },
      ],
    }),
  },
  {
    id: 'altair_cpm',
    label: 'Altair 8800 — 64K CP/M 2.2',
    machine: ALTAIR_CPM_MACHINE,
    cpm: true,
  },
  {
    id: 'altair_cpm_z80',
    label: 'Altair Z80 — 64K CP/M 2.2',
    machine: ALTAIR_CPM_Z80_MACHINE,
    cpm: true,
  },
  {
    // MITS Altair BASIC Rev. 4.0 (Eight-K Version) — copyright 1976 by MITS Inc.
    // ROM card holds BASIC at 0xC000. On Run, the toggle injects a copy loop at 0xFF00
    // that copies the 8 KB from ROM (0xC000) into RAM (0x0000), then jumps to 0x0000.
    // Uses 88-SIO: status on port 0x00 (active-low RX), data on port 0x01.
    // seven_bit strips bit 7 from TX bytes — BASIC sets bit 7 on tokenised keyword initials.
    // At startup: MEMORY SIZE? → Enter, TERMINAL WIDTH? → Enter, WANT SIN-COS-TAN-ATN? → N
    id: 'altair_basic',
    label: 'Altair 8800 — MITS BASIC 8K',
    romUrl: pub('/roms/8kbas.bin'),
    machine: JSON.stringify({
      name: 'Altair 8800 BASIC',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        // ROM card holds BASIC at 0xC000–0xDFFF; data injected from romUrl at load time
        { slot: 1, card: 'rom',      params: { base: 0xC000, size: 8192, rom_image: 'altair_basic_8k' } },
        { slot: 2, card: 'ram',      params: { base: 0, size: 65536 } },
        // 88-SIO: status=0x00 (bit0=rx-NOT-ready active-low), data=0x01
        { slot: 3, card: 'serial',   params: { data_port: 0x01, status_port: 0x00, status_rx_invert: true, seven_bit: true } },
      ],
      // On Run: write copy loop at 0xFF00 and JMP 0xFF00 at reset vector 0x0000.
      // Copy loop: LXI H,C000 / LXI D,0000 / LXI B,2000 / [MOV A,M; STAX D; INX H; INX D; DCX B; MOV A,B; ORA C; JNZ loop] / JMP 0000
      actions: [
        { id: 'basic-boot', type: 'toggle', params: { entries: [
          { addr: '0000', bytes: 'C3 00 FF' },
          { addr: 'FF00', bytes: '21 00 C0 11 00 00 01 00 20 7E 12 23 13 0B 78 B1 C2 09 FF C3 00 00' },
        ] } },
      ],
    }),
  },
  {
    // IMSAI 8080 with the real MPU-A monitor ROM (bhall66/IMSAI-8080, MIT licence).
    // Uses the FIF FDC abstraction (port 0xFD + disk descriptor) instead of a real
    // WD1793.  The ROM lives at 0xD800; console on 8251 USART ports 0x02/0x03.
    // Disk image: system60.dsk — CP/M 2.2 B03 for 60K, from bhall66/IMSAI-8080.
    id: 'imsai_fif',
    label: 'IMSAI 8080 — CP/M 2.2 (MPU-A ROM)',
    machine: JSON.stringify({
      name: 'IMSAI 8080 (MPU-A ROM)',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',      params: { base: 0, size: 65536 } },
        // 8251 USART console: data 0x02, status 0x03 (bit0=TxRDY, bit1=RxRDY)
        { slot: 2, card: 'serial',   params: { data_port: 0x02, status_port: 0x03, status_rx_bit: 1, status_tx_bit: 0 } },
        // FIF FDC: single port 0xFD with disk-descriptor DMA protocol
        // IBM 3740 SSSD format: 77 tracks × 26 sectors × 128 bytes = 256,256 bytes flat
        { slot: 3, card: 'fdc_fif',  params: { tracks: 77, sectors: 26, sector_size: 128 } },
      ],
      // JMP 0xD800 at reset vector — ROM runs on power-up and after every reset
      actions: [
        { id: 'imsai-fif-vector', type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 D8' }] } },
      ],
    }),
    cpm: true,
    cpmBootRomUrl: pub('/imsai-mpu-a.bin'),
    cpmBootRomAddr: 0xD800,
    cpmDiskUrl: pub('/IMSAICPM60.dsk'),
    cpmDiskLabel: 'IMSAICPM60.dsk',
  },
  {
    // Same IMSAI hardware as above, but the boot disk includes MBASIC v5.21.
    // Type MBASIC at the A> prompt to start Microsoft BASIC-80.
    id: 'imsai_fif_mbasic',
    label: 'IMSAI 8080 — CP/M 2.2 + MBASIC (MPU-A ROM)',
    machine: JSON.stringify({
      name: 'IMSAI 8080 (CP/M + MBASIC)',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',      params: { base: 0, size: 65536 } },
        { slot: 2, card: 'serial',   params: { data_port: 0x02, status_port: 0x03, status_rx_bit: 1, status_tx_bit: 0 } },
        { slot: 3, card: 'fdc_fif',  params: { tracks: 77, sectors: 26, sector_size: 128 } },
      ],
      actions: [
        { id: 'imsai-fif-vector', type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 D8' }] } },
      ],
    }),
    cpm: true,
    cpmBootRomUrl: pub('/imsai-mpu-a.bin'),
    cpmBootRomAddr: 0xD800,
    cpmDiskUrl: pub('/IMSAICPM60_MBASIC.dsk'),
    cpmDiskLabel: 'IMSAICPM60_MBASIC.dsk',
  },
  {
    // IMSAI 8K BASIC v1.4 — standalone ROM BASIC for the IMSAI 8080.
    // ROM loads at 0x0000; CPU executes from there on reset (no toggle needed).
    // Uses 8251 USART: data port 0x02, status port 0x03 (bit0=TxRDY, bit1=RxRDY).
    // seven_bit strips bit 7 from TX bytes — IMSAI BASIC sets bit 7 on keyword initials.
    // At startup: MEMORY SIZE? → Enter, TERMINAL WIDTH? → Enter
    id: 'imsai_basic8k',
    label: 'IMSAI 8080 — 8K BASIC v1.4',
    romUrl: pub('/roms/imsai_basic8k.bin'),
    machine: JSON.stringify({
      name: 'IMSAI 8K BASIC',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'rom',    params: { base: 0x0000, size: 8192, rom_image: 'imsai_basic8k' } },
        { slot: 2, card: 'ram',    params: { base: 0x2000, size: 57344 } },
        { slot: 3, card: 'serial', params: { data_port: 0x02, status_port: 0x03, status_rx_bit: 1, status_tx_bit: 0, seven_bit: true } },
      ],
      actions: [],
    }),
  },
  {
    id: 'memon80',
    label: 'Memon/80 v3.06 Monitor (JAIR)',
    romUrl: pub('/roms/memon80.bin'),
    machine: JSON.stringify({
      name: 'Memon/80 Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF800 } },
        // JAIR Z80 SIO: TX on 0x20, RX on 0x28, TX status 0x25 bit5, RX status 0x2D bit0
        { slot: 2, card: 'serial', params: { tx_port: 0x20, rx_port: 0x28, status_port: 0x25, rx_status_port: 0x2D, status_rx_bit: 0, status_tx_bit: 5 } },
        { slot: 3, card: 'rom',    params: { base: 0xF800 } },
      ],
      // Toggle in JMP 0xF800 at reset vector — exactly as you would on a real front panel
      actions: [
        { type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 F8' }] } },
      ],
    }),
  },
  {
    id: 'altmon',
    label: 'ALTMON Monitor (Altair 8800)',
    romUrl: pub('/roms/altmon.bin'),
    machine: JSON.stringify({
      name: 'ALTMON Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF800 } },
        { slot: 2, card: 'serial', params: { data_port: 0x11, status_port: 0x10 } },
        { slot: 3, card: 'rom',    params: { base: 0xF800 } },
      ],
      // Toggle in JMP 0xF800 at reset vector — exactly as you would on a real front panel
      actions: [
        { type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 F8' }] } },
      ],
    }),
  },
  {
    id: 'ssm_mon',
    label: 'SSM 8080 Monitor v1.0 (SSM AIO)',
    romUrl: pub('/roms/ssm_mon.bin'),
    machine: JSON.stringify({
      name: 'SSM 8080 Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF000 } },
        // SSM AIO serial board: combined status on port 0, data on port 1.
        // Inverted logic: bit0=0 means RX ready, bit7=1 means TX busy (always 0 in emulation).
        { slot: 2, card: 'serial', params: { data_port: 0x01, status_port: 0x00,
            status_rx_bit: 0, status_tx_bit: 7,
            status_rx_invert: true, status_tx_invert: true } },
        { slot: 3, card: 'rom',    params: { base: 0xF000 } },
      ],
      // Toggle in JMP 0xF000 at reset vector
      actions: [
        { type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 F0' }] } },
      ],
    }),
  },
  {
    id: 'amon31',
    label: 'AMON v3.1 Monitor (Altair 8800)',
    romUrl: pub('/roms/amon31.bin'),
    machine: JSON.stringify({
      name: 'AMON v3.1 Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF000 } },
        // Same 88-2SIO ports as ALTMON: status 0x10 (bit0=RX, bit1=TX), data 0x11
        { slot: 2, card: 'serial', params: { data_port: 0x11, status_port: 0x10 } },
        // ROM spans 0xF000–0xFFFF (4096 bytes); cold-start entry at 0xF800
        { slot: 3, card: 'rom',    params: { base: 0xF000 } },
      ],
      // Toggle in JMP 0xF800 at reset vector (AMON cold-start entry)
      actions: [
        { type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 F8' }] } },
      ],
    }),
  },
  {
    id: 'bare',
    label: 'Bare S-100 Bus',
    machine: JSON.stringify({
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram', params: { base: 0, size: 65536 } },
      ],
    }),
  },
  {
    // Processor Technology SOL-20 with SOLOS v1.3 personality module.
    //
    // Memory map (verified from SOLOS source):
    //   0x0000–0xBFFF  48 KB user RAM
    //   0xC000–0xC7FF   2 KB SOLOS ROM (personality module)
    //   0xC800–0xCBFF   1 KB SOLOS working RAM (stack, cursor, tape buffers)
    //   0xCC00–0xCFFF   1 KB VDM-1 character display RAM (64×16)
    //
    // The SOL-20 I/O card emulates:
    //   0xFA/0xFC  keyboard status/data (active-low KDR, SOLOS uses CMA)
    //   0xF8/0xF9  RS-232 serial UART
    //   0xFE       VDM DSTAT scroll register (shared with VDM card)
    //
    // SOLOS monitor commands: D(ump), E(nter), G(o), T(ype), S(ubstitute),
    //   R(ead tape), W(rite tape), V(erify tape), TERM (dumb terminal mode)
    id: 'sol20_solos',
    label: 'SOL-20 — SOLOS v1.3 Monitor',
    romUrl: pub('/roms/solos.bin'),
    machine: JSON.stringify({
      name: 'Processor Technology SOL-20',
      slots: [
        { slot: 0, card: 'cpu_8080',  params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',       params: { base: 0, size: 0xC000 } },         // 48 KB: 0x0000–0xBFFF
        { slot: 2, card: 'rom',       params: { base: 0xC000, size: 2048, rom_image: 'solos' } },  // SOLOS
        { slot: 3, card: 'ram',       params: { base: 0xC800, size: 1024 } },      // SOLOS working RAM
        { slot: 4, card: 'sol20_io'  },                                             // keyboard + serial
        { slot: 5, card: 'vdm',       params: { base: 0xCC00 } },                  // 64×16 display
      ],
      actions: [
        { type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 C0' }] } },
      ],
    }),
  },
  {
    // Processor Technology VDM-1 video card on a standard Altair CP/M system.
    // The VDM-1 is memory-mapped at 0xCC00 — CP/M programs that support it write
    // directly to that address range.  For standalone VDM-1 HEX programs that need
    // CUTER (0xC003/0xC006), add a ROM card manually via the card library and pick
    // "CUTER Compatibility Stubs" from the ROM chip dropdown.
    id: 'altair_vdm1',
    label: 'Altair 8800 + VDM-1 (Processor Technology)',
    cpm: true,
    machine: JSON.stringify({
      name: 'Altair 8800 + VDM-1',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',      params: { base: 0, size: 65536 } },
        { slot: 2, card: 'sio_88_2sio' },
        { slot: 3, card: 'dcdd_88' },
        { slot: 4, card: 'vdm',      params: { base: 0xCC00 } },
      ],
      actions: [
        { id: 'altair-boot-vector', type: 'toggle', params: { entries: [{ addr: '0000', bytes: 'C3 00 FF' }] } },
      ],
    }),
  },
];

// ── Store ─────────────────────────────────────────────────────────────────────

export interface MachineStore {
  // Status
  running: boolean;
  wasmReady: boolean;
  error: string | null;
  mode: 'demo' | 'cpm';

  // State snapshot (polled from WASM)
  machineState: MachineState | null;

  // Terminal output buffer
  terminalOutput: string;

  // Trace
  traceEntries: TraceEntry[];
  traceCursor: number;

  // Machine config
  machineJson: string;
  slots: SlotEntry[];
  machineName: string;
  actions: ActionEntry[];
  actionsApplied: boolean;

  // Disk status (label or null for each of the 4 drives)
  diskStatus: (string | null)[];
  // Detected format label for each drive (e.g. "IMD", "RAW", "88-DCDD")
  diskFormatLabel: (string | null)[];
  // Per-drive warnings from the last disk load (e.g. geometry mismatch)
  diskWarnings: (string[] | null)[];

  // Active boot ROM and disk for the current CP/M preset (used by reset())
  activeBootRom: Uint8Array | null;
  activeBootRomAddr: number;
  activeDiskUrl: string | null;
  activeDiskLabel: string | null;

  // Actions
  initWasm: () => Promise<void>;
  loadMachine: (json: string) => void;
  bootCpm: () => Promise<void>;
  loadPreset: (presetId: string) => Promise<void>;
  start: () => void;
  stop: () => void;
  reset: () => void;
  warmReset: () => void;
  sendInput: (s: string) => void;
  insertDisk: (drive: number, file: File) => void;
  ejectDisk: (drive: number) => void;
  tick: (cycles?: number) => void;
  clearTerminal: () => void;

  // Card config actions (each reloads the WASM machine)
  addCard: (slotIndex: number, cardId: string, params?: Record<string, unknown>) => void;
  removeCard: (slotIndex: number) => void;
  moveCard: (fromSlot: number, toSlot: number) => void;
  updateCardParams: (slotIndex: number, params: Record<string, unknown>) => void;
  /** Internal: reload machine JSON while preserving disks + CP/M boot state. */
  _reloadWithStatePreservation: (newJson: string, newSlots: SlotEntry[]) => void;

  // Action (Toggle) management
  addAction: () => void;
  removeAction: (id: string) => void;
  updateAction: (id: string, params: ActionEntry['params']) => void;
  /** Immediately write all toggle entries into RAM (without starting the CPU). */
  applyActionsNow: () => void;
}

const defaultParsed = parseMachineConfig(DEFAULT_MACHINE);

export const useMachineStore = create<MachineStore>((set, get) => ({
  running: false,
  wasmReady: false,
  error: null,
  mode: 'demo',
  machineState: null,
  terminalOutput: '',
  traceEntries: [],
  traceCursor: 0,
  machineJson: DEFAULT_MACHINE,
  slots: defaultParsed.slots,
  machineName: defaultParsed.name,
  actions: defaultParsed.actions,
  actionsApplied: false,
  diskStatus: [null, null, null, null],
  diskFormatLabel: [null, null, null, null],
  diskWarnings: [null, null, null, null],
  activeBootRom: null,
  activeBootRomAddr: 0xFF00,
  activeDiskUrl: null,
  activeDiskLabel: null,

  initWasm: async () => {
    try {
      await wasm.initWasm();
      await wasm.loadMachine(get().machineJson);
      set({ wasmReady: true, error: null, actionsApplied: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMachine: (json) => {
    wasm.loadMachine(json).then(() => {
      const { name, slots, actions } = parseMachineConfig(json);
      set({ machineJson: json, slots, machineName: name, actions, actionsApplied: false,
            error: null, terminalOutput: '', running: false, mode: 'demo' });
    }).catch(e => set({ error: String(e) }));
  },

  bootCpm: async () => {
    try {
      set({ running: false });

      // Load Altair hardware config (64K RAM + 88-2SIO + 88-DCDD)
      await wasm.loadMachine(ALTAIR_CPM_MACHINE);

      // Load MITS 88-DCDD bootstrap ROM into RAM at 0xFF00
      wasm.loadBinary(0xFF00, ALTAIR_BOOT_ROM);

      // Fetch and insert Altair CP/M 2.2 disk image as drive A
      const resp = await fetch(pub('/AltairCPM22.dsk'));
      if (!resp.ok) throw new Error(`Failed to fetch AltairCPM22.dsk: ${resp.status}`);
      const buf = await resp.arrayBuffer();
      wasm.insertDisk(0, new Uint8Array(buf));

      // Apply toggle action: writes JMP 0xFF00 at 0x0000 (front panel boot vector)
      const { actions } = parseMachineConfig(ALTAIR_CPM_MACHINE);
      for (const action of actions) {
        if (action.type === 'toggle') applyToggleEntries(action.params.entries);
      }

      set({
        machineJson: ALTAIR_CPM_MACHINE,
        slots: parseMachineConfig(ALTAIR_CPM_MACHINE).slots,
        actions,
        machineName: 'Altair 8800 CP/M 2.2',
        mode: 'cpm',
        terminalOutput: '',
        traceEntries: [],
        traceCursor: 0,
        diskStatus: ['AltairCPM22.dsk', null, null, null],
        activeBootRom: ALTAIR_BOOT_ROM,
        activeBootRomAddr: 0xFF00,
        activeDiskUrl: pub('/AltairCPM22.dsk'),
        activeDiskLabel: 'AltairCPM22.dsk',
        error: null,
        running: true,
        actionsApplied: true,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadPreset: async (presetId) => {
    const preset = SYSTEM_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    // Parse the preset's base config
    const { name, slots, actions } = parseMachineConfig(preset.machine);

    // Reset UI state eagerly — even if WASM load fails, old machine state won't linger
    // (fixes e.g. IMSAI LEDs persisting after switching to a non-IMSAI preset)
    set({
      running: false, machineState: null, machineName: name, slots, actions,
      actionsApplied: false, terminalOutput: '', traceEntries: [], traceCursor: 0,
      diskStatus: [null, null, null, null] as (string|null)[], error: null,
    });

    try {
      // Resolve ROM image if the preset references one
      let machineJson = preset.machine;
      if (preset.romUrl) {
        const romResp = await fetch(preset.romUrl);
        if (!romResp.ok) throw new Error(`Failed to fetch ROM ${preset.romUrl}: ${romResp.status}`);
        const romBuf = await romResp.arrayBuffer();
        const romBytes = new Uint8Array(romBuf);
        // Base64-encode in chunks to avoid call-stack overflow on large ROMs
        let b64 = '';
        for (let i = 0; i < romBytes.length; i += 0x8000) {
          b64 += btoa(String.fromCharCode(...romBytes.subarray(i, i + 0x8000)));
        }
        // Inject data_base64 into the first 'rom' card slot
        const obj = JSON.parse(machineJson) as { slots: Array<{ card: string; params?: Record<string,unknown> }> };
        for (const slot of obj.slots) {
          if (slot.card === 'rom') {
            slot.params = { ...(slot.params ?? {}), data_base64: b64 };
            break;
          }
        }
        machineJson = JSON.stringify(obj);
      }

      await wasm.loadMachine(machineJson);

      if (preset.cpm) {
        // Resolve boot ROM — from URL, inline bytes, or Altair default
        let bootRom: Uint8Array = preset.cpmBootRom ?? ALTAIR_BOOT_ROM;
        if (preset.cpmBootRomUrl) {
          const romResp = await fetch(preset.cpmBootRomUrl);
          if (!romResp.ok) throw new Error(`Failed to fetch boot ROM ${preset.cpmBootRomUrl}: ${romResp.status}`);
          bootRom = new Uint8Array(await romResp.arrayBuffer());
        }
        const bootRomAddr = preset.cpmBootRomAddr  ?? 0xFF00;
        const diskUrl     = preset.cpmDiskUrl  ?? pub('/AltairCPM22.dsk');
        const diskLabel   = preset.cpmDiskLabel ?? 'AltairCPM22.dsk';
        wasm.loadBinary(bootRomAddr, bootRom);
        const resp = await fetch(diskUrl);
        if (!resp.ok) throw new Error(`Failed to fetch ${diskUrl}: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        wasm.insertDisk(0, new Uint8Array(buf));
        set({
          machineJson, mode: 'cpm',
          diskStatus: [diskLabel, null, null, null],
          activeBootRom: bootRom,
          activeBootRomAddr: bootRomAddr,
          activeDiskUrl: diskUrl,
          activeDiskLabel: diskLabel,
        });
      } else if (preset.binaryUrl) {
        // Standalone binary (e.g. BASIC) — fetch and load directly into RAM.
        const binResp = await fetch(preset.binaryUrl);
        if (!binResp.ok) throw new Error(`Failed to fetch ${preset.binaryUrl}: ${binResp.status}`);
        const binData = new Uint8Array(await binResp.arrayBuffer());
        wasm.loadBinary(preset.binaryLoadAddr ?? 0x0000, binData);
        if (preset.startupPc !== undefined) wasm.setPC(preset.startupPc);
        set({ machineJson, mode: 'demo', activeBootRom: null, activeBootRomAddr: 0xFF00, activeDiskUrl: null, activeDiskLabel: null, running: true, actionsApplied: true });
      } else {
        set({ machineJson, mode: 'demo', activeBootRom: null, activeBootRomAddr: 0xFF00, activeDiskUrl: null, activeDiskLabel: null });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  start: () => {
    const state = get();
    // Apply toggle actions before running (fail-closed)
    if (!state.actionsApplied && state.actions.length > 0) {
      for (const action of state.actions) {
        if (action.type === 'toggle') {
          const err = applyToggleEntries(action.params.entries);
          if (err) { set({ error: `Toggle action error: ${err}` }); return; }
        }
      }
      set({ actionsApplied: true });
    }
    set({ running: true });
  },
  stop: () => set({ running: false }),

  reset: () => {
    const { mode, actions, activeBootRom, activeBootRomAddr } = get();
    wasm.reset();
    // CP/M: re-inject the boot ROM (BIOS may have overwritten 0xFF00 area).
    if (mode === 'cpm') {
      wasm.loadBinary(activeBootRomAddr ?? 0xFF00, activeBootRom ?? ALTAIR_BOOT_ROM);
    }
    // Re-apply toggle actions for any mode — boot vectors live in RAM and get wiped on reset.
    for (const action of actions) {
      if (action.type === 'toggle') applyToggleEntries(action.params.entries);
    }
    // Auto-resume so the reboot runs without manual intervention.
    set({ terminalOutput: '', traceEntries: [], traceCursor: 0, running: true });
  },

  // Warm reset: jump to CP/M warm boot vector (0x0000) without resetting hardware.
  // CP/M's BIOS sets 0x0000 = JMP WBOOT, so this restarts the CCP without reloading from disk.
  warmReset: () => {
    wasm.setPC(0x0000);
    set({ terminalOutput: '', traceEntries: [], traceCursor: 0, running: true });
  },

  sendInput: (s) => {
    wasm.sendSerialString(s);
  },

  insertDisk: (drive, file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = new Uint8Array(e.target!.result as ArrayBuffer);

      // Detect which FDC type the current machine has
      const slots = get().slots;
      const hasDcdd = slots.some(s => s.card === 'dcdd_88');
      const controllerType: 'dcdd' | 'flat' = hasDcdd ? 'dcdd' : 'flat';

      const result = normalizeDiskImage(raw, controllerType);

      if (result.error) {
        console.error(`[DiskFormat] ${result.error}`);
        set(state => {
          const diskStatus     = [...state.diskStatus];
          const diskFormatLabel = [...state.diskFormatLabel];
          const diskWarnings   = [...state.diskWarnings];
          diskStatus[drive]     = `${file.name} ⚠`;
          diskFormatLabel[drive] = result.formatLabel;
          diskWarnings[drive]   = [result.error!];
          return { diskStatus, diskFormatLabel, diskWarnings };
        });
        return; // don't load a broken image
      }

      if (result.warnings.length > 0) {
        console.warn(`[DiskFormat] ${file.name}:`, result.warnings.join('\n'));
      }

      wasm.insertDisk(drive, result.data);
      set(state => {
        const diskStatus      = [...state.diskStatus];
        const diskFormatLabel = [...state.diskFormatLabel];
        const diskWarnings    = [...state.diskWarnings];
        diskStatus[drive]      = file.name;
        diskFormatLabel[drive] = result.formatLabel;
        diskWarnings[drive]    = result.warnings.length > 0 ? result.warnings : null;
        return { diskStatus, diskFormatLabel, diskWarnings };
      });
    };
    reader.readAsArrayBuffer(file);
  },

  ejectDisk: (drive) => {
    // Insert empty disk (zero bytes = eject)
    wasm.insertDisk(drive, new Uint8Array(0));
    set(state => {
      const diskStatus      = [...state.diskStatus];
      const diskFormatLabel = [...state.diskFormatLabel];
      const diskWarnings    = [...state.diskWarnings];
      diskStatus[drive]      = null;
      diskFormatLabel[drive] = null;
      diskWarnings[drive]    = null;
      return { diskStatus, diskFormatLabel, diskWarnings };
    });
  },

  tick: (cycles = 32768) => {
    // Apply toggle actions before first step (for Step button path)
    const state = get();
    if (!state.actionsApplied && state.actions.length > 0) {
      for (const action of state.actions) {
        if (action.type === 'toggle') {
          const err = applyToggleEntries(action.params.entries);
          if (err) { set({ error: `Toggle action error: ${err}` }); return; }
        }
      }
      set({ actionsApplied: true });
    }

    wasm.step(cycles);

    const out = wasm.getSerialOutput();
    if (out.length > 0) {
      set(st => ({
        terminalOutput: (st.terminalOutput + out).slice(-65536),
      }));
    }

    const machineState = wasm.getState();

    const cursor = get().traceCursor;
    const newEntries = wasm.getTrace(cursor, 128);
    const newCursor = wasm.traceTotal();

    set(st => ({
      machineState,
      traceCursor: newCursor,
      traceEntries: [...st.traceEntries, ...newEntries].slice(-2048),
    }));
  },

  clearTerminal: () => set({ terminalOutput: '' }),

  // ── Card config actions ──────────────────────────────────────────────────────

  // Helper: reload the machine with a new config JSON while preserving disks
  // and CP/M (or BASIC) boot state.  Uses the direct synchronous WASM call so
  // errors are caught reliably (the async wrapper cannot be caught without await).
  _reloadWithStatePreservation: (newJson: string, newSlots: SlotEntry[]) => {
    const state = get();
    const previousMode    = state.mode;
    const previousRunning = state.running;
    const previousDiskStatus = [...state.diskStatus];

    // Stop the RAF loop before touching WASM to eliminate any interleave.
    set({ running: false });

    // Save disk images before machine is rebuilt (they live in WASM)
    const savedDisks: (Uint8Array | null)[] = [0, 1, 2, 3].map(i => {
      try { const d = wasm.getDiskData(i); return d.length > 0 ? d : null; }
      catch { return null; }
    });

    // Use the direct synchronous WASM call so errors throw synchronously
    // and are caught here, rather than becoming silent Promise rejections.
    try {
      wasm.getEmulator().loadMachine(newJson);
    } catch (e) {
      // Restore machine to its previous running state so the user isn't left stuck
      set({ error: String(e), running: previousRunning });
      return;
    }

    // Re-insert saved disk images
    savedDisks.forEach((disk, i) => { if (disk) wasm.insertDisk(i, disk); });

    // Restore boot state
    const newMode = previousMode === 'cpm' ? 'cpm' : 'demo';
    if (previousMode === 'cpm') {
      wasm.loadBinary(state.activeBootRomAddr ?? 0xFF00, state.activeBootRom ?? ALTAIR_BOOT_ROM);
    }
    // Re-apply toggle actions for any mode (boot vectors and copy loops live in RAM)
    for (const action of state.actions) {
      if (action.type === 'toggle') applyToggleEntries(action.params.entries);
    }

    set({
      slots: newSlots, machineJson: newJson,
      running: previousMode === 'cpm' || (previousMode === 'demo' && state.actionsApplied),
      mode: newMode,
      actionsApplied: previousMode === 'cpm' || (previousMode === 'demo' && state.actionsApplied),
      terminalOutput: '', traceEntries: [], traceCursor: 0,
      diskStatus: previousMode === 'cpm' ? previousDiskStatus : [null, null, null, null],
    });
  },

  addCard: (slotIndex, cardId, params = {}) => {
    const state = get();
    // CPU cards are unique: a machine can only have one. When adding a CPU card,
    // remove any existing CPU card from any slot (not just the target slot).
    const isCpu = cardId.startsWith('cpu_');
    const newSlots: SlotEntry[] = [
      ...state.slots.filter(s => isCpu ? !s.card.startsWith('cpu_') : s.slot !== slotIndex),
      { slot: slotIndex, card: cardId, params },
    ].sort((a, b) => a.slot - b.slot);
    const json = configToJson(state.machineName, newSlots, state.actions);
    get()._reloadWithStatePreservation(json, newSlots);
  },

  removeCard: (slotIndex) => {
    const state = get();
    const cardToRemove = state.slots.find(s => s.slot === slotIndex);
    // Prevent removing the only CPU card — machine requires exactly one
    if (cardToRemove?.card.startsWith('cpu_')) {
      set({ error: 'Cannot remove the CPU card — swap it for a different CPU by dragging from the card library.' });
      return;
    }
    const newSlots = state.slots.filter(s => s.slot !== slotIndex);
    const json = configToJson(state.machineName, newSlots, state.actions);
    get()._reloadWithStatePreservation(json, newSlots);
  },

  moveCard: (fromSlot, toSlot) => {
    const state = get();
    const newSlots = state.slots.map(s => {
      if (s.slot === fromSlot) return { ...s, slot: toSlot };
      if (s.slot === toSlot)   return { ...s, slot: fromSlot };
      return s;
    }).sort((a, b) => a.slot - b.slot);
    const json = configToJson(state.machineName, newSlots, state.actions);
    get()._reloadWithStatePreservation(json, newSlots);
  },

  updateCardParams: (slotIndex, params) => {
    const state = get();
    const newSlots = state.slots.map(s => s.slot === slotIndex ? { ...s, params } : s);
    const json = configToJson(state.machineName, newSlots, state.actions);
    get()._reloadWithStatePreservation(json, newSlots);
  },

  // ── Action (Toggle) management ───────────────────────────────────────────────

  addAction: () => {
    const state = get();
    const newAction: ActionEntry = {
      id: crypto.randomUUID(),
      type: 'toggle',
      params: { entries: [] },
    };
    const newActions = [...state.actions, newAction];
    const json = configToJson(state.machineName, state.slots, newActions);
    // Reload machine to clear any previously toggled bytes
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ actions: newActions, machineJson: json, actionsApplied: false, running: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0 });
  },

  removeAction: (id) => {
    const state = get();
    const newActions = state.actions.filter(a => a.id !== id);
    const json = configToJson(state.machineName, state.slots, newActions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ actions: newActions, machineJson: json, actionsApplied: false, running: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0 });
  },

  updateAction: (id, params) => {
    const state = get();
    const newActions = state.actions.map(a => a.id === id ? { ...a, params } : a);
    const json = configToJson(state.machineName, state.slots, newActions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ actions: newActions, machineJson: json, actionsApplied: false, running: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0 });
  },

  applyActionsNow: () => {
    const state = get();
    for (const action of state.actions) {
      if (action.type === 'toggle') {
        const err = applyToggleEntries(action.params.entries);
        if (err) { set({ error: `Toggle action error: ${err}` }); return; }
      }
    }
    set({ actionsApplied: true, error: null });
  },
}));
