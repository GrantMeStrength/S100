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
  /** hex = numeric as 0x…  |  romimage = ROM preset dropdown */
  type: 'number' | 'hex' | 'file' | 'romimage';
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  accept?: string;   // file picker filter
}

export interface CardTypeInfo {
  id: string;
  label: string;
  shortLabel: string;
  color: string;       // background
  accent: string;      // border / highlight
  description: string;
  defaultParams: Record<string, unknown>;
  configFields: ConfigField[];
  /** Only one instance allowed in a machine (e.g. CPU). */
  unique?: boolean;
  /** Non-empty = stub; shows this message instead of config fields. */
  stub?: string;
}

export const CARD_TYPES: CardTypeInfo[] = [
  {
    id: 'boot_rom',
    label: 'Shadow ROM (JAIR)',
    shortLabel: 'BROM',
    color: '#1a1a0a',
    accent: '#b8860b',
    description: 'JAIR-style bootstrap ROM at 0x0000; pages out via I/O port',
    defaultParams: { phantom_port: 0x71 },
    configFields: [
      { key: 'phantom_port', label: 'Phantom port (JAIR default: 0x71)', type: 'hex', min: 0, max: 0xFF, default: 0x71 },
    ],
  },
  {
    id: 'cpu_8080',
    label: 'Intel 8080 CPU',
    shortLabel: 'CPU',
    color: '#2a1040',
    accent: '#9b59b6',
    description: 'Intel 8080A processor',
    unique: true,
    defaultParams: { speed_hz: 2_000_000 },
    configFields: [
      { key: 'speed_hz', label: 'Clock speed (Hz)', type: 'number', min: 1, max: 4_000_000, step: 1, default: 2_000_000 },
    ],
  },
  {
    id: 'cpu_z80',
    label: 'Zilog Z80 CPU',
    shortLabel: 'Z80',
    color: '#1a0a30',
    accent: '#7d5af5',
    description: 'Zilog Z80 processor',
    unique: true,
    stub: 'Z80 emulation is planned for a future release. The card will be added to the chassis but the CPU will fall back to 8080-compatible mode.',
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'ram',
    label: 'RAM Card',
    shortLabel: 'RAM',
    color: '#0d2e1a',
    accent: '#27ae60',
    description: 'Static read/write memory',
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
    description: 'Read-only memory — choose a ROM image to "plug in", or upload a custom binary.',
    defaultParams: { base: 0xF800, size: 2048, rom_image: 'memon80' },
    configFields: [
      { key: 'rom_image', label: 'ROM chip (jumper select)', type: 'romimage', default: 'memon80' },
      { key: 'base', label: 'Base address', type: 'hex', min: 0, max: 0xFFFF, default: 0xF800 },
      { key: 'size', label: 'Size (bytes)',  type: 'number', min: 256, max: 32768, step: 256, default: 2048 },
      { key: '_file', label: 'Custom ROM image (.bin)', type: 'file', accept: '.bin,.rom,.img,.hex', default: null },
    ],
  },
  {
    id: 'serial',
    label: 'Serial SIO',
    shortLabel: 'SIO',
    color: '#2e1a0d',
    accent: '#e67e22',
    description: 'UART serial I/O (console). JAIR/typical: data 0x00, status 0x01. Cromemco SIO-2: 0x10/0x11.',
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
    description: 'CP/M FDC (BDOS trap). WD1771 typ: cmd 0xE0, track 0xE1, sector 0xE2, data 0xE3.',
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'dcdd_88',
    label: 'MITS 88-DCDD (Disk Controller)',
    shortLabel: 'DCDD',
    color: '#2e1a0a',
    accent: '#d4802a',
    description: 'MITS 88-DCDD hard-sector floppy controller. 77 tracks × 32 sectors × 137 bytes. Ports 0x08–0x0A.',
    defaultParams: {},
    configFields: [],
  },
  {
    id: 'sio_88_2sio',
    label: 'MITS 88-2SIO (Serial I/O)',
    shortLabel: '2SIO',
    color: '#0d2030',
    accent: '#3a9fd4',
    description: 'MITS 88-2SIO dual MC6850 ACIA serial card. Status 0x10, data 0x11.',
    defaultParams: {},
    configFields: [],
  },
];

export function getCardType(id: string): CardTypeInfo | undefined {
  // Exact match first
  const exact = CARD_TYPES.find(c => c.id === id);
  if (exact) return exact;
  // Prefix match (e.g. "ram_64k" → "ram")
  return CARD_TYPES.find(c => id.startsWith(c.id) || c.id.startsWith(id));
}
