use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bus::{Bus, BusInterface};
use crate::cards::{
    boot_rom::BootRomCard,
    cpu_z80::Z80Card,
    dazzler::DazzlerCard,
    dcdd::Dcdd88Card,
    fdc::FloppyController,
    fdc_fif::FifCard,
    fdc_wd1793::WD1793Card,
    ram::RamCard,
    rom::RomCard,
    serial::SerialCard,
    sio_88::Sio88Card,
};
use crate::cpu::Cpu8080;
use crate::cpu_z80::CpuZ80;

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
    /// Optional startup program counter. If set, the CPU begins execution here
    /// instead of 0x0000. Useful for machines that load a boot ROM into RAM.
    pub startup_pc: Option<u16>,
}

// ── CPU state snapshot (for getState) ────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CpuState {
    pub cpu_type: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ix: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iy: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iff2: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interrupt_mode: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alternate: Option<AltRegisterState>,
}

#[derive(Debug, Serialize)]
pub struct FlagState {
    pub s: bool,
    pub z: bool,
    pub ac: bool,
    pub p: bool,
    pub cy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pv: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AltRegisterState {
    pub a: u8,
    pub f: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
}

#[derive(Debug, Serialize)]
pub struct MachineState {
    pub name: String,
    pub cpu: CpuState,
    pub cards: Vec<String>,
    pub bus_cycles: u64,
    /// Last value written to I/O port 0xFF (IMSAI Programmed Output latch).
    pub programmed_output: u8,
}

// ── Machine ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActiveCpu {
    I8080,
    Z80,
}

pub struct Machine {
    pub name: String,
    pub cpu: Cpu8080,
    pub cpu_z80: Option<CpuZ80>,
    active_cpu: ActiveCpu,
    pub bus: Bus,
    pub serial_idx: Option<usize>,
    pub fdc_idx: Option<usize>,
    pub fif_idx: Option<usize>,
    pub dazzler_idx: Option<usize>,
    /// IMSAI Programmed Output latch — captures the last byte written to port 0xFF.
    pub programmed_output: u8,
}

impl Machine {
    pub fn new() -> Self {
        Machine {
            name: String::from("S-100 System"),
            cpu: Cpu8080::new(),
            cpu_z80: None,
            active_cpu: ActiveCpu::I8080,
            bus: Bus::new(),
            serial_idx: None,
            fdc_idx: None,
            fif_idx: None,
            dazzler_idx: None,
            programmed_output: 0,
        }
    }

