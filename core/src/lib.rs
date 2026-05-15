mod bus;
mod card;
mod cards;
mod cpu;
mod cpu_z80;
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

    /// Set the CPU program counter directly (used for ROM-based boot sequences).
    #[wasm_bindgen(js_name = setPC)]
    pub fn set_pc(&mut self, pc: u16) {
        self.machine.set_pc(pc);
    }

    /// Render the Dazzler frame buffer to RGBA pixels.
    /// Returns [width_lo, width_hi, height_lo, height_hi, ...rgba_bytes],
    /// or an empty array if no Dazzler card is present or the display is disabled.
    #[wasm_bindgen(js_name = getDazzlerFrame)]
    pub fn get_dazzler_frame(&mut self) -> Vec<u8> {
        self.machine.get_dazzler_frame()
    }

    /// Return the raw 1024-byte VDM-1 VRAM, or an empty Uint8Array if no VDM card is present.
    /// Each byte: bit 7 = inverse video, bits 6–0 = ASCII character code.
    #[wasm_bindgen(js_name = getVdmFrame)]
    pub fn get_vdm_frame(&self) -> Vec<u8> {
        self.machine.get_vdm_frame()
    }

    /// Add a breakpoint at the given address.
    #[wasm_bindgen(js_name = addBreakpoint)]
    pub fn add_breakpoint(&mut self, addr: u16) {
        self.machine.breakpoints.insert(addr);
    }

    /// Remove a breakpoint at the given address.
    #[wasm_bindgen(js_name = removeBreakpoint)]
    pub fn remove_breakpoint(&mut self, addr: u16) {
        self.machine.breakpoints.remove(&addr);
    }

    /// Remove all breakpoints.
    #[wasm_bindgen(js_name = clearBreakpoints)]
    pub fn clear_breakpoints(&mut self) {
        self.machine.breakpoints.clear();
    }
}

#[cfg(test)]
mod tests {
    use crate::machine::Machine;

    fn b64_encode(data: &[u8]) -> String {
        const C: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        let mut i = 0;
        while i < data.len() {
            let b0 = data[i] as u32;
            let b1 = if i+1 < data.len() { data[i+1] as u32 } else { 0 };
            let b2 = if i+2 < data.len() { data[i+2] as u32 } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(C[((n >> 18) & 63) as usize] as char);
            out.push(C[((n >> 12) & 63) as usize] as char);
            out.push(if i+1 < data.len() { C[((n >>  6) & 63) as usize] as char } else { '=' });
            out.push(if i+2 < data.len() { C[( n        & 63) as usize] as char } else { '=' });
            i += 3;
        }
        out
    }

    fn run_monitor(rom_path: &str, base: u64, entry: u16,
                   data_port: u64, status_port: u64, srx_bit: u64, stx_bit: u64,
                   srx_inv: bool, stx_inv: bool) -> String {
        let rom = match std::fs::read(rom_path) {
            Ok(r) => r,
            Err(_) => return String::from("SKIP"),
        };
        let b64 = b64_encode(&rom);
        let json = format!(r#"{{"name":"T","slots":[
            {{"slot":0,"card":"cpu_8080","params":{{}}}},
            {{"slot":1,"card":"ram","params":{{"base":0,"size":{base}}}}},
            {{"slot":2,"card":"serial","params":{{"data_port":{data_port},"status_port":{status_port},
                "status_rx_bit":{srx_bit},"status_tx_bit":{stx_bit},
                "status_rx_invert":{srx_inv},"status_tx_invert":{stx_inv}}}}},
            {{"slot":3,"card":"rom","params":{{"base":{base},"data_base64":"{b64}"}}}}
        ]}}"#);
        let mut m = Machine::new();
        m.load_config(&json).expect("load_config");
        m.write_memory(0, 0xC3);
        m.write_memory(1, (entry & 0xFF) as u8);
        m.write_memory(2, (entry >> 8) as u8);
        let mut output = String::new();
        for _ in 0..400 {
            m.step(50_000);
            let out = m.get_serial_output();
            if !out.is_empty() {
                output.push_str(&String::from_utf8_lossy(&out));
                if output.len() > 32 { break; }
            }
        }
        output
    }

    #[test]
    fn test_ssm_monitor_boots() {
        // SSM AIO: data=0x01, status=0x00, inverted polarity
        let out = run_monitor("../web/public/roms/ssm_mon.bin", 61440, 0xF000,
                              1, 0, 0, 7, true, true);
        if out == "SKIP" { return; }
        eprintln!("SSM output: {:?}", out);
        assert!(out.contains("MONITOR"), "SSM banner missing, got: {:?}", out);
    }

    #[test]
    fn test_amon_monitor_boots() {
        // AMON: 88-2SIO data=0x11, status=0x10, normal polarity
        let out = run_monitor("../web/public/roms/amon31.bin", 61440, 0xF800,
                              0x11, 0x10, 0, 1, false, false);
        if out == "SKIP" { return; }
        eprintln!("AMON output: {:?}", out);
        assert!(out.len() > 2, "AMON produced no output: {:?}", out);
    }

}

