use std::any::Any;
use crate::card::S100Card;

/// JAIR-style "Shadow ROM" boot card.
///
/// Sits at address 0x0000 and contains a tiny bootstrap that:
///   1. Writes to the phantom port (disabling this card)
///   2. Jumps back to 0x0000, which now hits the RAM card underneath
///
/// Modelled on the JAIR 8080 CPU board by Josh Bensadon (CrustyOMO):
///   https://www.s100computers.com/My%20System%20Pages/8080%20CPU%20Board/8080%20CPU%20Board.htm
/// The JAIR uses I/O port 0x71 (SD card control register, bit 1 low) to
/// disable the shadow ROM and illuminate/extinguish the "SHADOW ROM" LED.
pub struct BootRomCard {
    name: String,
    data: Vec<u8>,
    phantom_port: u8,
    /// True while the ROM is visible on the bus; false once paged out.
    pub active: bool,
}

impl BootRomCard {
    /// Build a 256-byte shadow ROM whose bootstrap pages itself out via
    /// `phantom_port` then jumps to 0x0000 (hitting RAM underneath).
    pub fn new(name: impl Into<String>, phantom_port: u8) -> Self {
        let mut data = vec![0xFF_u8; 256]; // 0xFF = undefined / halted filler
        // MVI A, 0x00
        data[0] = 0x3E;
        data[1] = 0x00;
        // OUT phantom_port  — disables this card (JAIR: port 0x71)
        data[2] = 0xD3;
        data[3] = phantom_port;
        // JMP 0x0000  — now hits the RAM card underneath
        data[4] = 0xC3;
        data[5] = 0x00;
        data[6] = 0x00;

        BootRomCard { name: name.into(), data, phantom_port, active: true }
    }
}

impl S100Card for BootRomCard {
    fn as_any(&self)     -> &dyn Any     { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }

    fn name(&self) -> &str { &self.name }

    /// Re-enable the ROM whenever the machine is reset (power cycle).
    fn reset(&mut self) { self.active = true; }

    fn memory_read(&mut self, addr: u16) -> Option<u8> {
        if self.active && (addr as usize) < self.data.len() {
            Some(self.data[addr as usize])
        } else {
            None
        }
    }

    fn memory_write(&mut self, _addr: u16, _data: u8) {
        // ROM ignores writes — the RAM card underneath accepts them.
    }

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }

    /// Any write to the phantom port pages out the shadow ROM (JAIR behaviour).
    fn io_write(&mut self, port: u8, _data: u8) {
        if port == self.phantom_port {
            self.active = false;
        }
    }

    fn owns_mem(&self, addr: u16) -> bool {
        self.active && (addr as usize) < self.data.len()
    }
}
