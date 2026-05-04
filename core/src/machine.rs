use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bus::{Bus, BusInterface};
use crate::cards::{fdc::FloppyController, ram::RamCard, rom::RomCard, serial::SerialCard};
use crate::cpu::Cpu8080;

// ── Machine configuration types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SlotConfig {
    pub slot: u8,
    pub card: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Deserialize)]
pub struct MachineConfig {
    pub name: String,
    pub slots: Vec<SlotConfig>,
}

// ── CPU state snapshot (for getState) ────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CpuState {
    pub a: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
    pub sp: u16,
    pub pc: u16,
    pub flags: FlagState,
    pub halted: bool,
    pub interrupts_enabled: bool,
    pub cycles: u64,
}

#[derive(Debug, Serialize)]
pub struct FlagState {
    pub s: bool,
    pub z: bool,
    pub ac: bool,
    pub p: bool,
    pub cy: bool,
}

#[derive(Debug, Serialize)]
pub struct MachineState {
    pub name: String,
    pub cpu: CpuState,
    pub cards: Vec<String>,
    pub bus_cycles: u64,
}

// ── Machine ───────────────────────────────────────────────────────────────────

pub struct Machine {
    pub name: String,
    pub cpu: Cpu8080,
    pub bus: Bus,
    /// Index into bus.cards for the serial card (console I/O).
    pub serial_idx: Option<usize>,
    /// Index into bus.cards for the FDC card (disk I/O).
    pub fdc_idx: Option<usize>,
    /// Partial input line being assembled for BDOS function 10 (readline).
    input_line_buf: Vec<u8>,
    /// True when the user pressed Enter and a complete line is ready.
    input_line_ready: bool,
    /// Current DMA address used by BDOS disk functions (set by function 26).
    bdos_dma_addr: u16,
}

impl Machine {
    pub fn new() -> Self {
        Machine {
            name: String::from("S-100 System"),
            cpu: Cpu8080::new(),
            bus: Bus::new(),
            serial_idx: None,
            fdc_idx: None,
            input_line_buf: Vec::new(),
            input_line_ready: false,
            bdos_dma_addr: 0x0080,
        }
    }

