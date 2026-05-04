mod bus;
mod card;
mod cards;
mod cpu;
mod machine;
mod trace;

use machine::Machine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Emulator {
    machine: Machine,
}

#[wasm_bindgen]
impl Emulator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Emulator { machine: Machine::new() }
    }

    /// Load a machine definition from JSON. Returns an error string on failure.
    #[wasm_bindgen(js_name = loadMachine)]
    pub fn load_machine(&mut self, json: &str) -> Result<(), JsValue> {
        self.machine.load_config(json).map_err(|e| JsValue::from_str(&e))
    }

    /// Run for at least `cycles` T-states. Returns actual cycles run.
    #[wasm_bindgen]
    pub fn step(&mut self, cycles: u32) -> u32 {
        self.machine.step(cycles)
    }

    /// Reset CPU and all cards.
    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.machine.reset();
    }

    /// Get machine + CPU state as a JSON string.
    #[wasm_bindgen(js_name = getState)]
    pub fn get_state(&self) -> String {
        let state = self.machine.get_state();
        serde_json::to_string(&state).unwrap_or_default()
    }

    /// Get trace entries since `since_index` (up to `limit`) as JSON string.
    #[wasm_bindgen(js_name = getTrace)]
    pub fn get_trace(&self, since_index: u64, limit: u32) -> String {
        let entries = self.machine.bus.trace.since(since_index, limit as usize);
        let entries: Vec<_> = entries.iter().map(|e| *e).collect();
        serde_json::to_string(&entries).unwrap_or_default()
    }

    /// Total trace entries written so far (use as cursor for incremental reads).
    #[wasm_bindgen(js_name = traceTotal)]
    pub fn trace_total(&self) -> u64 {
        self.machine.bus.trace.total_written()
    }

    /// Read a byte from emulated memory (non-destructive peek).
    #[wasm_bindgen(js_name = readMemory)]
    pub fn read_memory(&mut self, addr: u16) -> u8 {
        self.machine.read_memory(addr)
    }

    /// Write a byte to emulated memory.
    #[wasm_bindgen(js_name = writeMemory)]
    pub fn write_memory(&mut self, addr: u16, value: u8) {
        self.machine.write_memory(addr, value);
    }

    /// Load a raw binary blob into memory starting at `base`.
    #[wasm_bindgen(js_name = loadBinary)]
    pub fn load_binary(&mut self, base: u16, data: &[u8]) {
        for (i, &byte) in data.iter().enumerate() {
            self.machine.write_memory(base.wrapping_add(i as u16), byte);
        }
    }

    /// Drain all bytes the CPU has sent to the serial TX buffer.
    /// Returns a UTF-8 string (non-UTF8 bytes become replacement chars).
    #[wasm_bindgen(js_name = getSerialOutput)]
    pub fn get_serial_output(&mut self) -> String {
        let bytes = self.machine.get_serial_output();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Push a byte into the serial RX buffer (keyboard input to the CPU).
    #[wasm_bindgen(js_name = sendSerialInput)]
    pub fn send_serial_input(&mut self, byte: u8) {
        self.machine.send_serial_input(byte);
    }

    /// Send a string of bytes to the serial RX buffer.
    #[wasm_bindgen(js_name = sendSerialString)]
    pub fn send_serial_string(&mut self, s: &str) {
        for b in s.bytes() {
            self.machine.send_serial_input(b);
        }
    }

    /// Insert a disk image into the specified drive (0=A, 1=B, 2=C, 3=D).
    #[wasm_bindgen(js_name = insertDisk)]
    pub fn insert_disk(&mut self, drive: u8, data: &[u8]) {
        self.machine.insert_disk(drive, data.to_vec());
    }

    /// Retrieve the current contents of a disk drive image (for saving).
    /// Returns an empty array if drive is not inserted.
    #[wasm_bindgen(js_name = getDiskData)]
    pub fn get_disk_data(&self, drive: u8) -> Vec<u8> {
        self.machine.get_disk_data(drive).unwrap_or_default()
    }
}
