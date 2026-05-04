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

    #[test]
    fn test_cpm_bdos_conout() {
        // Minimal test: BDOS fn 2 (CONOUT) outputs a character
        use crate::machine::Machine;
        let json = r#"{"name":"CPM","slots":[
            {"slot":0,"card":"cpu_8080","params":{}},
            {"slot":1,"card":"ram","params":{"base":0,"size":65536}},
            {"slot":2,"card":"serial","params":{"data_port":0,"status_port":1}},
            {"slot":3,"card":"fdc"}
        ]}"#;
        let mut m = Machine::new();
        m.load_config(json).expect("load_config");

        // Write tiny program at 0x0000:
        //   MVI C, 2       ; BDOS fn 2 = CONOUT
        //   MVI E, 'A'     ; char to print
        //   CALL 0x0005    ; BDOS entry
        //   MVI E, '>'
        //   CALL 0x0005
        //   HLT
        let prog: &[u8] = &[
            0x0E, 0x02,              // MVI C, 2
            0x1E, b'A',              // MVI E, 'A'
            0xCD, 0x05, 0x00,        // CALL 0x0005
            0x1E, b'>',              // MVI E, '>'
            0xCD, 0x05, 0x00,        // CALL 0x0005
            0x76,                    // HLT
        ];
        for (i, &b) in prog.iter().enumerate() { m.write_memory(i as u16, b); }
        // Note: CALL 0x0005 is intercepted by the CPU trap before it executes.
        // Don't write anything to address 5 — the trap handles it.

        let mut output = String::new();
        for _ in 0..20 {
            m.step(10_000);
            let out = m.get_serial_output();
            if !out.is_empty() { output.push_str(&String::from_utf8_lossy(&out)); }
        }
        eprintln!("BDOS CONOUT test output: {:?}", output);
        assert!(output.contains("A>"), "BDOS CONOUT should output 'A>', got: {:?}", output);
    }

    /// Load PIP.COM from disk via directory scan, run it, and verify it shows the '*' prompt.
    #[test]
    fn test_pip_runs() {
        let disk_path = "../web/public/CPM22.dsk";
        let disk = match std::fs::read(disk_path) {
            Ok(d) => d,
            Err(_) => { eprintln!("SKIP: CPM22.dsk not found"); return; }
        };

        const DATA_START: usize = 2 * 26 * 128;
        const BLOCK_SIZE: usize = 1024;
        const DIR_ENTRIES: usize = 64;

        // Find PIP.COM in directory (EX=0)
        let mut pip_blocks: Vec<usize> = Vec::new();
        let mut pip_rc = 0usize;
        for idx in 0..DIR_ENTRIES {
            let base = DATA_START + idx * 32;
            if disk[base] == 0xE5 { continue; }
            let name: Vec<u8> = (0..8).map(|i| disk[base+1+i] & 0x7F).collect();
            let ext: Vec<u8>  = (0..3).map(|i| disk[base+9+i] & 0x7F).collect();
            let ex = disk[base+12];
            if name.starts_with(b"PIP     ") && ext.starts_with(b"COM") && ex == 0 {
                pip_rc = disk[base+15] as usize;
                for b in 0..16 {
                    let blk = disk[base+16+b] as usize;
                    if blk != 0 { pip_blocks.push(blk); }
                }
                break;
            }
        }
        assert!(!pip_blocks.is_empty(), "PIP.COM not found in disk directory");

        let json = r#"{"name":"CPM","slots":[
            {"slot":0,"card":"cpu_8080","params":{}},
            {"slot":1,"card":"ram","params":{"base":0,"size":65536}},
            {"slot":2,"card":"serial","params":{"data_port":0,"status_port":1}},
            {"slot":3,"card":"fdc"}
        ]}"#;
        let mut m = Machine::new();
        m.load_config(json).expect("load_config");

        // Load PIP.COM directly from disk bytes into memory at 0x0100
        let mut load_addr: u16 = 0x0100;
        let mut total_loaded = 0usize;
        'outer: for &blk in &pip_blocks {
            for rec in 0..8usize {
                if total_loaded >= pip_rc { break 'outer; }
                let off = DATA_START + blk * BLOCK_SIZE + rec * 128;
                for i in 0..128usize {
                    m.write_memory(load_addr + i as u16, disk[off + i]);
                }
                load_addr += 128;
                total_loaded += 1;
            }
        }
        eprintln!("PIP loaded: {} sectors ({} bytes) at 0x0100..0x{:04X}",
            total_loaded, total_loaded * 128, load_addr);

        // Page zero setup
        m.write_memory(0x0000, 0xC3); m.write_memory(0x0001, 0x00); m.write_memory(0x0002, 0xFA);
        m.write_memory(0x0003, 0x00); m.write_memory(0x0004, 0x00);
        m.write_memory(0x0005, 0xC3); m.write_memory(0x0006, 0x05); m.write_memory(0x0007, 0xDC);
        m.write_memory(0xFA00, 0x76); // warm boot = HLT
        m.cpu.sp = 0xEFFF;
        m.cpu.pc = 0x0100;
        m.insert_disk(0, disk.clone());

        let mut output = String::new();
        for i in 0..8000 {
            m.step(50_000);
            let out = m.get_serial_output();
            if !out.is_empty() {
                let s = String::from_utf8_lossy(&out).into_owned();
                output.push_str(&s);
            }
            if m.cpu.halted {
                eprintln!("[iter {}] CPU halted at PC=0x{:04X}", i, m.cpu.pc);
                break;
            }
            if output.contains('*') || output.len() > 512 { break; }
        }
        eprintln!("PIP final output: {:?}", output);
        eprintln!("PIP final PC: 0x{:04X} SP=0x{:04X}", m.cpu.pc, m.cpu.sp);
        assert!(output.contains('*'), "PIP should print '*' prompt, got: {:?}", output);
    }

    /// Verify that BDOS fn 15 (Open) + fn 26 (Set DMA) + fn 20 (Read Seq) correctly
    /// loads the first sector of DUMP.COM from the real CPM22.dsk into memory at 0x0100.
    #[test]
    fn test_cpm_file_load() {
        let disk_path = "../web/public/CPM22.dsk";
        let disk = match std::fs::read(disk_path) {
            Ok(d) => d,
            Err(_) => { eprintln!("SKIP: CPM22.dsk not found"); return; }
        };

        const DATA_START: usize = 2 * 26 * 128;
        const BLOCK_SIZE: usize = 1024;
        const DIR_ENTRIES: usize = 64;

        // Find DUMP.COM first block dynamically
        let mut dump_first_block = 0usize;
        for idx in 0..DIR_ENTRIES {
            let base = DATA_START + idx * 32;
            if disk[base] == 0xE5 { continue; }
            let name: Vec<u8> = (0..8).map(|i| disk[base+1+i] & 0x7F).collect();
            let ext: Vec<u8>  = (0..3).map(|i| disk[base+9+i] & 0x7F).collect();
            if name.starts_with(b"DUMP    ") && ext.starts_with(b"COM") && disk[base+12] == 0 {
                dump_first_block = disk[base+16] as usize;
                break;
            }
        }
        assert!(dump_first_block != 0, "DUMP.COM not found in disk directory");

        let json = r#"{"name":"CPM","slots":[
            {"slot":0,"card":"cpu_8080","params":{}},
            {"slot":1,"card":"ram","params":{"base":0,"size":65536}},
            {"slot":2,"card":"serial","params":{"data_port":0,"status_port":1}},
            {"slot":3,"card":"fdc"}
        ]}"#;
        let mut m = Machine::new();
        m.load_config(json).expect("load_config");
        m.insert_disk(0, disk.clone());

        // FCB at 0xE000: drive=0, name="DUMP    ", ext="COM", rest=0
        let fcb_addr: u16 = 0xE000;
        m.write_memory(fcb_addr, 0x00); // drive A:
        for (i, &b) in b"DUMP    COM".iter().enumerate() {
            m.write_memory(fcb_addr + 1 + i as u16, b);
        }
        for i in 12..36u16 { m.write_memory(fcb_addr + i, 0x00); }

        // Small program: Open DUMP.COM, SetDMA 0x0100, ReadSeq, HLT
        let fcb_lo = (fcb_addr & 0xFF) as u8;
        let fcb_hi = (fcb_addr >> 8) as u8;
        let prog: &[u8] = &[
            0x0E, 15,               // MVI C, 15  (Open)
            0x11, fcb_lo, fcb_hi,  // LXI D, FCB
            0xCD, 0x05, 0x00,      // CALL BDOS
            0x0E, 26,               // MVI C, 26  (SetDMA)
            0x11, 0x00, 0x01,      // LXI D, 0x0100
            0xCD, 0x05, 0x00,      // CALL BDOS
            0x0E, 20,               // MVI C, 20  (ReadSeq)
            0x11, fcb_lo, fcb_hi,  // LXI D, FCB
            0xCD, 0x05, 0x00,      // CALL BDOS
            0x76,                   // HLT
        ];
        for (i, &b) in prog.iter().enumerate() { m.write_memory(i as u16, b); }

        for _ in 0..100 { m.step(10_000); }

        let expected_off = DATA_START + dump_first_block * BLOCK_SIZE;
        let expected_first = disk[expected_off];
        let expected_second = disk[expected_off + 1];
        let loaded_first = m.read_memory(0x0100);
        let loaded_second = m.read_memory(0x0101);

        eprintln!("DUMP.COM (block {}) first bytes: expected 0x{:02x} 0x{:02x}, got 0x{:02x} 0x{:02x}",
            dump_first_block, expected_first, expected_second, loaded_first, loaded_second);

        assert_eq!(loaded_first, expected_first,
            "First byte of DUMP.COM at 0x0100 mismatch");
        assert_eq!(loaded_second, expected_second,
            "Second byte of DUMP.COM at 0x0101 mismatch");
    }
}

