// Cromemco Dazzler graphics card emulation
//
// Port protocol:
//   0x0E OUT = NX (Address/Enable) register
//                 bit7 = enable display
//                 bits6-0 = page (frame buffer starts at page × 512)
//   0x0F OUT = CC (Picture Format) register
//                 bit6 = hires (1 = X4 monochrome, 0 = normal multi-color)
//                 bit5 = 2K memory (1 = 2048 bytes, 0 = 512 bytes)
//                 bit4 = color (1 = color, 0 = grayscale)
//                 bits3-0 = foreground color for hires mode (IBGR)
//   0x0E IN  = status (bit7 = line parity, bit6 = frame sync)
//
// Display modes:
//   Normal + 512B:  32 × 32,  4 bpp IBGR, 2 pixels/byte (nibbles)
//   Normal + 2K:    64 × 64,  4 bpp IBGR, 2 pixels/byte (4 quadrants)
//   Hires  + 512B:  64 × 64,  1 bpp,      8 pixels/byte (4×2 blocks)
//   Hires  + 2K:   128 × 128, 1 bpp,      8 pixels/byte (4 quadrants)
//
// IBGR color nibble: bit3=Intensity, bit2=Blue, bit1=Green, bit0=Red
// Nibble order: low nibble = left pixel, high nibble = right pixel
// 2K modes: memory is divided into 4 × 512-byte quadrants
//   (TL → TR → BL → BR)
// Hires bit layout per byte (4×2 pixel block):
//   Row y:   bit0 bit1 bit4 bit5
//   Row y+1: bit2 bit3 bit6 bit7

use std::any::Any;
use crate::card::S100Card;

const PORT_NX: u8 = 0x0E; // address / enable register
const PORT_CC: u8 = 0x0F; // picture format register

pub struct DazzlerCard {
    name: String,
    pub nx: u8,         // bit7=enable, bits6-0=page
    pub cc: u8,         // bit6=hires, bit5=2K, bit4=color, bits3-0=fg color
    vsync_counter: u16, // free-running counter for vsync simulation
}

impl DazzlerCard {
    pub fn new(name: impl Into<String>) -> Self {
        DazzlerCard { name: name.into(), nx: 0, cc: 0, vsync_counter: 0 }
    }

    pub fn enabled(&self) -> bool { self.nx & 0x80 != 0 }
    pub fn frame_buffer_start(&self) -> u16 { ((self.nx & 0x7F) as u16) << 9 }
    pub fn hires_mode(&self) -> bool { self.cc & 0x40 != 0 }
    pub fn memory_2k(&self) -> bool { self.cc & 0x20 != 0 }
    pub fn color_mode(&self) -> bool { self.cc & 0x10 != 0 }
    pub fn fg_color(&self) -> u8 { self.cc & 0x0F }
    pub fn frame_buffer_size(&self) -> usize { if self.memory_2k() { 2048 } else { 512 } }

    pub fn display_dims(&self) -> (usize, usize) {
        match (self.hires_mode(), self.memory_2k()) {
            (false, false) => (32, 32),
            (false, true)  => (64, 64),
            (true,  false) => (64, 64),
            (true,  true)  => (128, 128),
        }
    }

    /// Render `buf` (frame buffer bytes) to a flat RGBA byte array.
    /// Returns None if the display is disabled.
    pub fn render_from_buf(&self, buf: &[u8]) -> Option<Vec<u8>> {
        if !self.enabled() { return None; }
        let (width, height) = self.display_dims();
        let mut rgba = vec![0u8; width * height * 4];

        if !self.hires_mode() {
            // Normal color mode: 4 bpp IBGR nibbles, 2 pixels per byte
            // Low nibble = left pixel, high nibble = right pixel
            if self.memory_2k() {
                // 2K mode: 4 quadrants of 512 bytes each
                // TL(0-511) TR(512-1023) BL(1024-1535) BR(1536-2047)
                let quadrants: [(usize, usize); 4] = [(0, 0), (32, 0), (0, 32), (32, 0 + 32)];
                for (qi, &(qx, qy)) in quadrants.iter().enumerate() {
                    let qbase = qi * 512;
                    for row in 0..32usize {
                        for col_pair in 0..16usize {
                            let byte_idx = qbase + row * 16 + col_pair;
                            if byte_idx >= buf.len() { break; }
                            let byte = buf[byte_idx];
                            let x = qx + col_pair * 2;
                            let y = qy + row;
                            // Low nibble = left pixel
                            set_pixel(&mut rgba, width, x, y, ibgr_to_rgba(byte & 0x0F, self.color_mode()));
                            // High nibble = right pixel
                            set_pixel(&mut rgba, width, x + 1, y, ibgr_to_rgba((byte >> 4) & 0x0F, self.color_mode()));
                        }
                    }
                }
            } else {
                // 512-byte mode: linear, 16 bytes per row, 32 rows
                for (i, &byte) in buf.iter().enumerate() {
                    let row = i / 16;
                    let col_pair = i % 16;
                    let x = col_pair * 2;
                    let y = row;
                    if y >= height { break; }
                    set_pixel(&mut rgba, width, x, y, ibgr_to_rgba(byte & 0x0F, self.color_mode()));
                    set_pixel(&mut rgba, width, x + 1, y, ibgr_to_rgba((byte >> 4) & 0x0F, self.color_mode()));
                }
            }
        } else {
            // Hires mode: 1 bpp, 8 pixels per byte in 4×2 blocks
            // Foreground color from D3-D0 of CC register
            let (fr, fg, fb) = ibgr_to_rgb(self.fg_color());
            if self.memory_2k() {
                // 2K mode: 4 quadrants of 512 bytes, each 64×64 pixels
                let half = width / 2;  // 64
                let quadrants: [(usize, usize); 4] = [(0, 0), (half, 0), (0, half), (half, half)];
                for (qi, &(qx, qy)) in quadrants.iter().enumerate() {
                    let qbase = qi * 512;
                    render_hires_quadrant(buf, qbase, qx, qy, half, &mut rgba, width, fr, fg, fb);
                }
            } else {
                // 512-byte mode: single quadrant covering full 64×64
                render_hires_quadrant(buf, 0, 0, 0, width, &mut rgba, width, fr, fg, fb);
            }
        }

        Some(rgba)
    }
}

