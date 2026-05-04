import { create } from 'zustand';
import type { MachineState, TraceEntry } from '../wasm';
import * as wasm from '../wasm';

// Default machine: 64K RAM + serial on port 0/1 + simple demo ROM
// ROM program: outputs "S-100 OK\r\n" then echoes input forever
const DEMO_ROM_HEX = [
  // LXI SP, 0xEFFF  (set stack)
  '31', 'FF', 'EF',
  // Print banner: "S-100 READY\r\n"
  ...Array.from('S-100 READY\r\n').flatMap(ch => [
    '3E', ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase(), // MVI A, char
    'D3', '00',  // OUT 0x00 (serial data)
  ]),
  // Echo loop
  // poll_rx: IN 01 (status); ANI 01; JZ poll_rx
  'DB', '01', 'E6', '01', 'CA', ...['??', '??'], // filled below
  // IN 00 (read char)
  'DB', '00',
  // OUT 00 (echo)
  'D3', '00',
  // JMP echo loop
  'C3', ...['??', '??'],  // filled below
].join('');

// Build the ROM binary properly with correct jump addresses
function buildDemoRom(): string {
  const rom: number[] = [];
  const push = (...bytes: number[]) => rom.push(...bytes);
  const pushStr = (s: string) => {
    for (const ch of s) {
      push(0x3E, ch.charCodeAt(0)); // MVI A, ch
      push(0xD3, 0x00);             // OUT 0
    }
  };

  push(0x31, 0xFF, 0xEF); // LXI SP, 0xEFFF
  pushStr('S-100 READY\r\n');

  const loopAddr = rom.length;
  push(0xDB, 0x01);          // IN 1 (status)
  push(0xE6, 0x01);          // ANI 1
  push(0xCA, loopAddr & 0xFF, (loopAddr >> 8) & 0xFF); // JZ loopAddr

  push(0xDB, 0x00);          // IN 0 (data)
  push(0xD3, 0x00);          // OUT 0 (echo)
  push(0xC3, loopAddr & 0xFF, (loopAddr >> 8) & 0xFF); // JMP loopAddr

  return rom.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ROM at 0x0000 (CPU boot address), RAM at 0x8000-0xFFFF (covers stack at 0xEFFF)
export const DEFAULT_MACHINE = JSON.stringify({
  name: 'S-100 Demo System',
  slots: [
    { slot: 0, card: 'cpu_8080' },
    { slot: 1, card: 'rom',    params: { base: 0x0000, data_hex: buildDemoRom() } },
    { slot: 2, card: 'ram',    params: { base: 0x8000, size: 32768 } },
    { slot: 3, card: 'serial', params: { data_port: 0, status_port: 1 } },
  ],
});

// ── Store ─────────────────────────────────────────────────────────────────────

export interface MachineStore {
  // Status
  running: boolean;
  wasmReady: boolean;
  error: string | null;

  // State snapshot (polled from WASM)
  machineState: MachineState | null;

  // Terminal output buffer
  terminalOutput: string;

  // Trace
  traceEntries: TraceEntry[];
  traceCursor: number;

  // Machine config
  machineJson: string;

  // Actions
  initWasm: () => Promise<void>;
  loadMachine: (json: string) => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  sendInput: (s: string) => void;
  tick: () => void;         // called by the run loop
  clearTerminal: () => void;
}

export const useMachineStore = create<MachineStore>((set, get) => ({
  running: false,
  wasmReady: false,
  error: null,
  machineState: null,
  terminalOutput: '',
  traceEntries: [],
  traceCursor: 0,
  machineJson: DEFAULT_MACHINE,

  initWasm: async () => {
    try {
      await wasm.initWasm();
      wasm.loadMachine(get().machineJson);
      set({ wasmReady: true, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMachine: (json) => {
    try {
      wasm.loadMachine(json);
      set({ machineJson: json, error: null, terminalOutput: '' });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  start: () => set({ running: true }),
  stop: () => set({ running: false }),

  reset: () => {
    wasm.reset();
    set({ terminalOutput: '', traceEntries: [], traceCursor: 0 });
  },

  sendInput: (s) => {
    wasm.sendSerialString(s);
  },

  tick: () => {
    // Run ~32768 cycles (~2MHz @ 16ms)
    wasm.step(32768);

    // Drain serial output
    const out = wasm.getSerialOutput();
    if (out.length > 0) {
      set(state => ({
        terminalOutput: (state.terminalOutput + out).slice(-65536), // cap at 64K chars
      }));
    }

    // Snapshot CPU state
    const machineState = wasm.getState();

    // Incremental trace (up to 128 new entries per tick)
    const cursor = get().traceCursor;
    const newEntries = wasm.getTrace(cursor, 128);
    const newCursor = wasm.traceTotal();

    set(state => ({
      machineState,
      traceCursor: newCursor,
      traceEntries: [...state.traceEntries, ...newEntries].slice(-2048),
    }));
  },

  clearTerminal: () => set({ terminalOutput: '' }),
}));
