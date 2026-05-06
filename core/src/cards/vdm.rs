// Processor Technology VDM-1 video display card emulation
//
// The VDM-1 was the first practical memory-mapped video board for the S-100 bus.
// It was a pure memory-mapped device — no I/O ports at all.
//
// Display:  16 rows × 64 columns = 1024 characters
// Memory:   1024 bytes at a configurable 1K-aligned base address
//           Default: 0xCC00 (common for SOL-20 / S-100 SOLOS systems)
//
// Character encoding (per byte in VRAM):
//   bit 7   = inverse video (1 = swap fg/bg)
//   bits 6–0 = ASCII character code (0x00–0x7F)
//
// The character generator (MCM6574 / MCM6575 equivalent) produces 7×9 dot
// matrices for all 128 ASCII glyphs.  Rendering here uses the host canvas API.

use std::any::Any;
use crate::card::S100Card;

pub const COLS: usize = 64;
pub const ROWS: usize = 16;
pub const VRAM_SIZE: usize = COLS * ROWS; // 1024

pub struct VdmCard {
    name:      String,
    base_addr: u16,              // must be 1K-aligned (bits 9–0 == 0)
    pub vram:  [u8; VRAM_SIZE],  // screen buffer: vram[row*64 + col]
}

impl VdmCard {
    pub fn new(name: impl Into<String>, base_addr: u16) -> Self {
        // Fill with spaces (0x20) so the display shows a clean blank screen
        let vram = [0x20u8; VRAM_SIZE];
        VdmCard { name: name.into(), base_addr: base_addr & 0xFC00, vram }
    }
}

impl S100Card for VdmCard {
    fn as_any(&self)     -> &dyn Any     { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.vram = [0x20; VRAM_SIZE]; // blank display on reset
    }

    fn memory_read(&mut self, addr: u16) -> Option<u8> {
        let offset = addr.wrapping_sub(self.base_addr) as usize;
        if offset < VRAM_SIZE { Some(self.vram[offset]) } else { None }
    }

    fn memory_write(&mut self, addr: u16, data: u8) {
        let offset = addr.wrapping_sub(self.base_addr) as usize;
        if offset < VRAM_SIZE {
            self.vram[offset] = data;
        }
    }

    // No I/O ports — purely memory-mapped
    fn io_read(&mut self, _port: u8) -> Option<u8> { None }
    fn io_write(&mut self, _port: u8, _data: u8) {}
}
