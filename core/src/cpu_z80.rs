use serde::Serialize;

use crate::bus::BusInterface;

const FLAG_S: u8 = 0x80;
const FLAG_Z: u8 = 0x40;
const FLAG_5: u8 = 0x20;
const FLAG_H: u8 = 0x10;
const FLAG_3: u8 = 0x08;
const FLAG_PV: u8 = 0x04;
const FLAG_N: u8 = 0x02;
const FLAG_C: u8 = 0x01;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IndexReg {
    IX,
    IY,
}

#[derive(Debug, Clone, Serialize)]
pub struct CpuZ80 {
    pub a: u8,
    pub f: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
    pub a_: u8,
    pub f_: u8,
    pub b_: u8,
    pub c_: u8,
    pub d_: u8,
    pub e_: u8,
    pub h_: u8,
    pub l_: u8,
    pub ix: u16,
    pub iy: u16,
    pub i: u8,
    pub r: u8,
    pub sp: u16,
    pub pc: u16,
    pub halted: bool,
    pub iff1: bool,
    pub iff2: bool,
    pub interrupt_mode: u8,
    pub cycles: u64,
}

impl CpuZ80 {
    pub fn new() -> Self {
        Self {
            a: 0,
            f: FLAG_Z,
            b: 0,
            c: 0,
            d: 0,
            e: 0,
            h: 0,
            l: 0,
            a_: 0,
            f_: FLAG_Z,
            b_: 0,
            c_: 0,
            d_: 0,
            e_: 0,
            h_: 0,
            l_: 0,
            ix: 0,
            iy: 0,
            i: 0,
            r: 0,
            sp: 0xFFFF,
            pc: 0,
            halted: false,
            iff1: false,
            iff2: false,
            interrupt_mode: 0,
            cycles: 0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    fn parity(value: u8) -> bool {
        value.count_ones() % 2 == 0
    }

    fn add_signed(base: u16, disp: i8) -> u16 {
        if disp >= 0 {
            base.wrapping_add(disp as u16)
        } else {
            base.wrapping_sub((-disp) as u16)
        }
    }

    fn inc_refresh(&mut self) {
        let next = (self.r & 0x7F).wrapping_add(1) & 0x7F;
        self.r = (self.r & 0x80) | next;
    }

    fn fetch_opcode<B: BusInterface>(&mut self, bus: &mut B) -> u8 {
        self.inc_refresh();
        let byte = bus.mem_read(self.pc);
        self.pc = self.pc.wrapping_add(1);
        byte
    }

    fn fetch_byte<B: BusInterface>(&mut self, bus: &mut B) -> u8 {
        let byte = bus.mem_read(self.pc);
        self.pc = self.pc.wrapping_add(1);
        byte
    }

    fn fetch_word<B: BusInterface>(&mut self, bus: &mut B) -> u16 {
        let lo = self.fetch_byte(bus) as u16;
        let hi = self.fetch_byte(bus) as u16;
        (hi << 8) | lo
    }

    fn push<B: BusInterface>(&mut self, value: u16, bus: &mut B) {
        self.sp = self.sp.wrapping_sub(1);
        bus.mem_write(self.sp, (value >> 8) as u8);
        self.sp = self.sp.wrapping_sub(1);
        bus.mem_write(self.sp, value as u8);
    }

    fn pop<B: BusInterface>(&mut self, bus: &mut B) -> u16 {
        let lo = bus.mem_read(self.sp) as u16;
        self.sp = self.sp.wrapping_add(1);
        let hi = bus.mem_read(self.sp) as u16;
        self.sp = self.sp.wrapping_add(1);
        (hi << 8) | lo
    }

    fn bc(&self) -> u16 {
        ((self.b as u16) << 8) | self.c as u16
    }

    fn de(&self) -> u16 {
        ((self.d as u16) << 8) | self.e as u16
    }

    fn hl(&self) -> u16 {
        ((self.h as u16) << 8) | self.l as u16
    }

    fn set_bc(&mut self, value: u16) {
        self.b = (value >> 8) as u8;
        self.c = value as u8;
    }

    fn set_de(&mut self, value: u16) {
        self.d = (value >> 8) as u8;
        self.e = value as u8;
    }

    fn set_hl(&mut self, value: u16) {
        self.h = (value >> 8) as u8;
        self.l = value as u8;
    }

    fn get_index(&self, index: IndexReg) -> u16 {
        match index {
            IndexReg::IX => self.ix,
            IndexReg::IY => self.iy,
        }
    }

    fn set_index(&mut self, index: IndexReg, value: u16) {
        match index {
            IndexReg::IX => self.ix = value,
            IndexReg::IY => self.iy = value,
        }
    }

    fn get_rp(&self, rp: u8, index: Option<IndexReg>) -> u16 {
        match rp & 0x03 {
            0 => self.bc(),
            1 => self.de(),
            2 => index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl()),
            3 => self.sp,
            _ => unreachable!(),
        }
    }

    fn set_rp(&mut self, rp: u8, value: u16, index: Option<IndexReg>) {
        match rp & 0x03 {
            0 => self.set_bc(value),
            1 => self.set_de(value),
            2 => {
                if let Some(index) = index {
                    self.set_index(index, value);
                } else {
                    self.set_hl(value);
                }
            }
            3 => self.sp = value,
            _ => unreachable!(),
        }
    }

    fn get_rp2(&self, rp: u8, index: Option<IndexReg>) -> u16 {
        match rp & 0x03 {
            0 => self.bc(),
            1 => self.de(),
            2 => index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl()),
            3 => ((self.a as u16) << 8) | self.f as u16,
            _ => unreachable!(),
        }
    }

