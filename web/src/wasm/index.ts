import init, { Emulator } from './pkg/s100_core.js';

let emulator: Emulator | null = null;

export async function initWasm(): Promise<void> {
  await init();
  emulator = new Emulator();
}

export function getEmulator(): Emulator {
  if (!emulator) throw new Error('WASM not initialized');
  return emulator;
}

/** Recreate the Emulator after a WASM RuntimeError (corrupted allocator). */
function recreateEmulator(): void {
  try { emulator?.free(); } catch { /* ignore */ }
  emulator = new Emulator();
}

// ── Typed wrappers ─────────────────────────────────────────────────────────────

export function loadMachine(json: string): void {
  try {
    getEmulator().loadMachine(json);
  } catch (e) {
    // After a WASM panic the linear-memory allocator is corrupted; recreate.
    if (e && typeof e === 'object' && 'name' in e && (e as Error).name === 'RuntimeError') {
      recreateEmulator();
      getEmulator().loadMachine(json); // retry once
    } else {
      throw e;
    }
  }
}

export function step(cycles: number): number {
  return getEmulator().step(cycles);
}

export function reset(): void {
  getEmulator().reset();
}

export interface FlagState {
  s: boolean; z: boolean; ac: boolean; p: boolean; cy: boolean;
}

export interface CpuState {
  a: number; b: number; c: number;
  d: number; e: number; h: number; l: number;
  sp: number; pc: number;
  flags: FlagState;
  halted: boolean;
  interrupts_enabled: boolean;
  cycles: number;
}

export interface MachineState {
  name: string;
  cpu: CpuState;
  cards: string[];
  bus_cycles: number;
  /** Last byte written to I/O port 0xFF — IMSAI Programmed Output latch. */
  programmed_output: number;
}

export function getState(): MachineState {
  return JSON.parse(getEmulator().getState());
}

export interface TraceEntry {
  cycle: number;
  address: number;
  data: number;
  op: 'MemRead' | 'MemWrite' | 'IoRead' | 'IoWrite';
  source: string;
}

export function getTrace(sinceIndex: number, limit = 256): TraceEntry[] {
  return JSON.parse(getEmulator().getTrace(BigInt(sinceIndex), limit));
}

export function traceTotal(): number {
  return Number(getEmulator().traceTotal());
}

export function readMemory(addr: number): number {
  return getEmulator().readMemory(addr);
}

export function writeMemory(addr: number, value: number): void {
  getEmulator().writeMemory(addr, value);
}

export function loadBinary(base: number, data: Uint8Array): void {
  getEmulator().loadBinary(base, data);
}

export function getSerialOutput(): string {
  return getEmulator().getSerialOutput();
}

export function sendSerialInput(byte: number): void {
  getEmulator().sendSerialInput(byte);
}

export function sendSerialString(s: string): void {
  getEmulator().sendSerialString(s);
}

export function insertDisk(drive: number, data: Uint8Array): void {
  getEmulator().insertDisk(drive, data);
}

export function getDiskData(drive: number): Uint8Array {
  return getEmulator().getDiskData(drive);
}

export function setPC(pc: number): void {
  getEmulator().setPC(pc);
}