    pub fn load_config(&mut self, json: &str) -> Result<(), String> {
        let config: MachineConfig =
            serde_json::from_str(json).map_err(|e| format!("parse error: {e}"))?;

        self.name = config.name.clone();
        self.cpu = Cpu8080::new();
        self.cpu_z80 = None;
        self.active_cpu = ActiveCpu::I8080;
        self.bus = Bus::new();
        self.serial_idx = None;
        self.fdc_idx = None;
        self.fif_idx = None;
        self.dazzler_idx = None;
        self.programmed_output = 0;

        // Validate: exactly one CPU card
        let cpu_count = config.slots.iter().filter(|s| s.card.starts_with("cpu_")).count();
        if cpu_count == 0 {
            return Err("machine must have at least one cpu_ card".into());
        }
        if cpu_count > 1 {
            return Err("machine must have exactly one cpu_ card".into());
        }

        // Sort slots by slot number
        let mut slots = config.slots;
        slots.sort_by_key(|s| s.slot);

        for slot in &slots {
            match slot.card.as_str() {
                "cpu_8080" => {
                    self.active_cpu = ActiveCpu::I8080;
                    let _speed_hz = slot.params.get("speed_hz")
                        .and_then(Value::as_u64).unwrap_or(2_000_000);
                }

                "cpu_z80" => {
                    let speed_hz = slot.params.get("speed_hz")
                        .and_then(Value::as_u64).unwrap_or(4_000_000);
                    let card = Z80Card::new(speed_hz);
                    let _ = (card.speed_hz(), card.cycles_per_tick(), card.cycle_accumulator());
                    self.cpu_z80 = Some(card.into_cpu());
                    self.active_cpu = ActiveCpu::Z80;
                }

                c if c.starts_with("cpu_") => {
                    return Err(format!("unknown cpu card type: {c}"));
                }

                "boot_rom" => {
                    let phantom_port = slot.params.get("phantom_port")
                        .and_then(Value::as_u64).unwrap_or(0x71) as u8;
                    self.bus.add_card(Box::new(BootRomCard::new("boot_rom", phantom_port)));
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
                    let tx_port = slot.params.get("tx_port")
                        .and_then(Value::as_u64).unwrap_or(data_port as u64) as u8;
                    let rx_port = slot.params.get("rx_port")
                        .and_then(Value::as_u64).unwrap_or(data_port as u64) as u8;
                    let rx_status_port = slot.params.get("rx_status_port")
                        .and_then(Value::as_u64).unwrap_or(status_port as u64) as u8;
                    let status_rx_bit = slot.params.get("status_rx_bit")
                        .and_then(Value::as_u64).unwrap_or(0) as u8;
                    let status_tx_bit = slot.params.get("status_tx_bit")
                        .and_then(Value::as_u64).unwrap_or(1) as u8;
                    let status_rx_invert = slot.params.get("status_rx_invert")
                        .and_then(Value::as_bool).unwrap_or(false);
                    let status_tx_invert = slot.params.get("status_tx_invert")
                        .and_then(Value::as_bool).unwrap_or(false);
                    let name = format!("serial@{tx_port:#04x}");
                    self.serial_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(SerialCard::with_ports(
                        name, tx_port, rx_port, status_port, rx_status_port,
                        status_rx_bit, status_tx_bit,
                        status_rx_invert, status_tx_invert,
                    )));
                }

                "fdc" => {
                    self.fdc_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(FloppyController::new("fdc")));
                }

                "dcdd_88" => {
                    self.fdc_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(Dcdd88Card::new("88-DCDD")));
                }