    fn set_rp2(&mut self, rp: u8, value: u16, index: Option<IndexReg>) {
        match rp & 0x03 {
            0 => self.set_bc(value),
            1 => self.set_de(value),
            2 => {
                if let Some(index) = index {
                    self.set_index(index, value);
                } else {
                    self.set_hl(value);
                }
            }
            3 => {
                self.a = (value >> 8) as u8;
                self.f = value as u8;
            }
            _ => unreachable!(),
        }
    }

    fn read_r8<B: BusInterface>(&mut self, reg: u8, index: Option<IndexReg>, addr: Option<u16>, bus: &mut B) -> u8 {
        match reg & 0x07 {
            0 => self.b,
            1 => self.c,
            2 => self.d,
            3 => self.e,
            4 => {
                if let Some(index) = index {
                    (self.get_index(index) >> 8) as u8
                } else {
                    self.h
                }
            }
            5 => {
                if let Some(index) = index {
                    self.get_index(index) as u8
                } else {
                    self.l
                }
            }
            6 => bus.mem_read(addr.unwrap_or_else(|| index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl()))),
            7 => self.a,
            _ => unreachable!(),
        }
    }

    fn write_r8<B: BusInterface>(&mut self, reg: u8, value: u8, index: Option<IndexReg>, addr: Option<u16>, bus: &mut B) {
        match reg & 0x07 {
            0 => self.b = value,
            1 => self.c = value,
            2 => self.d = value,
            3 => self.e = value,
            4 => {
                if let Some(index) = index {
                    let low = self.get_index(index) & 0x00FF;
                    self.set_index(index, ((value as u16) << 8) | low);
                } else {
                    self.h = value;
                }
            }
            5 => {
                if let Some(index) = index {
                    let high = self.get_index(index) & 0xFF00;
                    self.set_index(index, high | value as u16);
                } else {
                    self.l = value;
                }
            }
            6 => bus.mem_write(addr.unwrap_or_else(|| index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl())), value),
            7 => self.a = value,
            _ => unreachable!(),
        }
    }

    fn cond(&self, cond: u8) -> bool {
        match cond & 0x07 {
            0 => self.f & FLAG_Z == 0,
            1 => self.f & FLAG_Z != 0,
            2 => self.f & FLAG_C == 0,
            3 => self.f & FLAG_C != 0,
            4 => self.f & FLAG_PV == 0,
            5 => self.f & FLAG_PV != 0,
            6 => self.f & FLAG_S == 0,
            7 => self.f & FLAG_S != 0,
            _ => unreachable!(),
        }
    }

    fn add_a(&mut self, value: u8, with_carry: bool) {
        let carry = if with_carry && self.f & FLAG_C != 0 { 1 } else { 0 };
        let a = self.a;
        let result16 = a as u16 + value as u16 + carry as u16;
        let result = result16 as u8;
        let mut f = result & (FLAG_S | FLAG_5 | FLAG_3);
        if result == 0 {
            f |= FLAG_Z;
        }
        if ((a & 0x0F) + (value & 0x0F) + carry) > 0x0F {
            f |= FLAG_H;
        }
        if (!(a ^ value) & (a ^ result) & 0x80) != 0 {
            f |= FLAG_PV;
        }
        if result16 > 0xFF {
            f |= FLAG_C;
        }
        self.a = result;
        self.f = f;
    }

    fn sub_a(&mut self, value: u8, with_borrow: bool) {
        let carry = if with_borrow && self.f & FLAG_C != 0 { 1 } else { 0 };
        let a = self.a;
        let result = a.wrapping_sub(value).wrapping_sub(carry);
        let mut f = FLAG_N | (result & (FLAG_S | FLAG_5 | FLAG_3));
        if result == 0 {
            f |= FLAG_Z;
        }
        if (a & 0x0F) < ((value & 0x0F) + carry) {
            f |= FLAG_H;
        }
        if ((a ^ value) & (a ^ result) & 0x80) != 0 {
            f |= FLAG_PV;
        }
        if (a as u16) < (value as u16 + carry as u16) {
            f |= FLAG_C;
        }
        self.a = result;
        self.f = f;
    }

    fn cp_a(&mut self, value: u8) {
        let a = self.a;
        let result = a.wrapping_sub(value);
        let mut f = FLAG_N | (value & (FLAG_5 | FLAG_3));
        if result & 0x80 != 0 {
            f |= FLAG_S;
        }
        if result == 0 {
            f |= FLAG_Z;
        }
        if (a & 0x0F) < (value & 0x0F) {
            f |= FLAG_H;
        }
        if ((a ^ value) & (a ^ result) & 0x80) != 0 {
            f |= FLAG_PV;
        }
        if a < value {
            f |= FLAG_C;
        }
        self.f = f;
    }

    fn and_a(&mut self, value: u8) {
        self.a &= value;
        let mut f = self.a & (FLAG_S | FLAG_5 | FLAG_3);
        if self.a == 0 {
            f |= FLAG_Z;
        }
        f |= FLAG_H;
        if Self::parity(self.a) {
            f |= FLAG_PV;
        }
        self.f = f;
    }

    fn xor_a(&mut self, value: u8) {
        self.a ^= value;
        let mut f = self.a & (FLAG_S | FLAG_5 | FLAG_3);
        if self.a == 0 {
            f |= FLAG_Z;
        }
        if Self::parity(self.a) {
            f |= FLAG_PV;
        }
        self.f = f;
    }

    fn or_a(&mut self, value: u8) {
        self.a |= value;
        let mut f = self.a & (FLAG_S | FLAG_5 | FLAG_3);
        if self.a == 0 {
            f |= FLAG_Z;
        }
        if Self::parity(self.a) {
            f |= FLAG_PV;
        }
        self.f = f;
    }

    fn alu(&mut self, op: u8, value: u8) {
        match op & 0x07 {
            0 => self.add_a(value, false),
            1 => self.add_a(value, true),
            2 => self.sub_a(value, false),
            3 => self.sub_a(value, true),
            4 => self.and_a(value),
            5 => self.xor_a(value),
            6 => self.or_a(value),
            7 => self.cp_a(value),
            _ => unreachable!(),
        }
    }

    fn inc8(&mut self, value: u8) -> u8 {
        let result = value.wrapping_add(1);
        let carry = self.f & FLAG_C;
        let mut f = carry | (result & (FLAG_S | FLAG_5 | FLAG_3));
        if result == 0 {
            f |= FLAG_Z;
        }
        if value & 0x0F == 0x0F {
            f |= FLAG_H;
        }
        if value == 0x7F {
            f |= FLAG_PV;
        }
        self.f = f;
        result
    }

    fn dec8(&mut self, value: u8) -> u8 {
        let result = value.wrapping_sub(1);
        let carry = self.f & FLAG_C;
        let mut f = carry | FLAG_N | (result & (FLAG_S | FLAG_5 | FLAG_3));
        if result == 0 {
            f |= FLAG_Z;
        }
        if value & 0x0F == 0x00 {
            f |= FLAG_H;
        }
        if value == 0x80 {
            f |= FLAG_PV;
        }
        self.f = f;
        result
    }

    fn add_hl(&mut self, value: u16, index: Option<IndexReg>) {
        let lhs = index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl());
        let result32 = lhs as u32 + value as u32;
        let result = result32 as u16;
        let keep = self.f & (FLAG_S | FLAG_Z | FLAG_PV);
        let mut f = keep | (((result >> 8) as u8) & (FLAG_5 | FLAG_3));
        if ((lhs & 0x0FFF) + (value & 0x0FFF)) > 0x0FFF {
            f |= FLAG_H;
        }
        if result32 > 0xFFFF {
            f |= FLAG_C;
        }
        self.f = f;
        if let Some(index) = index {
            self.set_index(index, result);
        } else {
            self.set_hl(result);
        }
    }

    fn adc_hl(&mut self, value: u16) {
        let carry = if self.f & FLAG_C != 0 { 1u32 } else { 0 };
        let lhs = self.hl();
        let result32 = lhs as u32 + value as u32 + carry;
        let result = result32 as u16;
        let mut f = ((result >> 8) as u8) & (FLAG_5 | FLAG_3);
        if result & 0x8000 != 0 {
            f |= FLAG_S;
        }
        if result == 0 {
            f |= FLAG_Z;
        }
        if ((lhs & 0x0FFF) as u32 + (value & 0x0FFF) as u32 + carry) > 0x0FFF {
            f |= FLAG_H;
        }
        if (!(lhs ^ value) & (lhs ^ result) & 0x8000) != 0 {
            f |= FLAG_PV;
        }
        if result32 > 0xFFFF {
            f |= FLAG_C;
        }
        self.set_hl(result);
        self.f = f;
    }

    fn sbc_hl(&mut self, value: u16) {
        let carry = if self.f & FLAG_C != 0 { 1u16 } else { 0 };
        let lhs = self.hl();
        let result = lhs.wrapping_sub(value).wrapping_sub(carry);
        let mut f = FLAG_N | (((result >> 8) as u8) & (FLAG_5 | FLAG_3));
        if result & 0x8000 != 0 {
            f |= FLAG_S;
        }
        if result == 0 {
            f |= FLAG_Z;
        }
        if (lhs & 0x0FFF) < ((value & 0x0FFF) + carry) {
            f |= FLAG_H;
        }
        if ((lhs ^ value) & (lhs ^ result) & 0x8000) != 0 {
            f |= FLAG_PV;
        }
        if (lhs as u32) < (value as u32 + carry as u32) {
            f |= FLAG_C;
        }
        self.set_hl(result);
        self.f = f;
    }

    fn daa(&mut self) {
        let old_a = self.a;
        let mut correction = 0;
        let mut carry = self.f & FLAG_C != 0;
        let subtract = self.f & FLAG_N != 0;
        if self.f & FLAG_H != 0 || (!subtract && (self.a & 0x0F) > 9) {
            correction |= 0x06;
        }
        if carry || (!subtract && self.a > 0x99) {
            correction |= 0x60;
            carry = true;
        }
        self.a = if subtract {
            self.a.wrapping_sub(correction)
        } else {
            self.a.wrapping_add(correction)
        };
        let mut f = self.a & (FLAG_S | FLAG_5 | FLAG_3);
        if self.a == 0 {
            f |= FLAG_Z;
        }
        if ((old_a ^ self.a) & 0x10) != 0 {
            f |= FLAG_H;
        }
        if Self::parity(self.a) {
            f |= FLAG_PV;
        }
        if subtract {
            f |= FLAG_N;
        }
        if carry {
            f |= FLAG_C;
        }
        self.f = f;
    }

    fn rlca(&mut self) {
        let carry = self.a >> 7;
        self.a = (self.a << 1) | carry;
        self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (self.a & (FLAG_5 | FLAG_3)) | if carry != 0 { FLAG_C } else { 0 };
    }

    fn rrca(&mut self) {
        let carry = self.a & 1;
        self.a = (self.a >> 1) | (carry << 7);
        self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (self.a & (FLAG_5 | FLAG_3)) | if carry != 0 { FLAG_C } else { 0 };
    }

    fn rla(&mut self) {
        let old_c = if self.f & FLAG_C != 0 { 1 } else { 0 };
        let carry = self.a >> 7;
        self.a = (self.a << 1) | old_c;
        self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (self.a & (FLAG_5 | FLAG_3)) | if carry != 0 { FLAG_C } else { 0 };
    }

    fn rra(&mut self) {
        let old_c = if self.f & FLAG_C != 0 { 1 } else { 0 };
        let carry = self.a & 1;
        self.a = (self.a >> 1) | (old_c << 7);
        self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (self.a & (FLAG_5 | FLAG_3)) | if carry != 0 { FLAG_C } else { 0 };
    }

    fn cb_rot(&mut self, op: u8, value: u8) -> u8 {
        let carry_in = if self.f & FLAG_C != 0 { 1 } else { 0 };
        let (result, carry) = match op & 0x07 {
            0 => {
                let c = value >> 7;
                ((value << 1) | c, c)
            }
            1 => {
                let c = value & 1;
                ((value >> 1) | (c << 7), c)
            }
            2 => {
                let c = value >> 7;
                ((value << 1) | carry_in, c)
            }
            3 => {
                let c = value & 1;
                ((value >> 1) | (carry_in << 7), c)
            }
            4 => {
                let c = value >> 7;
                (value << 1, c)
            }
            5 => {
                let c = value & 1;
                ((value >> 1) | (value & 0x80), c)
            }
            6 => {
                let c = value >> 7;
                ((value << 1) | 1, c)
            }
            7 => {
                let c = value & 1;
                (value >> 1, c)
            }
            _ => unreachable!(),
        };
        let mut f = result & (FLAG_S | FLAG_5 | FLAG_3);
        if result == 0 {
            f |= FLAG_Z;
        }
        if Self::parity(result) {
            f |= FLAG_PV;
        }
        if carry != 0 {
            f |= FLAG_C;
        }
        self.f = f;
        result
    }

    fn bit_flags(&mut self, bit: u8, value: u8) {
        let mask = 1u8 << (bit & 7);
        let carry = self.f & FLAG_C;
        let mut f = carry | FLAG_H;
        if value & mask == 0 {
            f |= FLAG_Z | FLAG_PV;
        }
        if bit == 7 && value & 0x80 != 0 {
            f |= FLAG_S;
        }
        f |= value & (FLAG_5 | FLAG_3);
        self.f = f;
    }

    fn block_move<B: BusInterface>(&mut self, bus: &mut B, delta: i8, repeat: bool) -> u32 {
        let value = bus.mem_read(self.hl());
        bus.mem_write(self.de(), value);
        self.set_hl(Self::add_signed(self.hl(), delta));
        self.set_de(Self::add_signed(self.de(), delta));
        let bc = self.bc().wrapping_sub(1);
        self.set_bc(bc);
        let sum = self.a.wrapping_add(value);
        self.f = (self.f & FLAG_C) | (sum & (FLAG_5 | FLAG_3)) | if bc != 0 { FLAG_PV } else { 0 };
        if repeat && bc != 0 {
            self.pc = self.pc.wrapping_sub(2);
            21
        } else {
            16
        }
    }

    fn block_compare<B: BusInterface>(&mut self, bus: &mut B, delta: i8, repeat: bool) -> u32 {
        let value = bus.mem_read(self.hl());
        let result = self.a.wrapping_sub(value);
        self.set_hl(Self::add_signed(self.hl(), delta));
        let bc = self.bc().wrapping_sub(1);
        self.set_bc(bc);
        let mut f = (self.f & FLAG_C) | FLAG_N | (result & (FLAG_S | FLAG_5 | FLAG_3));
        if result == 0 {
            f |= FLAG_Z;
        }
        if (self.a & 0x0F) < (value & 0x0F) {
            f |= FLAG_H;
        }
        if bc != 0 {
            f |= FLAG_PV;
        }
        self.f = f;
        if repeat && bc != 0 && result != 0 {
            self.pc = self.pc.wrapping_sub(2);
            21
        } else {
            16
        }
    }

    fn block_in<B: BusInterface>(&mut self, bus: &mut B, delta: i8, repeat: bool) -> u32 {
        let value = bus.io_read(self.c);
        bus.mem_write(self.hl(), value);
        self.set_hl(Self::add_signed(self.hl(), delta));
        self.b = self.b.wrapping_sub(1);
        self.f = FLAG_N | (self.b & (FLAG_S | FLAG_5 | FLAG_3)) | if self.b == 0 { FLAG_Z } else { 0 } | if Self::parity(self.b) { FLAG_PV } else { 0 };
        if repeat && self.b != 0 {
            self.pc = self.pc.wrapping_sub(2);
            21
        } else {
            16
        }
    }

    fn block_out<B: BusInterface>(&mut self, bus: &mut B, delta: i8, repeat: bool) -> u32 {
        let value = bus.mem_read(self.hl());
        bus.io_write(self.c, value);
        self.set_hl(Self::add_signed(self.hl(), delta));
        self.b = self.b.wrapping_sub(1);
        self.f = FLAG_N | (self.b & (FLAG_S | FLAG_5 | FLAG_3)) | if self.b == 0 { FLAG_Z } else { 0 } | if Self::parity(self.b) { FLAG_PV } else { 0 };
        if repeat && self.b != 0 {
            self.pc = self.pc.wrapping_sub(2);
            21
        } else {
            16
        }
    }

    fn execute_cb<B: BusInterface>(&mut self, bus: &mut B, opcode: u8, index: Option<IndexReg>, addr: Option<u16>) -> u32 {
        let group = opcode >> 6;
        let y = (opcode >> 3) & 0x07;
        let z = opcode & 0x07;
        let value = self.read_r8(z, index, addr, bus);
        match group {
            0 => {
                let result = self.cb_rot(y, value);
                self.write_r8(z, result, index, addr, bus);
                if addr.is_some() || z == 6 { 15 } else { 8 }
            }
            1 => {
                self.bit_flags(y, value);
                if addr.is_some() || z == 6 { 12 } else { 8 }
            }
            2 => {
                let result = value & !(1u8 << y);
                self.write_r8(z, result, index, addr, bus);
                if addr.is_some() || z == 6 { 15 } else { 8 }
            }
            3 => {
                let result = value | (1u8 << y);
                self.write_r8(z, result, index, addr, bus);
                if addr.is_some() || z == 6 { 15 } else { 8 }
            }
            _ => unreachable!(),
        }
    }

    fn execute_cb_indexed<B: BusInterface>(&mut self, bus: &mut B, index: IndexReg) -> u32 {
        let disp = self.fetch_byte(bus) as i8;
        let opcode = self.fetch_opcode(bus);
        let addr = Self::add_signed(self.get_index(index), disp);
        let group = opcode >> 6;
        let y = (opcode >> 3) & 0x07;
        let z = opcode & 0x07;
        let value = bus.mem_read(addr);
        match group {
            0 => {
                let result = self.cb_rot(y, value);
                bus.mem_write(addr, result);
                if z != 6 {
                    self.write_r8(z, result, Some(index), None, bus);
                }
            }
            1 => self.bit_flags(y, value),
            2 => {
                let result = value & !(1u8 << y);
                bus.mem_write(addr, result);
                if z != 6 {
                    self.write_r8(z, result, Some(index), None, bus);
                }
            }
            3 => {
                let result = value | (1u8 << y);
                bus.mem_write(addr, result);
                if z != 6 {
                    self.write_r8(z, result, Some(index), None, bus);
                }
            }
            _ => unreachable!(),
        }
        23
    }

    fn execute_ed<B: BusInterface>(&mut self, bus: &mut B) -> u32 {
        let opcode = self.fetch_opcode(bus);
        match opcode {
            0x40 | 0x48 | 0x50 | 0x58 | 0x60 | 0x68 | 0x70 | 0x78 => {
                let reg = (opcode >> 3) & 0x07;
                let value = bus.io_read(self.c);
                if reg != 6 {
                    self.write_r8(reg, value, None, None, bus);
                }
                let carry = self.f & FLAG_C;
                let mut f = carry | (value & (FLAG_S | FLAG_5 | FLAG_3));
                if value == 0 {
                    f |= FLAG_Z;
                }
                if Self::parity(value) {
                    f |= FLAG_PV;
                }
                self.f = f;
                12
            }
            0x41 | 0x49 | 0x51 | 0x59 | 0x61 | 0x69 | 0x71 | 0x79 => {
                let reg = (opcode >> 3) & 0x07;
                let value = if reg == 6 {
                    0
                } else {
                    self.read_r8(reg, None, None, bus)
                };
                bus.io_write(self.c, value);
                12
            }
            0x42 | 0x52 | 0x62 | 0x72 => {
                let rp = (opcode >> 4) & 0x03;
                let value = self.get_rp(rp, None);
                self.sbc_hl(value);
                15
            }
            0x4A | 0x5A | 0x6A | 0x7A => {
                let rp = (opcode >> 4) & 0x03;
                let value = self.get_rp(rp, None);
                self.adc_hl(value);
                15
            }
            0x43 | 0x53 | 0x63 | 0x73 => {
                let addr = self.fetch_word(bus);
                let value = self.get_rp((opcode >> 4) & 0x03, None);
                bus.mem_write(addr, value as u8);
                bus.mem_write(addr.wrapping_add(1), (value >> 8) as u8);
                20
            }
            0x4B | 0x5B | 0x6B | 0x7B => {
                let addr = self.fetch_word(bus);
                let lo = bus.mem_read(addr) as u16;
                let hi = bus.mem_read(addr.wrapping_add(1)) as u16;
                self.set_rp((opcode >> 4) & 0x03, (hi << 8) | lo, None);
                20
            }
            0x44 | 0x4C | 0x54 | 0x5C | 0x64 | 0x6C | 0x74 | 0x7C => {
                let value = self.a;
                self.a = 0;
                self.sub_a(value, false);
                8
            }
            0x45 | 0x55 | 0x65 | 0x75 => {
                self.iff1 = self.iff2;
                self.pc = self.pop(bus);
                14
            }
            0x4D | 0x5D | 0x6D | 0x7D => {
                self.iff1 = self.iff2;
                self.pc = self.pop(bus);
                14
            }
            0x46 | 0x4E | 0x66 | 0x6E => {
                self.interrupt_mode = 0;
                8
            }
            0x56 | 0x76 => {
                self.interrupt_mode = 1;
                8
            }
            0x5E | 0x7E => {
                self.interrupt_mode = 2;
                8
            }
            0x47 => {
                self.i = self.a;
                9
            }
            0x4F => {
                self.r = self.a;
                9
            }
            0x57 => {
                self.a = self.i;
                let carry = self.f & FLAG_C;
                let mut f = carry | (self.a & (FLAG_S | FLAG_5 | FLAG_3));
                if self.a == 0 {
                    f |= FLAG_Z;
                }
                if self.iff2 {
                    f |= FLAG_PV;
                }
                self.f = f;
                9
            }
            0x5F => {
                self.a = self.r;
                let carry = self.f & FLAG_C;
                let mut f = carry | (self.a & (FLAG_S | FLAG_5 | FLAG_3));
                if self.a == 0 {
                    f |= FLAG_Z;
                }
                if self.iff2 {
                    f |= FLAG_PV;
                }
                self.f = f;
                9
            }
            0x67 => {
                let value = bus.mem_read(self.hl());
                bus.mem_write(self.hl(), (value << 4) | (self.a & 0x0F));
                self.a = (self.a & 0xF0) | (value >> 4);
                let carry = self.f & FLAG_C;
                let mut f = carry | (self.a & (FLAG_S | FLAG_5 | FLAG_3));
                if self.a == 0 {
                    f |= FLAG_Z;
                }
                if Self::parity(self.a) {
                    f |= FLAG_PV;
                }
                self.f = f;
                18
            }
            0x6F => {
                let value = bus.mem_read(self.hl());
                bus.mem_write(self.hl(), (value >> 4) | (self.a << 4));
                self.a = (self.a & 0xF0) | (value & 0x0F);
                let carry = self.f & FLAG_C;
                let mut f = carry | (self.a & (FLAG_S | FLAG_5 | FLAG_3));
                if self.a == 0 {
                    f |= FLAG_Z;
                }
                if Self::parity(self.a) {
                    f |= FLAG_PV;
                }
                self.f = f;
                18
            }
            0xA0 => self.block_move(bus, 1, false),
            0xA1 => self.block_compare(bus, 1, false),
            0xA2 => self.block_in(bus, 1, false),
            0xA3 => self.block_out(bus, 1, false),
            0xA8 => self.block_move(bus, -1, false),
            0xA9 => self.block_compare(bus, -1, false),
            0xAA => self.block_in(bus, -1, false),
            0xAB => self.block_out(bus, -1, false),
            0xB0 => self.block_move(bus, 1, true),
            0xB1 => self.block_compare(bus, 1, true),
            0xB2 => self.block_in(bus, 1, true),
            0xB3 => self.block_out(bus, 1, true),
            0xB8 => self.block_move(bus, -1, true),
            0xB9 => self.block_compare(bus, -1, true),
            0xBA => self.block_in(bus, -1, true),
            0xBB => self.block_out(bus, -1, true),
            _ => 8,
        }
    }

    fn execute_indexed<B: BusInterface>(&mut self, bus: &mut B, index: IndexReg) -> u32 {
        let opcode = self.fetch_opcode(bus);
        match opcode {
            0xDD => self.execute_indexed(bus, IndexReg::IX),
            0xFD => self.execute_indexed(bus, IndexReg::IY),
            0xCB => self.execute_cb_indexed(bus, index),
            0xED => self.execute_ed(bus),
            _ => self.execute_base(bus, opcode, Some(index)),
        }
    }

    fn execute_base<B: BusInterface>(&mut self, bus: &mut B, opcode: u8, index: Option<IndexReg>) -> u32 {
        if (0x40..=0x7F).contains(&opcode) {
            if opcode == 0x76 {
                self.halted = true;
                self.pc = self.pc.wrapping_sub(1);
                return 4;
            }
            let dst = (opcode >> 3) & 0x07;
            let src = opcode & 0x07;
            let addr = if index.is_some() && (dst == 6 || src == 6) {
                Some(Self::add_signed(self.get_index(index.unwrap()), self.fetch_byte(bus) as i8))
            } else {
                None
            };
            let value = self.read_r8(src, index, addr, bus);
            self.write_r8(dst, value, index, addr, bus);
            return if addr.is_some() { 19 } else if index.is_some() && (matches!(dst, 4 | 5) || matches!(src, 4 | 5)) { 8 } else { 5 };
        }

        if (0x80..=0xBF).contains(&opcode) {
            let op = (opcode >> 3) & 0x07;
            let src = opcode & 0x07;
            let addr = if index.is_some() && src == 6 {
                Some(Self::add_signed(self.get_index(index.unwrap()), self.fetch_byte(bus) as i8))
            } else {
                None
            };
            let value = self.read_r8(src, index, addr, bus);
            self.alu(op, value);
            return if addr.is_some() { 19 } else if index.is_some() && matches!(src, 4 | 5) { 8 } else if src == 6 { 7 } else { 4 };
        }

        match opcode {
            0x00 => 4,
            0x08 => {
                std::mem::swap(&mut self.a, &mut self.a_);
                std::mem::swap(&mut self.f, &mut self.f_);
                4
            }
            0x01 | 0x11 | 0x21 | 0x31 => {
                let rp = (opcode >> 4) & 0x03;
                let value = self.fetch_word(bus);
                self.set_rp(rp, value, if opcode == 0x21 { index } else { None });
                if opcode == 0x21 && index.is_some() { 14 } else { 10 }
            }
            0x02 => {
                bus.mem_write(self.bc(), self.a);
                7
            }
            0x03 | 0x13 | 0x23 | 0x33 => {
                let rp = (opcode >> 4) & 0x03;
                let indexed = if opcode == 0x23 { index } else { None };
                let value = self.get_rp(rp, indexed).wrapping_add(1);
                self.set_rp(rp, value, indexed);
                if opcode == 0x23 && index.is_some() { 10 } else { 6 }
            }
            0x04 | 0x0C | 0x14 | 0x1C | 0x24 | 0x2C | 0x3C => {
                let reg = (opcode >> 3) & 0x07;
                let value = self.read_r8(reg, index.filter(|_| matches!(reg, 4 | 5)), None, bus);
                let result = self.inc8(value);
                self.write_r8(reg, result, index.filter(|_| matches!(reg, 4 | 5)), None, bus);
                if index.is_some() && matches!(reg, 4 | 5) { 8 } else { 4 }
            }
            0x05 | 0x0D | 0x15 | 0x1D | 0x25 | 0x2D | 0x3D => {
                let reg = (opcode >> 3) & 0x07;
                let value = self.read_r8(reg, index.filter(|_| matches!(reg, 4 | 5)), None, bus);
                let result = self.dec8(value);
                self.write_r8(reg, result, index.filter(|_| matches!(reg, 4 | 5)), None, bus);
                if index.is_some() && matches!(reg, 4 | 5) { 8 } else { 4 }
            }
            0x06 | 0x0E | 0x16 | 0x1E | 0x26 | 0x2E | 0x3E => {
                let reg = (opcode >> 3) & 0x07;
                let immediate = self.fetch_byte(bus);
                self.write_r8(reg, immediate, index.filter(|_| matches!(reg, 4 | 5)), None, bus);
                if index.is_some() && matches!(reg, 4 | 5) { 11 } else { 7 }
            }
            0x07 => {
                self.rlca();
                4
            }
            0x09 | 0x19 | 0x29 | 0x39 => {
                let rp = (opcode >> 4) & 0x03;
                let lhs_indexed = if index.is_some() { index } else { None };
                let rhs = self.get_rp(rp, if opcode == 0x29 { index } else { None });
                self.add_hl(rhs, lhs_indexed);
                if index.is_some() { 15 } else { 11 }
            }
            0x0A => {
                self.a = bus.mem_read(self.bc());
                7
            }
            0x0B | 0x1B | 0x2B | 0x3B => {
                let rp = (opcode >> 4) & 0x03;
                let indexed = if opcode == 0x2B { index } else { None };
                let value = self.get_rp(rp, indexed).wrapping_sub(1);
                self.set_rp(rp, value, indexed);
                if opcode == 0x2B && index.is_some() { 10 } else { 6 }
            }
            0x0F => {
                self.rrca();
                4
            }
            0x10 => {
                let disp = self.fetch_byte(bus) as i8;
                self.b = self.b.wrapping_sub(1);
                if self.b != 0 {
                    self.pc = Self::add_signed(self.pc, disp);
                    13
                } else {
                    8
                }
            }
            0x12 => {
                bus.mem_write(self.de(), self.a);
                7
            }
            0x17 => {
                self.rla();
                4
            }
            0x18 => {
                let disp = self.fetch_byte(bus) as i8;
                self.pc = Self::add_signed(self.pc, disp);
                12
            }
            0x1A => {
                self.a = bus.mem_read(self.de());
                7
            }
            0x1F => {
                self.rra();
                4
            }
            0x20 | 0x28 | 0x30 | 0x38 => {
                let disp = self.fetch_byte(bus) as i8;
                let take = match opcode {
                    0x20 => self.f & FLAG_Z == 0,
                    0x28 => self.f & FLAG_Z != 0,
                    0x30 => self.f & FLAG_C == 0,
                    0x38 => self.f & FLAG_C != 0,
                    _ => false,
                };
                if take {
                    self.pc = Self::add_signed(self.pc, disp);
                    12
                } else {
                    7
                }
            }
            0x22 => {
                let addr = self.fetch_word(bus);
                let value = index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl());
                bus.mem_write(addr, value as u8);
                bus.mem_write(addr.wrapping_add(1), (value >> 8) as u8);
                if index.is_some() { 20 } else { 16 }
            }
            0x27 => {
                self.daa();
                4
            }
            0x2A => {
                let addr = self.fetch_word(bus);
                let lo = bus.mem_read(addr) as u16;
                let hi = bus.mem_read(addr.wrapping_add(1)) as u16;
                let value = (hi << 8) | lo;
                if let Some(index) = index {
                    self.set_index(index, value);
                    20
                } else {
                    self.set_hl(value);
                    16
                }
            }
            0x2F => {
                self.a = !self.a;
                self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV | FLAG_C)) | FLAG_H | FLAG_N | (self.a & (FLAG_5 | FLAG_3));
                4
            }
            0x32 => {
                let addr = self.fetch_word(bus);
                bus.mem_write(addr, self.a);
                13
            }
            0x34 => {
                let addr = index
                    .map(|i| Self::add_signed(self.get_index(i), self.fetch_byte(bus) as i8))
                    .unwrap_or_else(|| self.hl());
                let value = bus.mem_read(addr);
                let result = self.inc8(value);
                bus.mem_write(addr, result);
                if index.is_some() { 23 } else { 11 }
            }
            0x35 => {
                let addr = index
                    .map(|i| Self::add_signed(self.get_index(i), self.fetch_byte(bus) as i8))
                    .unwrap_or_else(|| self.hl());
                let value = bus.mem_read(addr);
                let result = self.dec8(value);
                bus.mem_write(addr, result);
                if index.is_some() { 23 } else { 11 }
            }
            0x36 => {
                if let Some(index) = index {
                    let addr = Self::add_signed(self.get_index(index), self.fetch_byte(bus) as i8);
                    let value = self.fetch_byte(bus);
                    bus.mem_write(addr, value);
                    19
                } else {
                    let value = self.fetch_byte(bus);
                    bus.mem_write(self.hl(), value);
                    10
                }
            }
            0x37 => {
                self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV)) | FLAG_C | (self.a & (FLAG_5 | FLAG_3));
                4
            }
            0x3A => {
                let addr = self.fetch_word(bus);
                self.a = bus.mem_read(addr);
                13
            }
            0x3F => {
                let old_carry = self.f & FLAG_C;
                self.f = (self.f & (FLAG_S | FLAG_Z | FLAG_PV))
                    | (self.a & (FLAG_5 | FLAG_3))
                    | if old_carry != 0 { FLAG_H } else { 0 }
                    | if old_carry == 0 { FLAG_C } else { 0 };
                4
            }
            0xC0 | 0xC8 | 0xD0 | 0xD8 | 0xE0 | 0xE8 | 0xF0 | 0xF8 => {
                let cond = (opcode >> 3) & 0x07;
                if self.cond(cond) {
                    self.pc = self.pop(bus);
                    11
                } else {
                    5
                }
            }
            0xC1 | 0xD1 | 0xE1 | 0xF1 => {
                let rp = (opcode >> 4) & 0x03;
                let value = self.pop(bus);
                self.set_rp2(rp, value, if opcode == 0xE1 { index } else { None });
                if opcode == 0xE1 && index.is_some() { 14 } else { 10 }
            }
            0xC2 | 0xCA | 0xD2 | 0xDA | 0xE2 | 0xEA | 0xF2 | 0xFA => {
                let addr = self.fetch_word(bus);
                if self.cond((opcode >> 3) & 0x07) {
                    self.pc = addr;
                }
                10
            }
            0xC3 => {
                self.pc = self.fetch_word(bus);
                10
            }
            0xC4 | 0xCC | 0xD4 | 0xDC | 0xE4 | 0xEC | 0xF4 | 0xFC => {
                let addr = self.fetch_word(bus);
                if self.cond((opcode >> 3) & 0x07) {
                    let ret = self.pc;
                    self.push(ret, bus);
                    self.pc = addr;
                    17
                } else {
                    10
                }
            }
            0xC5 | 0xD5 | 0xE5 | 0xF5 => {
                let rp = (opcode >> 4) & 0x03;
                let value = self.get_rp2(rp, if opcode == 0xE5 { index } else { None });
                self.push(value, bus);
                if opcode == 0xE5 && index.is_some() { 15 } else { 11 }
            }
            0xC6 | 0xCE | 0xD6 | 0xDE | 0xE6 | 0xEE | 0xF6 | 0xFE => {
                let value = self.fetch_byte(bus);
                self.alu((opcode >> 3) & 0x07, value);
                7
            }
            0xC7 | 0xCF | 0xD7 | 0xDF | 0xE7 | 0xEF | 0xF7 | 0xFF => {
                let ret = self.pc;
                self.push(ret, bus);
                self.pc = (opcode as u16) & 0x38;
                11
            }
            0xC9 => {
                self.pc = self.pop(bus);
                10
            }
            0xCB => {
                let cb = self.fetch_opcode(bus);
                self.execute_cb(bus, cb, None, None)
            }
            0xCD => {
                let addr = self.fetch_word(bus);
                let ret = self.pc;
                self.push(ret, bus);
                self.pc = addr;
                17
            }
            0xD3 => {
                let port = self.fetch_byte(bus);
                bus.io_write(port, self.a);
                11
            }
            0xD9 => {
                std::mem::swap(&mut self.b, &mut self.b_);
                std::mem::swap(&mut self.c, &mut self.c_);
                std::mem::swap(&mut self.d, &mut self.d_);
                std::mem::swap(&mut self.e, &mut self.e_);
                std::mem::swap(&mut self.h, &mut self.h_);
                std::mem::swap(&mut self.l, &mut self.l_);
                4
            }
            0xDB => {
                let port = self.fetch_byte(bus);
                self.a = bus.io_read(port);
                11
            }
            0xDD => self.execute_indexed(bus, IndexReg::IX),
            0xE3 => {
                let value = index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl());
                let lo = bus.mem_read(self.sp) as u16;
                let hi = bus.mem_read(self.sp.wrapping_add(1)) as u16;
                bus.mem_write(self.sp, value as u8);
                bus.mem_write(self.sp.wrapping_add(1), (value >> 8) as u8);
                let new_value = (hi << 8) | lo;
                if let Some(index) = index {
                    self.set_index(index, new_value);
                    23
                } else {
                    self.set_hl(new_value);
                    19
                }
            }
            0xE9 => {
                self.pc = index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl());
                if index.is_some() { 8 } else { 4 }
            }
            0xEB => {
                if let Some(index) = index {
                    let de = self.de();
                    let idx = self.get_index(index);
                    self.set_de(idx);
                    self.set_index(index, de);
                    4
                } else {
                    let de = self.de();
                    let hl = self.hl();
                    self.set_de(hl);
                    self.set_hl(de);
                    4
                }
            }
            0xED => self.execute_ed(bus),
            0xF3 => {
                self.iff1 = false;
                self.iff2 = false;
                4
            }
            0xF9 => {
                self.sp = index.map(|i| self.get_index(i)).unwrap_or_else(|| self.hl());
                if index.is_some() { 10 } else { 6 }
            }
            0xFB => {
                self.iff1 = true;
                self.iff2 = true;
                4
            }
            0xFD => self.execute_indexed(bus, IndexReg::IY),
            _ => 4,
        }
    }

    pub fn step<B: BusInterface>(&mut self, bus: &mut B) -> u32 {
        if self.halted {
            self.cycles += 4;
            return 4;
        }
        let opcode = self.fetch_opcode(bus);
        let cycles = match opcode {
            0xDD => self.execute_indexed(bus, IndexReg::IX),
            0xED => self.execute_ed(bus),
            0xFD => self.execute_indexed(bus, IndexReg::IY),
            _ => self.execute_base(bus, opcode, None),
        };
        self.cycles += cycles as u64;
        cycles
    }

    pub fn interrupt<B: BusInterface>(&mut self, vector: u8, bus: &mut B) {
        if !self.iff1 {
            return;
        }
        self.iff1 = false;
        self.iff2 = false;
        self.halted = false;
        self.push(self.pc, bus);
        self.pc = match self.interrupt_mode {
            0 => (vector as u16) & 0x38,
            1 => 0x0038,
            2 => {
                let addr = ((self.i as u16) << 8) | vector as u16;
                let lo = bus.mem_read(addr) as u16;
                let hi = bus.mem_read(addr.wrapping_add(1)) as u16;
                (hi << 8) | lo
            }
            _ => 0x0038,
        };
    }
}
