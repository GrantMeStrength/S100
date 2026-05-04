/** Metadata catalogue for all card types the chassis understands. */

export interface ConfigField {
  key: string;
  label: string;
  /** hex = numeric, shown & parsed as 0x… */
  type: 'number' | 'hex' | 'file';
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
    description: 'Read-only memory with loadable image',
    defaultParams: { base: 0xF000, size: 4096 },
    configFields: [
      { key: 'base', label: 'Base address', type: 'hex', min: 0, max: 0xFFFF, default: 0xF000 },
      { key: 'size', label: 'Size (bytes)',  type: 'number', min: 256, max: 32768, step: 256, default: 4096 },
      { key: '_file', label: 'ROM image (.bin)', type: 'file', accept: '.bin,.rom,.img,.hex', default: null },
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
];

export function getCardType(id: string): CardTypeInfo | undefined {
  // Exact match first
  const exact = CARD_TYPES.find(c => c.id === id);
  if (exact) return exact;
  // Prefix match (e.g. "ram_64k" → "ram")
  return CARD_TYPES.find(c => id.startsWith(c.id) || c.id.startsWith(id));
}
