/** Metadata catalogue for all card types the chassis understands. */

// ── ROM image preset catalog ─────────────────────────────────────────────────

export interface RomImagePreset {
  id: string;
  label: string;
  /** Path served from /public (e.g. '/roms/memon80.bin') */
  url: string;
  base: number;
  size: number;
  description: string;
}

export const ROM_IMAGES: RomImagePreset[] = [
  {
    id: 'altair_basic_8k',
    label: 'MITS Altair BASIC 8K (Rev 3.2)',
    url: '/roms/8kbas.bin',
    base: 0xC000,
    size: 8192,
    description: 'MITS 8K BASIC v3.2 for the Altair 8800. Loads at 0xC000–0xDFFF; a copy loop in RAM transfers it to 0x0000 on boot. Uses 88-SIO ports (data 0x01, status 0x00) with 7-bit output.',
  },
  {
    id: 'imsai_basic8k',
    label: 'IMSAI 8K BASIC v1.4',
    url: '/roms/imsai_basic8k.bin',
    base: 0x0000,
    size: 8192,
    description: 'IMSAI 8K BASIC v1.4. ROM at 0x0000–0x1FFF; CPU starts here directly. Uses 8251 USART: data port 0x02, status port 0x03 (bit0=TxRDY, bit1=RxRDY).',
  },
  {
    id: 'memon80',
    label: 'Memon/80 v3.06 (M. Eberhard / JAIR)',
    url: '/roms/memon80.bin',
    base: 0xF800,
    size: 2048,
    description: 'Full-featured S-100 monitor for the JAIR board. Commands: D(ump), S(earch), F(ill), M(ove), I/O, B(oot). Serial: TX 0x20, RX 0x28, status 0x25.',
  },
  {
    id: 'altmon',
    label: 'ALTMON v1.x (Altair 8800)',
    url: '/roms/altmon.bin',
    base: 0xF800,
    size: 1024,
    description: 'Classic Altair 8800 monitor. Commands: D(ump), E(nter), G(o), R(egisters), F(ind). Serial: 88-2SIO data 0x11, status 0x10.',
  },
  {
    id: 'ssm_mon',
    label: 'SSM 8080 Monitor v1.0 (C.E. Ohme / SSM AIO)',
    url: '/roms/ssm_mon.bin',
    base: 0xF000,
    size: 2048,
    description: 'SSM 8080 Monitor for the SSM AIO serial board. Commands: D(ump), E(nter), G(o), B(reakpoints), C(onsole). Serial: status port 0, data port 1 (inverted logic).',
  },
  {
    id: 'amon31',
    label: 'AMON v3.1 (T. Morrow / Altair 8800)',
    url: '/roms/amon31.bin',
    base: 0xF000,
    size: 4096,
    description: 'Full-featured Altair Monitor. Commands: D(ump), E(nter), G(o), B(reakpoint), M(ove), F(ill), S(ubstitute), T(race). Serial: 88-2SIO status 0x10, data 0x11.',
  },
];

export function getRomImage(id: string): RomImagePreset | undefined {
  return ROM_IMAGES.find(r => r.id === id);
}

// ── Card config fields ────────────────────────────────────────────────────────

export interface ConfigField {
  key: string;
  label: string;
  /** hex = numeric as 0x…  |  romimage = ROM preset dropdown  |  select = fixed option list */
  type: 'number' | 'hex' | 'file' | 'romimage' | 'select';
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  accept?: string;   // file picker filter
  options?: { label: string; value: number }[];  // for type='select'
}

export interface PortInfo {
  range: string;    // e.g. "0x08–0x0A" or "0x10"
  direction: 'IN' | 'OUT' | 'IN/OUT';
  description: string;
}

export interface CardTypeInfo {
  id: string;
  label: string;
  shortLabel: string;
  color: string;       // background
  accent: string;      // border / highlight
  description: string;
  /** Structured port usage info shown in the settings panel. */
  ports?: PortInfo[];
  defaultParams: Record<string, unknown>;
  configFields: ConfigField[];
  /** Only one instance allowed in a machine (e.g. CPU). */
  unique?: boolean;
  /** Non-empty = stub; shows this message instead of config fields. */
  stub?: string;
}

