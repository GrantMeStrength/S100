import { create } from 'zustand';
import type { MachineState, TraceEntry } from '../wasm';
import * as wasm from '../wasm';
import { buildBootVector, buildBios, buildCcp } from '../utils/cpm';

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

export const CPM_MACHINE = JSON.stringify({
  name: 'CP/M 2.2 System',
  slots: [
    { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
    { slot: 1, card: 'boot_rom', params: { phantom_port: 0xFF } },
    { slot: 2, card: 'ram',      params: { base: 0, size: 65536 } },
    { slot: 3, card: 'serial',   params: { data_port: 0, status_port: 1 } },
    { slot: 4, card: 'fdc' },
  ],
});

// ── System presets ─────────────────────────────────────────────────────────────

export interface SystemPreset {
  id: string;
  label: string;
  machine: string;   // JSON
  /** If set, boots CP/M after loading (fetches disk image). */
  cpm?: boolean;
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
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 500_000 } },
        { slot: 1, card: 'rom',  params: { base: 0x0000, data_hex: buildDemoRom() } },
        { slot: 2, card: 'ram',  params: { base: 0x0000, size: 8192 } },
        { slot: 3, card: 'serial', params: { data_port: 0, status_port: 1 } },
      ],
    }),
  },
  {
    id: 'altair_cpm',
    label: 'Altair 8800 — 64K CP/M 2.2',
    machine: CPM_MACHINE,
    cpm: true,
  },
  {
    id: 'imsai_cpm',
    label: 'IMSAI 8080 — 64K CP/M 2.2',
    machine: JSON.stringify({
      name: 'IMSAI 8080 CP/M',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'boot_rom', params: { phantom_port: 0x71 } },
        { slot: 2, card: 'ram',      params: { base: 0, size: 65536 } },
        { slot: 3, card: 'serial',   params: { data_port: 0x10, status_port: 0x11 } },
        { slot: 4, card: 'fdc' },
      ],
    }),
    cpm: true,
  },
  {
    id: 'memon80',
    label: 'Memon/80 v3.06 Monitor (JAIR)',
    romUrl: '/roms/memon80.bin',
    machine: JSON.stringify({
      name: 'Memon/80 Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF800 } },
        // JAIR Z80 SIO: TX on 0x20, RX on 0x28, status on 0x25 (bit0=RX, bit5=TX)
        { slot: 2, card: 'serial', params: { tx_port: 0x20, rx_port: 0x28, status_port: 0x25, status_rx_bit: 0, status_tx_bit: 5 } },
        { slot: 3, card: 'rom',    params: { base: 0xF800 } },
      ],
    }),
  },
  {
    id: 'altmon',
    label: 'ALTMON Monitor (Altair 8800)',
    romUrl: '/roms/altmon.bin',
    machine: JSON.stringify({
      name: 'ALTMON Monitor',
      slots: [
        { slot: 0, card: 'cpu_8080', params: { speed_hz: 2_000_000 } },
        { slot: 1, card: 'ram',    params: { base: 0, size: 0xF800 } },
        { slot: 2, card: 'serial', params: { data_port: 0x11, status_port: 0x10 } },
        { slot: 3, card: 'rom',    params: { base: 0xF800 } },
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

  // Actions
  initWasm: () => Promise<void>;
  loadMachine: (json: string) => void;
  bootCpm: () => Promise<void>;
  loadPreset: (presetId: string) => Promise<void>;
  start: () => void;
  stop: () => void;
  reset: () => void;
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

  initWasm: async () => {
    try {
      await wasm.initWasm();
      wasm.loadMachine(get().machineJson);
      set({ wasmReady: true, error: null, actionsApplied: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMachine: (json) => {
    try {
      wasm.loadMachine(json);
      const { name, slots, actions } = parseMachineConfig(json);
      set({ machineJson: json, slots, machineName: name, actions, actionsApplied: false,
            error: null, terminalOutput: '', running: false, mode: 'demo' });
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
        slots: parseMachineConfig(CPM_MACHINE).slots,
        machineName: 'CP/M 2.2 System',
        mode: 'cpm',
        terminalOutput: '',
        traceEntries: [],
        traceCursor: 0,
        diskStatus: ['CPM22.dsk', null, null, null],
        error: null,
        running: true,
        actionsApplied: false,
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

      wasm.loadMachine(machineJson);

      // For ROM monitor presets: plant JMP 0xF800 at reset vector 0x0000
      // (8080 always resets to 0x0000; monitors live at 0xF800)
      if (preset.romUrl) {
        wasm.loadBinary(0x0000, new Uint8Array([0xC3, 0x00, 0xF8]));
      }

      if (preset.cpm) {
        wasm.loadBinary(0x0000, buildBootVector());
        wasm.loadBinary(0xFA00, buildBios());
        wasm.loadBinary(0xDC00, buildCcp());
        const resp = await fetch('/CPM22.dsk');
        if (!resp.ok) throw new Error(`Failed to fetch CPM22.dsk: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        wasm.insertDisk(0, new Uint8Array(buf));
        set({ machineJson, mode: 'cpm', diskStatus: ['CPM22.dsk', null, null, null] });
      } else {
        set({ machineJson, mode: 'demo' });
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

  addCard: (slotIndex, cardId, params = {}) => {
    const state = get();
    const newSlots: SlotEntry[] = [
      ...state.slots.filter(s => s.slot !== slotIndex),
      { slot: slotIndex, card: cardId, params },
    ].sort((a, b) => a.slot - b.slot);
    const json = configToJson(state.machineName, newSlots, state.actions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ slots: newSlots, machineJson: json, running: false, mode: 'demo', actionsApplied: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0, diskStatus: [null,null,null,null] });
  },

  removeCard: (slotIndex) => {
    const state = get();
    const newSlots = state.slots.filter(s => s.slot !== slotIndex);
    const json = configToJson(state.machineName, newSlots, state.actions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ slots: newSlots, machineJson: json, running: false, mode: 'demo', actionsApplied: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0, diskStatus: [null,null,null,null] });
  },

  moveCard: (fromSlot, toSlot) => {
    const state = get();
    const newSlots = state.slots.map(s => {
      if (s.slot === fromSlot) return { ...s, slot: toSlot };
      if (s.slot === toSlot)   return { ...s, slot: fromSlot };
      return s;
    }).sort((a, b) => a.slot - b.slot);
    const json = configToJson(state.machineName, newSlots, state.actions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ slots: newSlots, machineJson: json, running: false, mode: 'demo', actionsApplied: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0, diskStatus: [null,null,null,null] });
  },

  updateCardParams: (slotIndex, params) => {
    const state = get();
    const newSlots = state.slots.map(s => s.slot === slotIndex ? { ...s, params } : s);
    const json = configToJson(state.machineName, newSlots, state.actions);
    try { wasm.loadMachine(json); } catch (e) { set({ error: String(e) }); return; }
    set({ slots: newSlots, machineJson: json, running: false, mode: 'demo', actionsApplied: false,
          terminalOutput: '', traceEntries: [], traceCursor: 0, diskStatus: [null,null,null,null] });
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