/// Render a single hires quadrant (512 bytes → qsize×qsize pixels in 4×2 blocks)
fn render_hires_quadrant(
    buf: &[u8], qbase: usize, qx: usize, qy: usize, qsize: usize,
    rgba: &mut [u8], stride: usize, fr: u8, fg: u8, fb: u8,
) {
    let cols = qsize;
    let mut addr = qbase;
    let mut y = qy;
    while y < qy + qsize {
        let mut x = qx;
        while x < qx + cols {
            if addr >= buf.len() { return; }
            let byte = buf[addr];
            // 4×2 block: bit0→(x,y) bit1→(x+1,y) bit4→(x+2,y) bit5→(x+3,y)
            //            bit2→(x,y+1) bit3→(x+1,y+1) bit6→(x+2,y+1) bit7→(x+3,y+1)
            let bits: [(usize, usize, u8); 8] = [
                (x,   y,   byte & 0x01),
                (x+1, y,   byte & 0x02),
                (x+2, y,   byte & 0x10),
                (x+3, y,   byte & 0x20),
                (x,   y+1, byte & 0x04),
                (x+1, y+1, byte & 0x08),
                (x+2, y+1, byte & 0x40),
                (x+3, y+1, byte & 0x80),
            ];
            for &(px, py, bit) in &bits {
                if bit != 0 {
                    set_pixel(rgba, stride, px, py, [fr, fg, fb, 255]);
                }
                // else: pixel stays black (initialized to 0)
            }
            x += 4;
            addr += 1;
        }
        y += 2;
    }
}

fn set_pixel(rgba: &mut [u8], stride: usize, x: usize, y: usize, color: [u8; 4]) {
    let base = (y * stride + x) * 4;
    if base + 3 < rgba.len() {
        rgba[base]     = color[0];
        rgba[base + 1] = color[1];
        rgba[base + 2] = color[2];
        rgba[base + 3] = color[3];
    }
}

/// Convert IBGR nibble to RGB tuple.
/// Bit layout: bit3=Intensity, bit2=Blue, bit1=Green, bit0=Red
fn ibgr_to_rgb(nibble: u8) -> (u8, u8, u8) {
    let intensity = if nibble & 0x08 != 0 { 255u8 } else { 128u8 };
    let r = if nibble & 0x01 != 0 { intensity } else { 0 };
    let g = if nibble & 0x02 != 0 { intensity } else { 0 };
    let b = if nibble & 0x04 != 0 { intensity } else { 0 };
    (r, g, b)
}

/// Convert IBGR nibble to RGBA array, with optional grayscale mode.
fn ibgr_to_rgba(nibble: u8, color: bool) -> [u8; 4] {
    if color {
        let (r, g, b) = ibgr_to_rgb(nibble);
        [r, g, b, 255]
    } else {
        // Grayscale: 16 evenly-spaced levels
        let v = (nibble as u16 * 255 / 15) as u8;
        [v, v, v, 255]
    }
}

impl S100Card for DazzlerCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.nx = 0;
        self.cc = 0;
        self.vsync_counter = 0;
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        match port {
            PORT_NX => {
                // Status register (active-low accent of the real hardware):
                //   bit 7 = "unblank" (1 during active display, 0 during retrace)
                //   bit 6 = vertical sync (1 during retrace, 0 during active)
                // Many programs (including DZMBASIC) poll bit 6 for vsync.
                // Simulate ~60 Hz: at 2 MHz with ~10 cycles per poll iteration,
                // a period of 3200 reads ≈ one frame. Retrace ≈ last 8%.
                self.vsync_counter = self.vsync_counter.wrapping_add(1);
                let in_retrace = (self.vsync_counter % 3200) >= 2944;
                let status = if in_retrace { 0x40 } else { 0x80 };
                Some(status)
            }
            PORT_CC => {
                // Return current color/control register (readable on real hardware)
                Some(self.cc)
            }
            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            PORT_NX => self.nx = data,
            PORT_CC => self.cc = data,
            _ => {}
        }
    }

    fn owns_io(&self, port: u8) -> bool { port == PORT_NX || port == PORT_CC }
}