    pub fn load_config(&mut self, json: &str) -> Result<(), String> {
        let config: MachineConfig =
            serde_json::from_str(json).map_err(|e| format!("parse error: {e}"))?;

        self.name = config.name.clone();
        self.cpu = Cpu8080::new();
        self.bus = Bus::new();
        self.serial_idx = None;
        self.fdc_idx = None;
        self.input_line_buf.clear();
        self.input_line_ready = false;
        self.bdos_dma_addr = 0x0080;

        // Validate: exactly one CPU card
        let cpu_count = config.slots.iter().filter(|s| s.card.starts_with("cpu_")).count();
        if cpu_count == 0 {
            return Err("machine must have at least one cpu_ card".into());
        }

        // Sort slots by slot number
        let mut slots = config.slots;
        slots.sort_by_key(|s| s.slot);

        for slot in &slots {
            match slot.card.as_str() {
                c if c.starts_with("cpu_") => {
                    // CPU is handled separately as self.cpu
                }

                "ram" | "ram_64k" => {
                    let base = slot.params.get("base")
                        .and_then(Value::as_u64).unwrap_or(0x0000) as u16;
                    let size = slot.params.get("size")
                        .and_then(Value::as_u64).unwrap_or(65536) as usize;
                    let name = format!("ram@{base:#06x}");
                    self.bus.add_card(Box::new(RamCard::new(name, base, size)));
                }

                "rom" => {
                    let base = slot.params.get("base")
                        .and_then(Value::as_u64).unwrap_or(0x0000) as u16;
                    let data = Self::load_rom_data(&slot.params)?;
                    let name = format!("rom@{base:#06x}");
                    self.bus.add_card(Box::new(RomCard::new(name, base, data)));
                }

                "serial" | "serial_sio" => {
                    let data_port = slot.params.get("data_port")
                        .and_then(Value::as_u64).unwrap_or(0x00) as u8;
                    let status_port = slot.params.get("status_port")
                        .and_then(Value::as_u64).unwrap_or(0x01) as u8;
                    let name = format!("serial@{data_port:#04x}");
                    self.serial_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(SerialCard::new(name, data_port, status_port)));
                }

                "fdc" => {
                    self.fdc_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(FloppyController::new("fdc")));
                }

                other => {
                    return Err(format!("unknown card type: {other}"));
                }
            }
        }

        Ok(())
    }

    fn load_rom_data(params: &Value) -> Result<Vec<u8>, String> {
        if let Some(hex) = params.get("data_hex").and_then(Value::as_str) {
            let hex = hex.replace(|c: char| c.is_whitespace(), "");
            (0..hex.len())
                .step_by(2)
                .map(|i| {
                    u8::from_str_radix(&hex[i..i + 2], 16)
                        .map_err(|e| format!("bad hex: {e}"))
                })
                .collect()
        } else if let Some(b64) = params.get("data_base64").and_then(Value::as_str) {
            base64_decode(b64).map_err(|e| format!("bad base64: {e}"))
        } else if let Some(size) = params.get("size").and_then(Value::as_u64) {
            let fill = params.get("fill")
                .and_then(Value::as_u64).unwrap_or(0xFF) as u8;
            Ok(vec![fill; size as usize])
        } else {
            Err("rom card needs data_hex, data_base64, or size param".into())
        }
    }

    /// Run for (at least) `cycles` T-states. Returns actual cycles run.
    pub fn step(&mut self, cycles: u32) -> u32 {
        let mut elapsed = 0u32;
        while elapsed < cycles {
            elapsed += self.cpu.step(&mut self.bus);

            // Handle BDOS trap (CALL 0x0005 intercepted by CPU)
            if self.cpu.bdos_pending {
                self.cpu.bdos_pending = false;
                let call_pc = self.cpu.bdos_call_pc;
                let handled = self.handle_bdos();
                if !handled {
                    // Not ready (waiting for input) — re-execute the CALL next tick
                    self.cpu.pc = call_pc;
                    break; // Yield to avoid busy-spinning burning the whole frame budget
                }
            }

            // Handle pending FDC DMA transfers
            self.handle_fdc_dma();

            self.bus.step_cards();
        }
        elapsed
    }

    pub fn reset(&mut self) {
        self.cpu.reset();
        self.bus.reset();
        self.input_line_buf.clear();
        self.input_line_ready = false;
        self.bdos_dma_addr = 0x0080;
    }

    pub fn get_state(&self) -> MachineState {
        let c = &self.cpu;
        MachineState {
            name: self.name.clone(),
            cpu: CpuState {
                a: c.a, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l,
                sp: c.sp, pc: c.pc,
                flags: FlagState {
                    s: c.flags.s, z: c.flags.z, ac: c.flags.ac,
                    p: c.flags.p, cy: c.flags.cy,
                },
                halted: c.halted,
                interrupts_enabled: c.interrupts_enabled,
                cycles: c.cycles,
            },
            cards: self.bus.cards.iter().map(|c| c.name().to_owned()).collect(),
            bus_cycles: self.bus.cycle_count,
        }
    }

    pub fn read_memory(&mut self, addr: u16) -> u8 {
        for card in &mut self.bus.cards {
            if let Some(data) = card.memory_read(addr) {
                return data;
            }
        }
        0xFF
    }

    pub fn write_memory(&mut self, addr: u16, value: u8) {
        for card in &mut self.bus.cards {
            card.memory_write(addr, value);
        }
    }

    // ── Serial I/O ─────────────────────────────────────────────────────────

    pub fn get_serial_output(&mut self) -> Vec<u8> {
        if let Some(idx) = self.serial_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(serial) = card.as_any_mut().downcast_mut::<SerialCard>() {
                    return serial.drain_tx();
                }
            }
        }
        vec![]
    }

    pub fn send_serial_input(&mut self, byte: u8) {
        if let Some(idx) = self.serial_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(serial) = card.as_any_mut().downcast_mut::<SerialCard>() {
                    serial.push_rx(byte);
                }
            }
        }
    }

    // ── Disk I/O ───────────────────────────────────────────────────────────

    pub fn insert_disk(&mut self, drive: u8, data: Vec<u8>) {
        if let Some(idx) = self.fdc_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(fdc) = card.as_any_mut().downcast_mut::<FloppyController>() {
                    fdc.insert_disk(drive as usize, data);
                }
            }
        }
    }

    pub fn get_disk_data(&self, drive: u8) -> Option<Vec<u8>> {
        if let Some(idx) = self.fdc_idx {
            if let Some(card) = self.bus.cards.get(idx) {
                if let Some(fdc) = card.as_any().downcast_ref::<FloppyController>() {
                    return fdc.drives[drive as usize & 3].clone();
                }
            }
        }
        None
    }

    // ── FDC DMA handler ────────────────────────────────────────────────────

    fn handle_fdc_dma(&mut self) {
        let fdc_idx = match self.fdc_idx { Some(i) => i, None => return };

        // Step 1: Take pending DMA info from FDC (short borrow, then release)
        let pending = {
            if let Some(fdc) = self.bus.cards.get_mut(fdc_idx)
                .and_then(|c| c.as_any_mut().downcast_mut::<FloppyController>())
            {
                fdc.pending_dma.take()
            } else {
                None
            }
        };

        let Some(dma) = pending else { return };

        if dma.is_read {
            // Copy sector data from FDC buffer to bus memory at DMA address
            for (i, &byte) in dma.data.iter().enumerate() {
                self.bus.mem_write(dma.addr.wrapping_add(i as u16), byte);
            }
        } else {
            // Step 2a: Read 128 bytes from bus memory at DMA address
            let mut data = [0u8; 128];
            for i in 0..128u16 {
                data[i as usize] = self.bus.mem_read(dma.addr.wrapping_add(i));
            }
            // Step 2b: Write to disk image in FDC (fresh borrow)
            if let Some(fdc) = self.bus.cards.get_mut(fdc_idx)
                .and_then(|c| c.as_any_mut().downcast_mut::<FloppyController>())
            {
                fdc.do_write(&data);
            }
        }
    }

    // ── BDOS trap handler ──────────────────────────────────────────────────

    /// Handle a BDOS call intercepted at CALL 0x0005.
    /// Returns `true` if the call was completed (CPU can continue),
    /// `false` if the call must wait (e.g. no console input available).
    fn handle_bdos(&mut self) -> bool {
        let function = self.cpu.c;
        let param_e  = self.cpu.e;
        let param_de = (self.cpu.d as u16) << 8 | self.cpu.e as u16;

        match function {
            // ── 0: System Reset (warm boot) ─────────────────────────────
            0 => {
                self.cpu.pc = 0xFA00;
                true
            }

            // ── 1: Console Input ────────────────────────────────────────
            1 => {
                // Try to get next character from serial RX
                self.process_console_input();
                if let Some(ch) = self.take_input_char() {
                    self.serial_out(ch); // echo
                    self.cpu.a = ch;
                    true
                } else {
                    false // Wait for input
                }
            }

            // ── 2: Console Output ────────────────────────────────────────
            2 => {
                self.serial_out(param_e);
                true
            }

            // ── 5: Printer Output (redirect to console) ──────────────────
            5 => {
                self.serial_out(param_e);
                true
            }

            // ── 6: Direct Console I/O ────────────────────────────────────
            6 => {
                if param_e == 0xFF {
                    // Return status
                    self.process_console_input();
                    self.cpu.a = if self.has_input() { 0xFF } else { 0x00 };
                    true
                } else if param_e == 0xFE {
                    // Get char without echo
                    self.process_console_input();
                    if let Some(ch) = self.take_input_char() {
                        self.cpu.a = ch;
                        true
                    } else {
                        self.cpu.a = 0;
                        true // Returns 0 immediately, no blocking
                    }
                } else {
                    // Output char
                    self.serial_out(param_e);
                    true
                }
            }

            // ── 9: Print String ──────────────────────────────────────────
            9 => {
                let mut addr = param_de;
                for _ in 0..65536u32 {
                    let ch = self.bus.mem_read(addr);
                    if ch == b'$' { break; }
                    self.serial_out(ch);
                    addr = addr.wrapping_add(1);
                }
                true
            }

            // ── 10: Read Console Buffer ──────────────────────────────────
            10 => {
                // Process any incoming characters into the line buffer
                self.process_console_input();

                if self.input_line_ready {
                    // Write result: [max_len, actual_len, chars...]
                    let max_len = self.bus.mem_read(param_de) as usize;
                    let line = core::mem::take(&mut self.input_line_buf);
                    self.input_line_ready = false;
                    let actual_len = line.len().min(max_len);
                    self.bus.mem_write(param_de.wrapping_add(1), actual_len as u8);
                    for (i, &ch) in line[..actual_len].iter().enumerate() {
                        self.bus.mem_write(
                            param_de.wrapping_add(2).wrapping_add(i as u16),
                            ch,
                        );
                    }
                    true
                } else {
                    false // Wait for Enter
                }
            }

            // ── 11: Get Console Status ───────────────────────────────────
            11 => {
                self.process_console_input();
                self.cpu.a = if self.has_input() { 0xFF } else { 0x00 };
                true
            }

            // ── 12: Return Version Number ────────────────────────────────
            12 => {
                // B=0x22 (CP/M), A=0x00 (8080)
                self.cpu.b = 0x22;
                self.cpu.a = 0x00;
                self.cpu.h = 0x00;
                self.cpu.l = 0x22;
                true
            }

            // ── 13: Reset Disk System ────────────────────────────────────
            13 => {
                self.cpu.a = 0;
                self.cpu.h = 0;
                self.cpu.l = 0;
                true
            }

            // ── 14: Select Disk ──────────────────────────────────────────
            14 => {
                let drive = param_e as usize & 3;
                if let Some(fdc_idx) = self.fdc_idx {
                    if let Some(fdc) = self.bus.cards.get_mut(fdc_idx)
                        .and_then(|c| c.as_any_mut().downcast_mut::<FloppyController>())
                    {
                        fdc.selected_drive = drive;
                    }
                }
                self.cpu.a = 0;
                true
            }

            // ── 15: Open File ─────────────────────────────────────────────
            15 => { self.cpu.a = 0xFF; true } // stub: not found

            // ── 16: Close File ────────────────────────────────────────────
            16 => { self.cpu.a = 0xFF; true }

            // ── 17: Search First ──────────────────────────────────────────
            17 => { self.cpu.a = 0xFF; true }

            // ── 18: Search Next ───────────────────────────────────────────
            18 => { self.cpu.a = 0xFF; true }

            // ── 19: Delete File ───────────────────────────────────────────
            19 => { self.cpu.a = 0xFF; true }

            // ── 20: Read Sequential ───────────────────────────────────────
            20 => { self.cpu.a = 1; true }

            // ── 21: Write Sequential ──────────────────────────────────────
            21 => { self.cpu.a = 1; true }

            // ── 22: Make File ─────────────────────────────────────────────
            22 => { self.cpu.a = 0xFF; true }

            // ── 25: Get Current Disk ──────────────────────────────────────
            25 => {
                let disk = if let Some(fdc_idx) = self.fdc_idx {
                    if let Some(fdc) = self.bus.cards.get(fdc_idx)
                        .and_then(|c| c.as_any().downcast_ref::<FloppyController>())
                    {
                        fdc.selected_drive as u8
                    } else { 0 }
                } else { 0 };
                self.cpu.a = disk;
                true
            }

            // ── 26: Set DMA Address ───────────────────────────────────────
            26 => {
                self.bdos_dma_addr = param_de;
                if let Some(fdc_idx) = self.fdc_idx {
                    if let Some(fdc) = self.bus.cards.get_mut(fdc_idx)
                        .and_then(|c| c.as_any_mut().downcast_mut::<FloppyController>())
                    {
                        fdc.dma_addr = param_de;
                    }
                }
                true
            }

            // ── 32: Get/Set User Code ─────────────────────────────────────
            32 => {
                self.cpu.a = 0; // User 0
                true
            }

            _ => {
                self.cpu.a = 0;
                true
            }
        }
    }

    // ── Console helpers ────────────────────────────────────────────────────

    /// Drain serial RX buffer, assembling characters into the input line buffer.
    /// Echoes characters and handles backspace. Returns true if a line is now ready.
    fn process_console_input(&mut self) -> bool {
        let idx = match self.serial_idx { Some(i) => i, None => return false };

        // Drain all available chars in one borrow block
        let chars: Vec<u8> = {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(serial) = card.as_any_mut().downcast_mut::<SerialCard>() {
                    serial.rx_buf.drain(..).collect()
                } else { vec![] }
            } else { vec![] }
        };

        for ch in chars {
            match ch {
                b'\r' | b'\n' => {
                    self.input_line_ready = true;
                    // Echo CRLF
                    self.serial_out(b'\r');
                    self.serial_out(b'\n');
                }
                0x08 | 0x7F => {
                    // Backspace
                    if !self.input_line_buf.is_empty() {
                        self.input_line_buf.pop();
                        self.serial_out(0x08);
                        self.serial_out(0x20);
                        self.serial_out(0x08);
                    }
                }
                ch => {
                    self.input_line_buf.push(ch);
                    self.serial_out(ch); // echo
                }
            }
        }

        self.input_line_ready
    }

    /// Take the next character from the input buffer (for CONIN / function 1).
    fn take_input_char(&mut self) -> Option<u8> {
        if !self.input_line_buf.is_empty() {
            return Some(self.input_line_buf.remove(0));
        }
        // Also try the serial RX directly for raw char input
        let idx = self.serial_idx?;
        if let Some(card) = self.bus.cards.get_mut(idx) {
            if let Some(serial) = card.as_any_mut().downcast_mut::<SerialCard>() {
                return serial.rx_buf.pop_front();
            }
        }
        None
    }

    fn has_input(&self) -> bool {
        if !self.input_line_buf.is_empty() { return true; }
        if let Some(idx) = self.serial_idx {
            if let Some(card) = self.bus.cards.get(idx) {
                if let Some(serial) = card.as_any().downcast_ref::<SerialCard>() {
                    return !serial.rx_buf.is_empty();
                }
            }
        }
        false
    }

    fn serial_out(&mut self, ch: u8) {
        if let Some(idx) = self.serial_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(serial) = card.as_any_mut().downcast_mut::<SerialCard>() {
                    serial.tx_buf.push_back(ch);
                }
            }
        }
    }
}

