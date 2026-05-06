import init, { Emulator } from './pkg/s100_core.js';

let emulator: Emulator | null = null;
let wasmModuleAlive = false;

export async function initWasm(): Promise<void> {
  await init();
  wasmModuleAlive = true;
  emulator = new Emulator();
}

export function getEmulator(): Emulator {
  if (!emulator) throw new Error('WASM not initialized');
  return emulator;
}

/**
 * After a WASM RuntimeError the entire module instance is terminated — even
 * `new Emulator()` throws.  We must call `init()` again to get a fresh module,
 * then create a new Emulator.  Returns a promise so callers can await recovery.
 */
async function reinitWasm(): Promise<void> {
  wasmModuleAlive = false;
  try { emulator?.free(); } catch { /* already dead */ }
  emulator = null;
  await init();
  wasmModuleAlive = true;
  emulator = new Emulator();
}

// ── Typed wrappers ─────────────────────────────────────────────────────────────

export async function loadMachine(json: string): Promise<void> {
  if (!wasmModuleAlive) await reinitWasm();
  try {
    getEmulator().loadMachine(json);
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && (e as Error).name === 'RuntimeError') {
      // Module trapped — reinitialize the WASM module then retry once.
      await reinitWasm();
      getEmulator().loadMachine(json);
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
  // Z80-only (undefined when running 8080)
  ix?: number;
  iy?: number;
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

export function getDazzlerFrame(): Uint8Array {
  return getEmulator().getDazzlerFrame();
}

export function getVdmFrame(): Uint8Array {
  return getEmulator().getVdmFrame();
}
