import { create } from 'zustand';
import type { MachineState, TraceEntry } from '../wasm';
import * as wasm from '../wasm';
import { buildBootVector, buildBios, buildCcp } from '../utils/cpm';

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

// ── CP/M machine (64K RAM + serial + FDC) ─────────────────────────────────────

export const CPM_MACHINE = JSON.stringify({
  name: 'CP/M 2.2 System',
  slots: [
    { slot: 0, card: 'cpu_8080' },
    { slot: 1, card: 'ram',    params: { base: 0, size: 65536 } },
    { slot: 2, card: 'serial', params: { data_port: 0, status_port: 1 } },
    { slot: 3, card: 'fdc' },
  ],
});

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

  // Disk status (label or null for each of the 4 drives)
  diskStatus: (string | null)[];

  // Actions
  initWasm: () => Promise<void>;
  loadMachine: (json: string) => void;
  bootCpm: () => Promise<void>;
  start: () => void;
  stop: () => void;
  reset: () => void;
  sendInput: (s: string) => void;
  insertDisk: (drive: number, file: File) => void;
  ejectDisk: (drive: number) => void;
  tick: () => void;
  clearTerminal: () => void;
}

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
  diskStatus: [null, null, null, null],

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

  bootCpm: async () => {
    try {
      set({ running: false });

      // Load CP/M machine config (64K RAM + serial + FDC)
      wasm.loadMachine(CPM_MACHINE);

      // Write boot vector (JMP 0xFA00) at 0x0000
      const bootVec = buildBootVector();
      wasm.loadBinary(0x0000, bootVec);

      // Write minimal BIOS at 0xFA00 (LXI SP, 0xEFFF + JMP 0xDC00)
      const bios = buildBios();
      wasm.loadBinary(0xFA00, bios);

      // Write minimal CCP at 0xDC00
      const ccp = buildCcp();
      wasm.loadBinary(0xDC00, ccp);

      // Fetch and insert CPM22.dsk as drive A
      const resp = await fetch('/CPM22.dsk');
      if (!resp.ok) throw new Error(`Failed to fetch CPM22.dsk: ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const diskData = new Uint8Array(buf);
      wasm.insertDisk(0, diskData);

      set({
        machineJson: CPM_MACHINE,
        mode: 'cpm',
        terminalOutput: '',
        traceEntries: [],
        traceCursor: 0,
        diskStatus: ['CPM22.dsk', null, null, null],
        error: null,
        running: true,
      });
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

  insertDisk: (drive, file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target!.result as ArrayBuffer);
      wasm.insertDisk(drive, data);
      set(state => {
        const diskStatus = [...state.diskStatus];
        diskStatus[drive] = file.name;
        return { diskStatus };
      });
    };
    reader.readAsArrayBuffer(file);
  },

  ejectDisk: (drive) => {
    // Insert empty disk (zero bytes = eject)
    wasm.insertDisk(drive, new Uint8Array(0));
    set(state => {
      const diskStatus = [...state.diskStatus];
      diskStatus[drive] = null;
      return { diskStatus };
    });
  },

  tick: () => {
    wasm.step(32768);

    const out = wasm.getSerialOutput();
    if (out.length > 0) {
      set(state => ({
        terminalOutput: (state.terminalOutput + out).slice(-65536),
      }));
    }

    const machineState = wasm.getState();

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