// ── Minimal base64 decoder ────────────────────────────────────────────────────

fn base64_decode(input: &str) -> Result<Vec<u8>, &'static str> {
    const TABLE: &[u8; 128] = b"\
\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\
\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\
\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\xff\x3e\xff\xff\xff\x3f\
\x34\x35\x36\x37\x38\x39\x3a\x3b\x3c\x3d\xff\xff\xff\x00\xff\xff\
\xff\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\
\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\xff\xff\xff\xff\xff\
\xff\x1a\x1b\x1c\x1d\x1e\x1f\x20\x21\x22\x23\x24\x25\x26\x27\x28\
\x29\x2a\x2b\x2c\x2d\x2e\x2f\x30\x31\x32\x33\xff\xff\xff\xff\xff";

    let input = input.trim().replace('\n', "").replace('\r', "");
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let bytes = input.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        let a = *TABLE.get(bytes[i] as usize).ok_or("invalid char")? ;
        let b = *TABLE.get(bytes[i+1] as usize).ok_or("invalid char")?;
        let c = *TABLE.get(bytes[i+2] as usize).ok_or("invalid char")?;
        let d = *TABLE.get(bytes[i+3] as usize).ok_or("invalid char")?;
        if a == 0xFF || b == 0xFF { return Err("invalid char"); }
        out.push((a << 2) | (b >> 4));
        if bytes[i+2] != b'=' { out.push(((b & 0xF) << 4) | (c >> 2)); }
        if bytes[i+3] != b'=' { out.push(((c & 0x3) << 6) | d); }
        i += 4;
    }
    Ok(out)
}