// Clock-speed options shared by all CPU cards (value 0 = unlimited / fast-forward).
const SPEED_OPTIONS = [
  { label: '500 kHz',                      value:   500_000 },
  { label: '1 MHz',                        value: 1_000_000 },
  { label: '2 MHz  (Altair / IMSAI)',      value: 2_000_000 },
  { label: '4 MHz',                        value: 4_000_000 },
  { label: '8 MHz',                        value: 8_000_000 },
  { label: 'Unlimited  (fast-forward)',    value:         0 },
];

export const CARD_TYPES: CardTypeInfo[] = [
  {
    id: 'cpu_8080',
    label: 'Intel 8080 CPU',
    shortLabel: 'CPU',
    color: '#2a1040',
    accent: '#9b59b6',
    description: 'Intel 8080A processor running at a configurable clock rate. Supports all standard 8080 instructions, memory-mapped I/O, RST interrupts, and HOLD/HLDA bus arbitration.',
    unique: true,
    defaultParams: { speed_hz: 2_000_000 },
    configFields: [
      { key: 'speed_hz', label: 'Clock speed', type: 'select', options: SPEED_OPTIONS, default: 2_000_000 },
    ],
  },
  {
    id: 'cpu_z80',
    label: 'Zilog Z80 CPU',
    shortLabel: 'Z80',
    color: '#1a0a30',
    accent: '#7d5af5',
    description: 'Zilog Z80 processor — fully compatible with the 8080 instruction set, plus extended instructions (IX/IY registers, CB/DD/ED/FD prefixes), two interrupt modes, and block operations.',
    unique: true,
    defaultParams: { speed_hz: 2_000_000 },
    configFields: [
      { key: 'speed_hz', label: 'Clock speed', type: 'select', options: SPEED_OPTIONS, default: 2_000_000 },
    ],
  },
  {
    id: 'ram',
    label: 'RAM Card',
    shortLabel: 'RAM',
    color: '#0d2e1a',
    accent: '#27ae60',
    description: 'Static read/write memory occupying a configurable address range. On an S-100 bus the RAM card responds to MEMR and MEMW control signals. Multiple RAM cards can coexist at different base addresses.',
    defaultParams: { base: 0x0000, size: 65536 },
    configFields: [
      { key: 'base', label: 'Base address', type: 'hex', min: 0, max: 0xFFFF, default: 0x0000 },
      { key: 'size', label: 'Size (bytes)',  type: 'number', min: 256, max: 65536, step: 256, default: 65536 },
    ],
  },
  {
    id: 'rom',
    label: 'ROM Card',
    shortLabel: 'ROM',
    color: '#0d1e35',
    accent: '#2980b9',
    description: 'Read-only memory card. Choose a built-in ROM image from the library, or upload a custom binary. Address range is set by jumpers (base address and size). Writes are silently ignored. Optional: set a phantom port to page the ROM out of the address space on any write to that I/O port (Shadow ROM / boot-ROM behaviour).',
    defaultParams: { base: 0xF800, size: 2048, rom_image: 'memon80' },
    configFields: [
      { key: 'rom_image', label: 'ROM chip (jumper select)', type: 'romimage', default: 'memon80' },
      { key: 'base', label: 'Base address', type: 'hex', min: 0, max: 0xFFFF, default: 0xF800 },
      { key: 'size', label: 'Size (bytes)',  type: 'number', min: 256, max: 32768, step: 256, default: 2048 },
      { key: '_file', label: 'Custom ROM image (.bin)', type: 'file', accept: '.bin,.rom,.img,.hex', default: null },
      { key: 'phantom_port', label: 'Phantom port — write pages ROM out (optional)', type: 'hex', min: 0, max: 0xFF, default: null },
    ],
  },
  {
    id: 'serial',
    label: 'Serial SIO',
    shortLabel: 'SIO',
    color: '#2e1a0d',
    accent: '#e67e22',
    description: 'Generic UART serial I/O card providing the system console. Port addresses are configurable to match the target hardware (JAIR: 0x00/0x01, Cromemco SIO-2: 0x10/0x11). Status bits and polarity are also adjustable.',
    ports: [
      { range: 'status_port (default 0x01)', direction: 'IN',     description: 'Status register — bit indicates RX data available / TX ready.' },
      { range: 'data_port   (default 0x00)', direction: 'IN/OUT', description: 'Data register — read received byte / write byte to transmit.' },
    ],
    defaultParams: { data_port: 0x00, status_port: 0x01 },
    configFields: [
      { key: 'data_port',   label: 'Data port (JAIR: 0x00)', type: 'hex', min: 0, max: 0xFF, default: 0x00 },
      { key: 'status_port', label: 'Status port (JAIR: 0x01)', type: 'hex', min: 0, max: 0xFF, default: 0x01 },
    ],
  },
  {
    id: 'fdc',
    label: 'Floppy Controller',
    shortLabel: 'FDC',
    color: '#2e250d',
    accent: '#f39c12',
    description: 'Generic software-emulated floppy disk controller for CP/M systems. Implements a WD1771-style register interface. The CP/M BIOS communicates through standard register reads and writes.',
    ports: [
      { range: '0xE0', direction: 'OUT',    description: 'Command register — send WD1771 command.' },
      { range: '0xE1', direction: 'IN/OUT', description: 'Track register.' },
      { range: '0xE2', direction: 'IN/OUT', description: 'Sector register.' },
      { range: '0xE3', direction: 'IN/OUT', description: 'Data register — read/write sector data.' },
    ],
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'dcdd_88',
    label: 'MITS 88-DCDD',
    shortLabel: 'DCDD',
    color: '#2e1a0a',
    accent: '#d4802a',
    description: 'Authentic MITS 88-DCDD hard-sector floppy disk controller as used in the original Altair 8800. Supports 77 tracks × 32 sectors × 137 bytes per sector (IBM 3740 hard-sector format, ~330 KB per disk). Compatible with the SIMH Altair CP/M 2.2 disk image.',
    ports: [
      { range: '0x08', direction: 'IN',     description: 'Drive status (active-low). Bit 7: data ready / bit 6: track 0 / bit 2: head loaded / bit 1: movement OK / bit 0: write ready.' },
      { range: '0x08', direction: 'OUT',    description: 'Drive select. Bit 7 = deselect all; bits 3–0 = drive number (0–3).' },
      { range: '0x09', direction: 'IN',     description: 'Sector position. Bits 5–1: sector counter (0–31); bit 0: sector-true flag (0 = sector is under head).' },
      { range: '0x09', direction: 'OUT',    description: 'Disk control. Bit 0: step in / bit 1: step out / bit 2: load head / bit 3: unload head / bit 7: write enable.' },
      { range: '0x0A', direction: 'IN/OUT', description: 'Data port — sequential byte access through the 137-byte physical sector (bytes 0–136). Auto-advances on each access.' },
    ],
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'sio_88_2sio',
    label: 'MITS 88-2SIO',
    shortLabel: '2SIO',
    color: '#0d2030',
    accent: '#3a9fd4',
    description: 'Authentic MITS 88-2SIO dual serial I/O card as used in the original Altair 8800. Based on the Motorola MC6850 ACIA. Provides the system console for Altair CP/M. Channel A is emulated on ports 0x10/0x11.',
    ports: [
      { range: '0x10', direction: 'IN',     description: 'Status register. Bit 0: RDRF — receive data register full (1 = character waiting). Bit 1: TDRE — transmit data register empty (always 1).' },
      { range: '0x10', direction: 'OUT',    description: 'Control register — master reset and baud rate divisor (accepted but ignored in emulation).' },
      { range: '0x11', direction: 'IN',     description: 'Receive data register — read the next received character.' },
      { range: '0x11', direction: 'OUT',    description: 'Transmit data register — write a character to send to the terminal.' },
    ],
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'fdc_wd1793',
    label: 'WD1793 FDC',
    shortLabel: 'FDC',
    color: '#1a250d',
    accent: '#5a9e2f',
    description: 'Western Digital WD1793 floppy disk controller — the standard FDC chip used in IMSAI 8080, Cromemco, Processor Technology, and most non-MITS S-100 systems. Uses authentic WD1793 register protocol. Supports configurable disk geometry and port addresses. Works with standard flat binary disk images (no preamble).',
    ports: [
      { range: 'base+0 (default 0x34)', direction: 'IN',     description: 'Status register. Bit 7: Not Ready / Bit 5: Record Not Found / Bit 2: Track 0 / Bit 1: DRQ / Bit 0: Busy.' },
      { range: 'base+0 (default 0x34)', direction: 'OUT',    description: 'Command register. Type I: Restore(0x00), Seek(0x10), Step(0x20), StepIn(0x40), StepOut(0x60). Type II: ReadSector(0x80), WriteSector(0xA0). Type IV: ForceInterrupt(0xD0).' },
      { range: 'base+1 (default 0x35)', direction: 'IN/OUT', description: 'Track register — current head position.' },
      { range: 'base+2 (default 0x36)', direction: 'IN/OUT', description: 'Sector register — target sector (1-indexed).' },
      { range: 'base+3 (default 0x37)', direction: 'IN/OUT', description: 'Data register — byte-by-byte sector transfer. Also used as seek target for Seek command.' },
      { range: 'drive_select (default 0x30)', direction: 'OUT', description: 'Drive select latch. One-hot: bit 0 = drive A, bit 1 = B, bit 2 = C, bit 3 = D.' },
    ],
    defaultParams: { base_port: 0x34, drive_select_port: 0x30, tracks: 77, sectors: 26, sector_size: 128 },
    configFields: [
      { key: 'base_port',         label: 'Base port (Cromemco/IMSAI: 0x34)',  type: 'hex',    min: 0, max: 0xFF, default: 0x34 },
      { key: 'drive_select_port', label: 'Drive select port (default: 0x30)', type: 'hex',    min: 0, max: 0xFF, default: 0x30 },
      { key: 'tracks',            label: 'Tracks per disk (default: 77)',      type: 'number', min: 1, max: 255,  default: 77 },
      { key: 'sectors',           label: 'Sectors per track (default: 26)',    type: 'number', min: 1, max: 255,  default: 26 },
      { key: 'sector_size',       label: 'Sector size in bytes (default: 128)',type: 'number', min: 128, max: 1024, step: 128, default: 128 },
    ],
  },
  {
    id: 'dazzler',
    label: 'Cromemco Dazzler',
    shortLabel: 'DAZZ',
    color: '#1a0d2e',
    accent: '#a855f7',
    description: 'Cromemco Dazzler color graphics card for the S-100 bus. Generates a composite video signal from a software-defined frame buffer in system RAM. Supports four display modes: 32×32 / 64×64 color (IRGB) or 64×64 / 128×128 monochrome.',
    ports: [
      { range: '0x0E', direction: 'OUT', description: 'NX register — bit 7: display enable; bits 6–0: frame buffer page (start address = page × 512).' },
      { range: '0x0F', direction: 'OUT', description: 'CC register — bit 1: X4 (high-res); bit 0: color (1 = IRGB color, 0 = B&W).' },
      { range: '0x0E', direction: 'IN',  description: 'Status register — bit 7: vertical sync (always 0 in emulation).' },
    ],
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'vdm',
    label: 'Processor Technology VDM-1',
    shortLabel: 'VDM-1',
    color: '#0a1a10',
    accent: '#33cc66',
    description: 'Processor Technology VDM-1 memory-mapped video display card. Outputs 16 rows × 64 columns of ASCII text via composite video. No I/O ports — the display buffer is mapped directly into the system address space. Bit 7 of each byte enables inverse video.',
    ports: [],
    defaultParams: { base: '0xCC00' },
    configFields: [
      { key: 'base', label: 'VRAM base address (default: 0xCC00)', type: 'hex', min: 0, max: 0xFC00, default: 0xCC00 },
    ],
  },
];

export function getCardType(id: string): CardTypeInfo | undefined {
  // Exact match first
  const exact = CARD_TYPES.find(c => c.id === id);
  if (exact) return exact;
  // Prefix match (e.g. "ram_64k" → "ram")
  return CARD_TYPES.find(c => id.startsWith(c.id) || c.id.startsWith(id));
}
