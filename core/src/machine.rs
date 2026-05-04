use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bus::Bus;
use crate::cards::{ram::RamCard, rom::RomCard, serial::SerialCard};
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
    /// Index into bus.cards for the serial card (for frontend I/O).
    pub serial_idx: Option<usize>,
}

impl Machine {
    pub fn new() -> Self {
        Machine {
            name: String::from("S-100 System"),
            cpu: Cpu8080::new(),
            bus: Bus::new(),
            serial_idx: None,
        }
    }

    pub fn load_config(&mut self, json: &str) -> Result<(), String> {
        let config: MachineConfig =
            serde_json::from_str(json).map_err(|e| format!("parse error: {e}"))?;

        self.name = config.name.clone();
        self.cpu = Cpu8080::new();
        self.bus = Bus::new();
        self.serial_idx = None;

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
                    // CPU is handled separately as self.cpu — skip adding to bus
                    let _cpu_type = c.strip_prefix("cpu_").unwrap_or("8080");
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
            // Minimal base64 decode (standard alphabet)
            base64_decode(b64).map_err(|e| format!("bad base64: {e}"))
        } else if let Some(size) = params.get("size").and_then(Value::as_u64) {
            let fill = params.get("fill")
                .and_then(Value::as_u64).unwrap_or(0xFF) as u8;
            Ok(vec![fill; size as usize])
        } else {
            Err("rom card needs data_hex, data_base64, or size param".into())
        }
    }

    /// Run for (at least) `cycles` T-states.
    pub fn step(&mut self, cycles: u32) -> u32 {
        let mut elapsed = 0u32;
        while elapsed < cycles {
            elapsed += self.cpu.step(&mut self.bus);
            self.bus.step_cards();
        }
        elapsed
    }

    pub fn reset(&mut self) {
        self.cpu.reset();
        self.bus.reset();
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
