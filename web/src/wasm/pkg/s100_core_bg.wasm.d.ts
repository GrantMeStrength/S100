/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const __wbg_emulator_free: (a: number, b: number) => void;
export const emulator_getDazzlerFrame: (a: number) => [number, number];
export const emulator_getDiskData: (a: number, b: number) => [number, number];
export const emulator_getSerialOutput: (a: number) => [number, number];
export const emulator_getState: (a: number) => [number, number];
export const emulator_getTrace: (a: number, b: bigint, c: number) => [number, number];
export const emulator_insertDisk: (a: number, b: number, c: number, d: number) => void;
export const emulator_loadBinary: (a: number, b: number, c: number, d: number) => void;
export const emulator_loadMachine: (a: number, b: number, c: number) => [number, number];
export const emulator_new: () => number;
export const emulator_readMemory: (a: number, b: number) => number;
export const emulator_reset: (a: number) => void;
export const emulator_sendSerialInput: (a: number, b: number) => void;
export const emulator_sendSerialString: (a: number, b: number, c: number) => void;
export const emulator_setPC: (a: number, b: number) => void;
export const emulator_step: (a: number, b: number) => number;
export const emulator_traceTotal: (a: number) => bigint;
export const emulator_writeMemory: (a: number, b: number, c: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