                "sio_88_2sio" => {
                    self.serial_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(Sio88Card::new("88-2SIO")));
                }

                "dazzler" => {
                    self.dazzler_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(DazzlerCard::new("Dazzler")));
                }

                "fdc_wd1793" => {
                    let base = slot.params.get("base_port")
                        .and_then(Value::as_u64).unwrap_or(0x34) as u8;
                    let sel = slot.params.get("drive_select_port")
                        .and_then(Value::as_u64).unwrap_or(0x30) as u8;
                    let tracks = slot.params.get("tracks")
                        .and_then(Value::as_u64).unwrap_or(77) as u8;
                    let sectors = slot.params.get("sectors")
                        .and_then(Value::as_u64).unwrap_or(26) as u8;
                    let sector_size = slot.params.get("sector_size")
                        .and_then(Value::as_u64).unwrap_or(128) as usize;
                    self.fdc_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(WD1793Card::new(
                        "WD1793", base, sel, tracks, sectors, sector_size,
                    )));
                }

                "fdc_fif" => {
                    let tracks = slot.params.get("tracks")
                        .and_then(Value::as_u64).unwrap_or(77) as u8;
                    let sectors = slot.params.get("sectors")
                        .and_then(Value::as_u64).unwrap_or(26) as u8;
                    let sector_size = slot.params.get("sector_size")
                        .and_then(Value::as_u64).unwrap_or(128) as usize;
                    self.fif_idx = Some(self.bus.cards.len());
                    self.bus.add_card(Box::new(FifCard::new(
                        "FIF-FDC", tracks, sectors, sector_size,
                    )));
                }

                other => {
                    return Err(format!("unknown card type: {other}"));
                }
            }
        }

        if let Some(pc) = config.startup_pc {
            self.set_pc(pc);
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
            elapsed += match self.active_cpu {
                ActiveCpu::I8080 => self.cpu.step(&mut self.bus),
                ActiveCpu::Z80 => self.cpu_z80.as_mut().map(|cpu| cpu.step(&mut self.bus)).unwrap_or_else(|| self.cpu.step(&mut self.bus)),
            };

            // Capture IMSAI Programmed Output port (0xFF) — check the most recent trace entry
            if let Some(entry) = self.bus.trace.last() {
                if entry.op == crate::trace::OpKind::IoWrite && entry.address == 0xFF {
                    self.programmed_output = entry.data;
                }
            }

            // FIF FDC DMA: if the FIF card received an execute command, perform the
            // DMA transfer now (between CPU steps) so the next cpu.step() sees the
            // result byte already written to RAM.
            if let Some(fif_idx) = self.fif_idx {
                let pending = self.bus.cards.get(fif_idx)
                    .and_then(|c| c.as_any().downcast_ref::<FifCard>())
                    .map_or(false, |f| f.pending_execute);

                if pending {
                    self.execute_fif_dma(fif_idx);
                }
            }

            self.bus.step_cards();
        }
        elapsed
    }

    /// Execute a pending FIF DMA transfer.
    /// Uses std::mem::replace to temporarily extract the FIF card from the bus so
    /// we can call bus.mem_read/write (which need &mut Bus) while also holding the
    /// card data.
    fn execute_fif_dma(&mut self, fif_idx: usize) {
        // Extract FIF card from bus, leaving a no-op placeholder.
        let placeholder: Box<dyn crate::card::S100Card> = Box::new(DummyCard);
        let mut fif_box = std::mem::replace(&mut self.bus.cards[fif_idx], placeholder);
        let fif = match fif_box.as_any_mut().downcast_mut::<FifCard>() {
            Some(f) => f,
            None => {
                self.bus.cards[fif_idx] = fif_box;
                return;
            }
        };

        fif.pending_execute = false;

        let desc_addr = match fif.desc_addr {
            Some(a) => a,
            None => {
                self.bus.cards[fif_idx] = fif_box;
                return;
            }
        };

        // Read 7-byte descriptor from RAM.
        let desc: [u8; 7] = core::array::from_fn(|i| {
            <Bus as BusInterface>::mem_read(&mut self.bus, desc_addr.wrapping_add(i as u16))
        });

        let cmd       = desc[0];
        let op        = cmd >> 4;          // 2=read, 1=write
        let drive_bits = cmd & 0x0F;
        let track     = desc[3];
        let sector    = desc[4];
        let dma_addr  = u16::from_le_bytes([desc[5], desc[6]]);

        let drive_idx = FifCard::decode_drive(drive_bits).unwrap_or(0);

        let result: u8 = match op {
            2 => {
                // Read sector → copy to DMA buffer in RAM
                match fif.execute_read(track, sector, drive_idx) {
                    Some(data) => {
                        for (i, &byte) in data.iter().enumerate() {
                            <Bus as BusInterface>::mem_write(
                                &mut self.bus,
                                dma_addr.wrapping_add(i as u16),
                                byte,
                            );
                        }
                        1
                    }
                    None => 2,
                }
            }
            1 => {
                // Write sector — read data from DMA buffer in RAM first
                let size = fif.sector_size;
                let data: Vec<u8> = (0..size as u16)
                    .map(|i| <Bus as BusInterface>::mem_read(
                        &mut self.bus, dma_addr.wrapping_add(i),
                    ))
                    .collect();
                if fif.execute_write(track, sector, drive_idx, &data) { 1 } else { 2 }
            }
            _ => 0xFF,
        };

        // Write result code to desc[1] so the polling loop sees completion.
        <Bus as BusInterface>::mem_write(
            &mut self.bus,
            desc_addr.wrapping_add(1),
            result,
        );

        // Put the FIF card back.
        self.bus.cards[fif_idx] = fif_box;
    }

    pub fn reset(&mut self) {
        self.cpu.reset();
        if let Some(cpu) = self.cpu_z80.as_mut() {
            cpu.reset();
        }
        self.bus.reset();
    }

    pub fn set_pc(&mut self, pc: u16) {
        match self.active_cpu {
            ActiveCpu::I8080 => self.cpu.pc = pc,
            ActiveCpu::Z80 => {
                if let Some(cpu) = self.cpu_z80.as_mut() {
                    cpu.pc = pc;
                } else {
                    self.cpu.pc = pc;
                }
            }
        }
    }

    pub fn get_state(&self) -> MachineState {
        let cpu = match self.active_cpu {
            ActiveCpu::I8080 => {
                let c = &self.cpu;
                CpuState {
                    cpu_type: "8080".to_owned(),
                    a: c.a, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l,
                    sp: c.sp, pc: c.pc,
                    flags: FlagState {
                        s: c.flags.s, z: c.flags.z, ac: c.flags.ac,
                        p: c.flags.p, cy: c.flags.cy,
                        h: None, pv: None, n: None,
                    },
                    halted: c.halted,
                    interrupts_enabled: c.interrupts_enabled,
                    cycles: c.cycles,
                    ix: None,
                    iy: None,
                    i: None,
                    r: None,
                    iff2: None,
                    interrupt_mode: None,
                    alternate: None,
                }
            }
            ActiveCpu::Z80 => {
                let c = self.cpu_z80.as_ref().unwrap_or_else(|| unreachable!("active Z80 missing"));
                CpuState {
                    cpu_type: "Z80".to_owned(),
                    a: c.a, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l,
                    sp: c.sp, pc: c.pc,
                    flags: FlagState {
                        s: c.f & 0x80 != 0,
                        z: c.f & 0x40 != 0,
                        ac: c.f & 0x10 != 0,
                        p: c.f & 0x04 != 0,
                        cy: c.f & 0x01 != 0,
                        h: Some(c.f & 0x10 != 0),
                        pv: Some(c.f & 0x04 != 0),
                        n: Some(c.f & 0x02 != 0),
                    },
                    halted: c.halted,
                    interrupts_enabled: c.iff1,
                    cycles: c.cycles,
                    ix: Some(c.ix),
                    iy: Some(c.iy),
                    i: Some(c.i),
                    r: Some(c.r),
                    iff2: Some(c.iff2),
                    interrupt_mode: Some(c.interrupt_mode),
                    alternate: Some(AltRegisterState {
                        a: c.a_, f: c.f_, b: c.b_, c: c.c_, d: c.d_, e: c.e_, h: c.h_, l: c.l_,
                    }),
                }
            }
        };

        MachineState {
            name: self.name.clone(),
            cpu,
            cards: self.bus.cards.iter().map(|c| c.name().to_owned()).collect(),
            bus_cycles: self.bus.cycle_count,
            programmed_output: self.programmed_output,
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
                if let Some(sio) = card.as_any_mut().downcast_mut::<Sio88Card>() {
                    return sio.drain_tx();
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
                    return;
                }
                if let Some(sio) = card.as_any_mut().downcast_mut::<Sio88Card>() {
                    sio.push_rx(byte);
                }
            }
        }
    }

    // ── Disk I/O ───────────────────────────────────────────────────────────

    pub fn insert_disk(&mut self, drive: u8, data: Vec<u8>) {
        // FIF FDC
        if let Some(idx) = self.fif_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(fif) = card.as_any_mut().downcast_mut::<FifCard>() {
                    fif.insert_disk(drive as usize, data);
                    return;
                }
            }
        }
        // Legacy / WD1793 FDC
        if let Some(idx) = self.fdc_idx {
            if let Some(card) = self.bus.cards.get_mut(idx) {
                if let Some(fdc) = card.as_any_mut().downcast_mut::<FloppyController>() {
                    fdc.insert_disk(drive as usize, data);
                    return;
                }
                if let Some(dcdd) = card.as_any_mut().downcast_mut::<Dcdd88Card>() {
                    dcdd.insert_disk(drive as usize, data);
                    return;
                }
                if let Some(wd) = card.as_any_mut().downcast_mut::<WD1793Card>() {
                    wd.insert_disk(drive as usize, data);
                }
            }
        }
    }

    pub fn get_disk_data(&self, drive: u8) -> Option<Vec<u8>> {
        // FIF FDC
        if let Some(idx) = self.fif_idx {
            if let Some(card) = self.bus.cards.get(idx) {
                if let Some(fif) = card.as_any().downcast_ref::<FifCard>() {
                    return fif.drives[drive as usize & 3].clone();
                }
            }
        }
        // Legacy / WD1793 FDC
        if let Some(idx) = self.fdc_idx {
            if let Some(card) = self.bus.cards.get(idx) {
                if let Some(fdc) = card.as_any().downcast_ref::<FloppyController>() {
                    return fdc.drives[drive as usize & 3].clone();
                }
                if let Some(dcdd) = card.as_any().downcast_ref::<Dcdd88Card>() {
                    return dcdd.drives[drive as usize & 3].clone();
                }
                if let Some(wd) = card.as_any().downcast_ref::<WD1793Card>() {
                    return wd.drives[drive as usize & 3].clone();
                }
            }
        }
        None
    }

    /// Render the Dazzler frame buffer to RGBA pixels.
    /// Returns [width_lo, width_hi, height_lo, height_hi, ...rgba_bytes], or empty if
    /// no Dazzler card is present or the display is disabled.
    pub fn get_dazzler_frame(&mut self) -> Vec<u8> {
        let idx = match self.dazzler_idx { Some(i) => i, None => return vec![] };

        // Collect display parameters without holding a long borrow
        let (enabled, start, size) = {
            let d = match self.bus.cards.get(idx)
                .and_then(|c| c.as_any().downcast_ref::<DazzlerCard>()) {
                Some(d) => d,
                None => return vec![],
            };
            (d.enabled(), d.frame_buffer_start(), d.frame_buffer_size())
        };

        if !enabled { return vec![]; }

        // Passive peek — RamCard.memory_read() has no side effects
        let buf: Vec<u8> = (0..size)
            .map(|i| self.read_memory(start.wrapping_add(i as u16)))
            .collect();

        // Re-borrow to render (previous borrow is gone)
        let d = match self.bus.cards.get(idx)
            .and_then(|c| c.as_any().downcast_ref::<DazzlerCard>()) {
            Some(d) => d,
            None => return vec![],
        };

        match d.render_from_buf(&buf) {
            Some(rgba) => {
                let (w, h) = d.display_dims();
                let mut result = vec![w as u8, (w >> 8) as u8, h as u8, (h >> 8) as u8];
                result.extend_from_slice(&rgba);
                result
            }
            None => vec![],
        }
    }

}

// ── DummyCard — placeholder while FIF is extracted for DMA ───────────────────

struct DummyCard;

impl crate::card::S100Card for DummyCard {
    fn as_any(&self) -> &dyn std::any::Any { self }
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any { self }
    fn name(&self) -> &str { "_dummy" }
    fn reset(&mut self) {}
    fn memory_read(&mut self, _: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _: u16, _: u8) {}
    fn io_read(&mut self, _: u8) -> Option<u8> { None }
    fn io_write(&mut self, _: u8, _: u8) {}
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


#[cfg(test)]
mod basic_test {
    use super::*;
    #[test]
    fn test_basic_load_config() {
        let json = r#"{"name":"Altair 8800 BASIC","slots":[{"slot":0,"card":"cpu_8080","params":{"speed_hz":2000000}},{"slot":1,"card":"ram","params":{"base":0,"size":65536}},{"slot":2,"card":"serial","params":{"data_port":0,"status_port":1}}]}"#;
        let mut m = Machine::new();
        m.load_config(json).expect("BASIC config should load without error");
        // Run a few steps to confirm it doesn't panic
        m.step(1000);
        println!("PC after 1000 cycles: {:04X}", m.cpu.pc);
    }
}
