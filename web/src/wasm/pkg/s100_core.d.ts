/* tslint:disable */
/* eslint-disable */

export class Emulator {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a breakpoint at the given address.
     */
    addBreakpoint(addr: number): void;
    /**
     * Remove all breakpoints.
     */
    clearBreakpoints(): void;
    /**
     * Render the Dazzler frame buffer to RGBA pixels.
     * Returns [width_lo, width_hi, height_lo, height_hi, ...rgba_bytes],
     * or an empty array if no Dazzler card is present or the display is disabled.
     */
    getDazzlerFrame(): Uint8Array;
    /**
     * Retrieve the current contents of a disk drive image (for saving).
     * Returns an empty array if drive is not inserted.
     */
    getDiskData(drive: number): Uint8Array;
    /**
     * Drain all bytes the CPU has sent to the serial TX buffer.
     * Returns a UTF-8 string (non-UTF8 bytes become replacement chars).
     */
    getSerialOutput(): string;
    /**
     * Get machine + CPU state as a JSON string.
     */
    getState(): string;
    /**
     * Get trace entries since `since_index` (up to `limit`) as JSON string.
     */
    getTrace(since_index: bigint, limit: number): string;
    /**
     * Return the raw 1024-byte VDM-1 VRAM, or an empty Uint8Array if no VDM card is present.
     * Each byte: bit 7 = inverse video, bits 6–0 = ASCII character code.
     */
    getVdmFrame(): Uint8Array;
    /**
     * Insert a disk image into the specified drive (0=A, 1=B, 2=C, 3=D).
     */
    insertDisk(drive: number, data: Uint8Array): void;
    /**
     * Write a byte to an I/O port (broadcasts to all cards on the bus).
     */
    ioWrite(port: number, value: number): void;
    /**
     * Load a raw binary blob into memory starting at `base`.
     */
    loadBinary(base: number, data: Uint8Array): void;
    /**
     * Load a machine definition from JSON. Returns an error string on failure.
     */
    loadMachine(json: string): void;
    constructor();
    /**
     * Read a byte from emulated memory (non-destructive peek).
     */
    readMemory(addr: number): number;
    /**
     * Remove a breakpoint at the given address.
     */
    removeBreakpoint(addr: number): void;
    /**
     * Reset CPU and all cards.
     */
    reset(): void;
    /**
     * Push a byte into the serial RX buffer (keyboard input to the CPU).
     */
    sendSerialInput(byte: number): void;
    /**
     * Send a string of bytes to the serial RX buffer.
     */
    sendSerialString(s: string): void;
    /**
     * Set the CPU program counter directly (used for ROM-based boot sequences).
     */
    setPC(pc: number): void;
    /**
     * Run for at least `cycles` T-states. Returns actual cycles run.
     */
    step(cycles: number): number;
    /**
     * Total trace entries written so far (use as cursor for incremental reads).
     */
    traceTotal(): bigint;
    /**
     * Write a byte to emulated memory.
     */
    writeMemory(addr: number, value: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_emulator_free: (a: number, b: number) => void;
    readonly emulator_addBreakpoint: (a: number, b: number) => void;
    readonly emulator_clearBreakpoints: (a: number) => void;
    readonly emulator_getDazzlerFrame: (a: number) => [number, number];
    readonly emulator_getDiskData: (a: number, b: number) => [number, number];
    readonly emulator_getSerialOutput: (a: number) => [number, number];
    readonly emulator_getState: (a: number) => [number, number];
    readonly emulator_getTrace: (a: number, b: bigint, c: number) => [number, number];
    readonly emulator_getVdmFrame: (a: number) => [number, number];
    readonly emulator_insertDisk: (a: number, b: number, c: number, d: number) => void;
    readonly emulator_ioWrite: (a: number, b: number, c: number) => void;
    readonly emulator_loadBinary: (a: number, b: number, c: number, d: number) => void;
    readonly emulator_loadMachine: (a: number, b: number, c: number) => [number, number];
    readonly emulator_new: () => number;
    readonly emulator_readMemory: (a: number, b: number) => number;
    readonly emulator_removeBreakpoint: (a: number, b: number) => void;
    readonly emulator_reset: (a: number) => void;
    readonly emulator_sendSerialInput: (a: number, b: number) => void;
    readonly emulator_sendSerialString: (a: number, b: number, c: number) => void;
    readonly emulator_setPC: (a: number, b: number) => void;
    readonly emulator_step: (a: number, b: number) => number;
    readonly emulator_traceTotal: (a: number) => bigint;
    readonly emulator_writeMemory: (a: number, b: number, c: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
