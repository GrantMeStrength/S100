// Cromemco D+7A I/O board joystick emulation for Dazzler games
//
// The D+7A has 7 ADC channels and one 8-bit digital input port.
// For dual joysticks, the layout is:
//
//   Port 0x18: Digital input — 4 pushbuttons per joystick (active-LOW, pull-ups)
//              Bits 0-3 = Joystick 1 buttons (SW1-SW4), Bits 4-7 = Joystick 2 buttons
//              Idle = 0xFF (all HIGH due to pull-ups)
//   Port 0x19: ADC channel — Joystick 1 X-axis (center ≈ 0x00, range ±127)
//   Port 0x1A: ADC channel — Joystick 1 Y-axis (center ≈ 0x00, range ±127)
//   Port 0x1B: ADC channel — Joystick 2 X-axis (center ≈ 0x00, range ±127)
//   Port 0x1C: ADC channel — Joystick 2 Y-axis (center ≈ 0x00, range ±127)
//
// The analog axes are signed: 0x00 = center, 0x7F = +max, 0x80 = -max.
//
// UI-side convention for set_state/set_state2:
//   bit 0 = Up, bit 1 = Down, bit 2 = Left, bit 3 = Right
//   bit 4 = Button 1 (SW1), bit 5 = Button 2 (SW2), bit 6 = Button 4 (SW3/4)

use std::any::Any;
use crate::card::S100Card;

pub struct JoystickCard {
    name: String,
    base_port: u8,
    /// Joystick 1: UI bitmask (1=pressed).
    pressed1: u8,
    /// Joystick 2: UI bitmask (1=pressed).
    pressed2: u8,
}

impl JoystickCard {
    pub fn new(name: impl Into<String>, base_port: u8, _button_port: u8) -> Self {
        JoystickCard {
            name: name.into(),
            base_port,
            pressed1: 0,
            pressed2: 0,
        }
    }

    /// Update joystick 1 state from the UI layer.
    pub fn set_state(&mut self, value: u8) {
        self.pressed1 = value;
    }

    /// Update joystick 2 state from the UI layer.
    pub fn set_state2(&mut self, value: u8) {
        self.pressed2 = value;
    }

    /// Signed axis: 0x00 = center, full deflection values.
    /// Uses extreme values (0xFF / 0x01) to exceed any game deadzone thresholds.
    fn axis_signed(ui: u8, neg_bit: u8, pos_bit: u8) -> u8 {
        let neg = (ui >> neg_bit) & 1;
        let pos = (ui >> pos_bit) & 1;
        match (neg, pos) {
            (1, 0) => 0xFF_u8,  // max negative (255) — matches "unplugged" left direction
            (0, 1) => 0x01,     // max positive (1) — clearly in 1-127 range
            _ => 0x00,          // center
        }
    }

    /// Offset binary axis: 0x80 = center, 0xFF = max positive, 0x00 = max negative.
    fn axis_offset(ui: u8, neg_bit: u8, pos_bit: u8) -> u8 {
        let neg = (ui >> neg_bit) & 1;
        let pos = (ui >> pos_bit) & 1;
        match (neg, pos) {
            (1, 0) => 0x00_u8,
            (0, 1) => 0xFF,
            _ => 0x80,
        }
    }

    /// Convert UI button bits to active-LOW digital nibble (4 buttons).
    /// Returns 4-bit value where 1=idle, 0=pressed.
    fn buttons_nibble(ui: u8) -> u8 {
        let b1 = (ui >> 4) & 1;  // Button 1
        let b2 = (ui >> 5) & 1;  // Button 2
        let b4 = (ui >> 6) & 1;  // Button 4
        // Invert for active-LOW: pressed=0, idle=1
        let nibble = (!b1 & 1) | ((!b2 & 1) << 1) | ((!b4 & 1) << 2) | 0x08;
        nibble
    }
}

impl S100Card for JoystickCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.pressed1 = 0;
        self.pressed2 = 0;
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        if !self.owns_io(port) {
            return None;
        }
        let offset = port.wrapping_sub(self.base_port);
        match offset {
            // Digital buttons: JS1 in low nibble, JS2 in high nibble
            0 => {
                let lo = Self::buttons_nibble(self.pressed1);
                let hi = Self::buttons_nibble(self.pressed2) << 4;
                Some(lo | hi)
            }
            // JS1 X-axis (port 0x19): signed (center=0x00)
            1 => Some(Self::axis_signed(self.pressed1, 2, 3)),
            // JS1 Y-axis (port 0x1A): signed — up(bit0)=positive, down(bit1)=negative
            2 => Some(Self::axis_signed(self.pressed1, 1, 0)),
            // JS2 X-axis (port 0x1B)
            3 => Some(Self::axis_signed(self.pressed2, 2, 3)),
            // JS2 Y-axis (port 0x1C)
            4 => Some(Self::axis_signed(self.pressed2, 1, 0)),
            _ => Some(0x00),
        }
    }

    fn io_write(&mut self, port: u8, _data: u8) {
        // Accept and ignore writes to owned ports (D+7A initialization)
        let _ = port;
    }

    fn owns_io(&self, port: u8) -> bool {
        // D+7A ports: base .. base+4 (0x18-0x1C)
        port >= self.base_port && port <= self.base_port.saturating_add(4)
    }
}
