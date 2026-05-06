// Processor Technology VDM-1 video display card emulation
//
// The VDM-1 was the first practical memory-mapped video board for the S-100 bus.
//
// Display:  16 rows × 64 columns = 1024 characters
// Memory:   1024 bytes at a configurable 1K-aligned base address
//           Default: 0xCC00 (common for SOL-20 / S-100 SOLOS systems)
//
// I/O port: 0xFE (write-only) — DSTAT display parameter register
//   bits 3–0: Start row — which VRAM row appears at the top of the screen.
//             VRAM is treated as a circular buffer; rendering begins at
//             (start_row * 64) and wraps at 1024 bytes.
//   bits 7–4: Shadow depth — rows 0..(shadow-1) are blanked (filled with spaces).
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

/// DSTAT I/O port address (active on write only; reads return open-bus 0xFF).
const DSTAT_PORT: u8 = 0xFE;

pub struct VdmCard {
    name:      String,
    base_addr: u16,              // must be 1K-aligned (bits 9–0 == 0)
    pub vram:  [u8; VRAM_SIZE],  // screen buffer: vram[row*64 + col]
    /// Display parameter register — written via I/O port 0xFE.
    ///   bits 3-0 = start row (circular buffer offset)
    ///   bits 7-4 = shadow depth (blank top N rows)
    pub dstat: u8,
}

impl VdmCard {
    pub fn new(name: impl Into<String>, base_addr: u16) -> Self {
        let vram = [0x20u8; VRAM_SIZE];
        VdmCard { name: name.into(), base_addr: base_addr & 0xFC00, vram, dstat: 0 }
    }

    /// Return 1024 bytes in display order: VRAM starting from the DSTAT start
    /// row, wrapping around the circular buffer, with shadow rows blanked.
    pub fn display_frame(&self) -> [u8; VRAM_SIZE] {
        let start_row = (self.dstat & 0x0F) as usize;
        let shadow    = ((self.dstat & 0xF0) >> 4) as usize;

        let mut frame = [0u8; VRAM_SIZE];
        let mut src = start_row * COLS;

        for row in 0..ROWS {
            for col in 0..COLS {
                let byte = if row < shadow {
                    0x20 // blanked by shadow
                } else {
                    self.vram[src % VRAM_SIZE]
                };
                frame[row * COLS + col] = byte;
                src += 1;
            }
        }
        frame
    }
}

impl S100Card for VdmCard {
    fn as_any(&self)     -> &dyn Any     { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.vram = [0x20; VRAM_SIZE];
        self.dstat = 0;
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

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }

    fn io_write(&mut self, port: u8, data: u8) {
        if port == DSTAT_PORT {
            self.dstat = data;
        }
    }

    fn owns_mem(&self, addr: u16) -> bool {
        let offset = addr.wrapping_sub(self.base_addr) as usize;
        offset < VRAM_SIZE
    }

    fn owns_io(&self, port: u8) -> bool {
        port == DSTAT_PORT
    }
}
