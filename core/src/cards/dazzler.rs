// Cromemco Dazzler graphics card emulation
//
// Port protocol:
//   0x0E OUT = NX (Address) register
//                 bit7 = enable display
//                 bits6-0 = page (frame buffer starts at page × 512)
//   0x0F OUT = CC (Color/Control) register
//                 bit5 = color (1 = IRGB color, 0 = B&W)
//                 bit4 = X4 (1 = high-res mode)
//   0x0E IN  = status (bit7 = vsync; always 0 here)
//
// Display modes:
//   Normal + color:  32 × 32,  4 bpp IRGB, 512 bytes (2 pixels/byte)
//   Normal + B&W:    64 × 64,  1 bpp,       512 bytes (8 pixels/byte)
//   X4    + color:   64 × 64,  4 bpp IRGB, 2048 bytes
//   X4    + B&W:    128 × 128, 1 bpp,      2048 bytes
//
// IRGB color nibble: bit3=intensity, bit2=R, bit1=G, bit0=B
// intensity=0 → half-bright, intensity=1 → full-bright

use std::any::Any;
use crate::card::S100Card;

const PORT_NX: u8 = 0x0E; // address / enable register
const PORT_CC: u8 = 0x0F; // color / control register

pub struct DazzlerCard {
    name: String,
    pub nx: u8, // bit7=enable, bits6-0=page
    pub cc: u8, // bit5=color, bit4=x4
}

impl DazzlerCard {
    pub fn new(name: impl Into<String>) -> Self {
        DazzlerCard { name: name.into(), nx: 0, cc: 0 }
    }

    pub fn enabled(&self) -> bool { self.nx & 0x80 != 0 }
    pub fn frame_buffer_start(&self) -> u16 { ((self.nx & 0x7F) as u16) << 9 }
    pub fn x4_mode(&self) -> bool { self.cc & 0x10 != 0 }
    pub fn color_mode(&self) -> bool { self.cc & 0x20 != 0 }
    pub fn frame_buffer_size(&self) -> usize { if self.x4_mode() { 2048 } else { 512 } }

    pub fn display_dims(&self) -> (usize, usize) {
        match (self.x4_mode(), self.color_mode()) {
            (false, true)  => (32, 32),
            (false, false) => (64, 64),
            (true,  true)  => (64, 64),
            (true,  false) => (128, 128),
        }
    }

    /// Render `buf` (frame buffer bytes) to a flat RGBA byte array.
    /// Returns None if the display is disabled.
    pub fn render_from_buf(&self, buf: &[u8]) -> Option<Vec<u8>> {
        if !self.enabled() { return None; }
        let (width, height) = self.display_dims();
        let mut rgba = vec![0u8; width * height * 4];

        if self.color_mode() {
            // 4 bpp IRGB: high nibble = left pixel, low nibble = right pixel
            for (i, &byte) in buf.iter().enumerate() {
                for (ni, nibble) in [(byte >> 4) & 0x0F, byte & 0x0F].iter().enumerate() {
                    let pi = i * 2 + ni;
                    if pi >= width * height { break; }
                    let (r, g, b) = irgb_to_rgb(*nibble);
                    let base = pi * 4;
                    rgba[base]     = r;
                    rgba[base + 1] = g;
                    rgba[base + 2] = b;
                    rgba[base + 3] = 255;
                }
            }
        } else {
            // 1 bpp B&W: MSB = leftmost pixel in each byte
            for (i, &byte) in buf.iter().enumerate() {
                for bit in 0..8usize {
                    let pi = i * 8 + bit;
                    if pi >= width * height { break; }
                    let v = if (byte >> (7 - bit)) & 1 != 0 { 0xFF } else { 0x00 };
                    let base = pi * 4;
                    rgba[base]     = v;
                    rgba[base + 1] = v;
                    rgba[base + 2] = v;
                    rgba[base + 3] = 255;
                }
            }
        }

        Some(rgba)
    }
}

fn irgb_to_rgb(nibble: u8) -> (u8, u8, u8) {
    let intensity = if nibble & 0x08 != 0 { 255u8 } else { 128u8 };
    let r = if nibble & 0x04 != 0 { intensity } else { 0 };
    let g = if nibble & 0x02 != 0 { intensity } else { 0 };
    let b = if nibble & 0x01 != 0 { intensity } else { 0 };
    (r, g, b)
}

impl S100Card for DazzlerCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.nx = 0;
        self.cc = 0;
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        if port == PORT_NX { Some(0) } else { None } // vsync always low
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
