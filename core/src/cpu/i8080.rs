use serde::Serialize;
use crate::bus::BusInterface;

#[derive(Debug, Clone, Serialize)]
pub struct Flags {
    pub s: bool,
    pub z: bool,
    pub ac: bool,
    pub p: bool,
    pub cy: bool,
}

impl Flags {
    pub fn new() -> Self {
        Flags { s: false, z: true, ac: false, p: false, cy: false }
    }

    pub fn to_byte(&self) -> u8 {
        let mut f = 0x02u8; // bit 1 always set
        if self.s  { f |= 0x80; }
        if self.z  { f |= 0x40; }
        if self.ac { f |= 0x10; }
        if self.p  { f |= 0x04; }
        if self.cy { f |= 0x01; }
        f
    }

    pub fn from_byte(b: u8) -> Self {
        Flags {
            s:  b & 0x80 != 0,
            z:  b & 0x40 != 0,
            ac: b & 0x10 != 0,
            p:  b & 0x04 != 0,
            cy: b & 0x01 != 0,
        }
    }

    fn set_szp(&mut self, val: u8) {
        self.s = val & 0x80 != 0;
        self.z = val == 0;
        self.p = val.count_ones() % 2 == 0;
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Cpu8080 {
    pub a: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
    pub sp: u16,
    pub pc: u16,
    pub flags: Flags,
    pub halted: bool,
    pub interrupts_enabled: bool,
    pub cycles: u64,
}

impl Cpu8080 {
    pub fn new() -> Self {
        Cpu8080 {
            a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
            sp: 0xFFFF,
            pc: 0x0000,
            flags: Flags::new(),
            halted: false,
            interrupts_enabled: false,
            cycles: 0,
        }
    }

    pub fn reset(&mut self) {
        *self = Cpu8080::new();
    }

    // ── Register pair helpers ──────────────────────────────────────────────

    fn bc(&self) -> u16 { (self.b as u16) << 8 | self.c as u16 }
    fn de(&self) -> u16 { (self.d as u16) << 8 | self.e as u16 }
    fn hl(&self) -> u16 { (self.h as u16) << 8 | self.l as u16 }

    fn set_bc(&mut self, v: u16) { self.b = (v >> 8) as u8; self.c = v as u8; }
    fn set_de(&mut self, v: u16) { self.d = (v >> 8) as u8; self.e = v as u8; }
    fn set_hl(&mut self, v: u16) { self.h = (v >> 8) as u8; self.l = v as u8; }

    // ── Register access by 3-bit code ─────────────────────────────────────

    fn get_reg<B: BusInterface>(&self, r: u8, bus: &mut B) -> u8 {
        match r & 7 {
            0 => self.b,
            1 => self.c,
            2 => self.d,
            3 => self.e,
            4 => self.h,
            5 => self.l,
            6 => bus.mem_read(self.hl()),
            7 => self.a,
            _ => unreachable!(),
        }
    }

    fn set_reg<B: BusInterface>(&mut self, r: u8, val: u8, bus: &mut B) {
        match r & 7 {
            0 => self.b = val,
            1 => self.c = val,
            2 => self.d = val,
            3 => self.e = val,
            4 => self.h = val,
            5 => self.l = val,
            6 => bus.mem_write(self.hl(), val),
            7 => self.a = val,
            _ => unreachable!(),
        }
    }

    // ── Fetch helpers ──────────────────────────────────────────────────────

    fn fetch_byte<B: BusInterface>(&mut self, bus: &mut B) -> u8 {
        let b = bus.mem_read(self.pc);
        self.pc = self.pc.wrapping_add(1);
        b
    }

    fn fetch_word<B: BusInterface>(&mut self, bus: &mut B) -> u16 {
        let lo = self.fetch_byte(bus) as u16;
        let hi = self.fetch_byte(bus) as u16;
        hi << 8 | lo
    }

    // ── Stack helpers ──────────────────────────────────────────────────────

    fn push<B: BusInterface>(&mut self, val: u16, bus: &mut B) {
        self.sp = self.sp.wrapping_sub(1);
        bus.mem_write(self.sp, (val >> 8) as u8);
        self.sp = self.sp.wrapping_sub(1);
        bus.mem_write(self.sp, val as u8);
    }

    fn pop<B: BusInterface>(&mut self, bus: &mut B) -> u16 {
        let lo = bus.mem_read(self.sp) as u16;
        self.sp = self.sp.wrapping_add(1);
        let hi = bus.mem_read(self.sp) as u16;
        self.sp = self.sp.wrapping_add(1);
        hi << 8 | lo
    }

    // ── ALU operations ─────────────────────────────────────────────────────

    fn add(&mut self, val: u8, with_carry: bool) {
        let cy = if with_carry && self.flags.cy { 1u16 } else { 0 };
        let a = self.a as u16;
        let v = val as u16;
        let result = a + v + cy;
        let r = result as u8;
        self.flags.cy = result > 0xFF;
        self.flags.ac = ((a ^ v ^ result) & 0x10) != 0;
        self.flags.set_szp(r);
        self.a = r;
    }

    fn sub(&mut self, val: u8, with_borrow: bool) {
        let borrow = if with_borrow && self.flags.cy { 1u16 } else { 0 };
        let a = self.a as u16;
        let v = val as u16;
        let result = a.wrapping_sub(v).wrapping_sub(borrow);
        let r = result as u8;
        self.flags.cy = a < v + borrow;
        self.flags.ac = ((a ^ v ^ result) & 0x10) != 0;
        self.flags.set_szp(r);
        self.a = r;
    }

    fn cmp(&mut self, val: u8) {
        let saved = self.a;
        self.sub(val, false);
        self.a = saved;
    }

    fn ana(&mut self, val: u8) {
        let r = self.a & val;
        self.flags.cy = false;
        self.flags.ac = ((self.a | val) & 0x08) != 0;
        self.flags.set_szp(r);
        self.a = r;
    }

    fn xra(&mut self, val: u8) {
        let r = self.a ^ val;
        self.flags.cy = false;
        self.flags.ac = false;
        self.flags.set_szp(r);
        self.a = r;
    }

    fn ora(&mut self, val: u8) {
        let r = self.a | val;
        self.flags.cy = false;
        self.flags.ac = false;
        self.flags.set_szp(r);
        self.a = r;
    }

    fn alu_op(&mut self, op: u8, val: u8) {
        match op & 7 {
            0 => self.add(val, false),
            1 => self.add(val, true),
            2 => self.sub(val, false),
            3 => self.sub(val, true),
            4 => self.ana(val),
            5 => self.xra(val),
            6 => self.ora(val),
            7 => self.cmp(val),
            _ => unreachable!(),
        }
    }

    fn inr(&mut self, val: u8) -> u8 {
        let r = val.wrapping_add(1);
        self.flags.ac = (val & 0x0F) == 0x0F;
        self.flags.set_szp(r);
        r
    }

    fn dcr(&mut self, val: u8) -> u8 {
        let r = val.wrapping_sub(1);
        self.flags.ac = (val & 0x0F) == 0x00;
        self.flags.set_szp(r);
        r
    }

    fn dad(&mut self, val: u16) {
        let hl = self.hl() as u32;
        let result = hl + val as u32;
        self.flags.cy = result > 0xFFFF;
        self.set_hl(result as u16);
    }

    // ── Rotate operations ──────────────────────────────────────────────────

    fn rlc(&mut self) {
        let cy = self.a >> 7;
        self.a = (self.a << 1) | cy;
        self.flags.cy = cy != 0;
    }

    fn rrc(&mut self) {
        let cy = self.a & 1;
        self.a = (self.a >> 1) | (cy << 7);
        self.flags.cy = cy != 0;
    }

    fn ral(&mut self) {
        let old_cy = self.flags.cy as u8;
        self.flags.cy = self.a & 0x80 != 0;
        self.a = (self.a << 1) | old_cy;
    }

    fn rar(&mut self) {
        let old_cy = self.flags.cy as u8;
        self.flags.cy = self.a & 1 != 0;
        self.a = (self.a >> 1) | (old_cy << 7);
    }

    // ── DAA ────────────────────────────────────────────────────────────────

    fn daa(&mut self) {
        let mut a = self.a as u16;
        let mut correction: u16 = 0;
        let mut new_cy = false;

        if self.flags.ac || (a & 0x0F) > 9 {
            correction |= 0x06;
        }
        if self.flags.cy || a > 0x99 {
            correction |= 0x60;
            new_cy = true;
        }
        let result = a.wrapping_add(correction);
        a = result & 0xFF;
        self.flags.cy = new_cy;
        self.flags.ac = ((self.a as u16 ^ correction ^ result) & 0x10) != 0;
        self.flags.set_szp(a as u8);
        self.a = a as u8;
    }

    // ── Condition codes ────────────────────────────────────────────────────

    fn condition(&self, cond: u8) -> bool {
        match cond & 7 {
            0 => !self.flags.z,  // NZ
            1 =>  self.flags.z,  // Z
            2 => !self.flags.cy, // NC
            3 =>  self.flags.cy, // C
            4 => !self.flags.p,  // PO (parity odd)
            5 =>  self.flags.p,  // PE (parity even)
            6 => !self.flags.s,  // P (positive)
            7 =>  self.flags.s,  // M (minus)
            _ => unreachable!(),
        }
    }

    // ── Main step ─────────────────────────────────────────────────────────

    /// Execute one instruction, return T-states consumed.
    pub fn step<B: BusInterface>(&mut self, bus: &mut B) -> u32 {
        if self.halted {
            self.cycles += 4;
            return 4;
        }

        let opcode = self.fetch_byte(bus);

        // ── MOV group 0x40-0x7F ───────────────────────────────────────────
        if opcode >= 0x40 && opcode < 0x80 {
            if opcode == 0x76 {
                // HLT
                self.halted = true;
                self.cycles += 7;
                return 7;
            }
            let dst = (opcode >> 3) & 7;
            let src = opcode & 7;
            let val = self.get_reg(src, bus);
            self.set_reg(dst, val, bus);
            let t = if dst == 6 || src == 6 { 7 } else { 5 };
            self.cycles += t as u64;
            return t;
        }

        // ── ALU register group 0x80-0xBF ─────────────────────────────────
        if opcode >= 0x80 && opcode < 0xC0 {
            let op  = (opcode >> 3) & 7;
            let src = opcode & 7;
            let val = self.get_reg(src, bus);
            self.alu_op(op, val);
            let t = if src == 6 { 7 } else { 4 };
            self.cycles += t as u64;
            return t;
        }

        // ── All other opcodes ─────────────────────────────────────────────
        let t: u32 = match opcode {
            // ── 0x00..0x3F ───────────────────────────────────────────────
            0x00 | 0x08 | 0x10 | 0x18 | 0x20 | 0x28 | 0x30 | 0x38 => 4, // NOP / undoc NOP

            0x01 => { let v = self.fetch_word(bus); self.set_bc(v); 10 }
            0x11 => { let v = self.fetch_word(bus); self.set_de(v); 10 }
            0x21 => { let v = self.fetch_word(bus); self.set_hl(v); 10 }
            0x31 => { self.sp = self.fetch_word(bus); 10 }

            0x02 => { bus.mem_write(self.bc(), self.a); 7 }
            0x12 => { bus.mem_write(self.de(), self.a); 7 }

            0x0A => { self.a = bus.mem_read(self.bc()); 7 }
            0x1A => { self.a = bus.mem_read(self.de()); 7 }

            0x03 => { let v = self.bc().wrapping_add(1); self.set_bc(v); 5 }
            0x13 => { let v = self.de().wrapping_add(1); self.set_de(v); 5 }
            0x23 => { let v = self.hl().wrapping_add(1); self.set_hl(v); 5 }
            0x33 => { self.sp = self.sp.wrapping_add(1); 5 }

            0x0B => { let v = self.bc().wrapping_sub(1); self.set_bc(v); 5 }
            0x1B => { let v = self.de().wrapping_sub(1); self.set_de(v); 5 }
            0x2B => { let v = self.hl().wrapping_sub(1); self.set_hl(v); 5 }
            0x3B => { self.sp = self.sp.wrapping_sub(1); 5 }

            0x04 => { self.b = self.inr(self.b); 5 }
            0x0C => { self.c = self.inr(self.c); 5 }
            0x14 => { self.d = self.inr(self.d); 5 }
            0x1C => { self.e = self.inr(self.e); 5 }
            0x24 => { self.h = self.inr(self.h); 5 }
            0x2C => { self.l = self.inr(self.l); 5 }
            0x3C => { self.a = self.inr(self.a); 5 }
            0x34 => {
                let hl = self.hl();
                let v = bus.mem_read(hl);
                let r = self.inr(v);
                bus.mem_write(hl, r);
                10
            }

            0x05 => { self.b = self.dcr(self.b); 5 }
            0x0D => { self.c = self.dcr(self.c); 5 }
            0x15 => { self.d = self.dcr(self.d); 5 }
            0x1D => { self.e = self.dcr(self.e); 5 }
            0x25 => { self.h = self.dcr(self.h); 5 }
            0x2D => { self.l = self.dcr(self.l); 5 }
            0x3D => { self.a = self.dcr(self.a); 5 }
            0x35 => {
                let hl = self.hl();
                let v = bus.mem_read(hl);
                let r = self.dcr(v);
                bus.mem_write(hl, r);
                10
            }

            0x06 => { self.b = self.fetch_byte(bus); 7 }
            0x0E => { self.c = self.fetch_byte(bus); 7 }
            0x16 => { self.d = self.fetch_byte(bus); 7 }
            0x1E => { self.e = self.fetch_byte(bus); 7 }
            0x26 => { self.h = self.fetch_byte(bus); 7 }
            0x2E => { self.l = self.fetch_byte(bus); 7 }
            0x3E => { self.a = self.fetch_byte(bus); 7 }
            0x36 => {
                let d = self.fetch_byte(bus);
                bus.mem_write(self.hl(), d);
                10
            }

            0x07 => { self.rlc(); 4 }
            0x0F => { self.rrc(); 4 }
            0x17 => { self.ral(); 4 }
            0x1F => { self.rar(); 4 }

            0x09 => { let v = self.bc(); self.dad(v); 10 }
            0x19 => { let v = self.de(); self.dad(v); 10 }
            0x29 => { let v = self.hl(); self.dad(v); 10 }
            0x39 => { let v = self.sp; self.dad(v); 10 }

            0x22 => {
                let addr = self.fetch_word(bus);
                bus.mem_write(addr, self.l);
                bus.mem_write(addr.wrapping_add(1), self.h);
                16
            }
            0x2A => {
                let addr = self.fetch_word(bus);
                self.l = bus.mem_read(addr);
                self.h = bus.mem_read(addr.wrapping_add(1));
                16
            }

            0x32 => {
                let addr = self.fetch_word(bus);
                bus.mem_write(addr, self.a);
                13
            }
            0x3A => {
                let addr = self.fetch_word(bus);
                self.a = bus.mem_read(addr);
                13
            }

            0x27 => { self.daa(); 4 }
            0x2F => { self.a = !self.a; 4 }          // CMA
            0x37 => { self.flags.cy = true; 4 }       // STC
            0x3F => { self.flags.cy = !self.flags.cy; 4 } // CMC

            // ── 0xC0..0xFF ────────────────────────────────────────────────

            // PUSH
            0xC5 => { let v = self.bc(); self.push(v, bus); 11 }
            0xD5 => { let v = self.de(); self.push(v, bus); 11 }
            0xE5 => { let v = self.hl(); self.push(v, bus); 11 }
            0xF5 => {
                let psw = (self.a as u16) << 8 | self.flags.to_byte() as u16;
                self.push(psw, bus);
                11
            }

            // POP
            0xC1 => { let v = self.pop(bus); self.set_bc(v); 10 }
            0xD1 => { let v = self.pop(bus); self.set_de(v); 10 }
            0xE1 => { let v = self.pop(bus); self.set_hl(v); 10 }
            0xF1 => {
                let v = self.pop(bus);
                self.a = (v >> 8) as u8;
                self.flags = Flags::from_byte(v as u8);
                10
            }

            // JMP and conditional jumps
            0xC3 => { self.pc = self.fetch_word(bus); 10 }
            0xCB => { self.pc = self.fetch_word(bus); 10 } // undoc JMP

            0xC2 => { let a = self.fetch_word(bus); if !self.flags.z  { self.pc = a; } 10 }
            0xCA => { let a = self.fetch_word(bus); if  self.flags.z  { self.pc = a; } 10 }
            0xD2 => { let a = self.fetch_word(bus); if !self.flags.cy { self.pc = a; } 10 }
            0xDA => { let a = self.fetch_word(bus); if  self.flags.cy { self.pc = a; } 10 }
            0xE2 => { let a = self.fetch_word(bus); if !self.flags.p  { self.pc = a; } 10 }
            0xEA => { let a = self.fetch_word(bus); if  self.flags.p  { self.pc = a; } 10 }
            0xF2 => { let a = self.fetch_word(bus); if !self.flags.s  { self.pc = a; } 10 }
            0xFA => { let a = self.fetch_word(bus); if  self.flags.s  { self.pc = a; } 10 }

            // CALL and conditional calls
            0xCD => {
                let addr = self.fetch_word(bus);
                let ret = self.pc;
                self.push(ret, bus);
                self.pc = addr;
                17
            }
            0xDD | 0xED | 0xFD => { // undoc CALL
                let addr = self.fetch_word(bus);
                let ret = self.pc;
                self.push(ret, bus);
                self.pc = addr;
                17
            }

            0xC4 => {
                let addr = self.fetch_word(bus);
                if !self.flags.z  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xCC => {
                let addr = self.fetch_word(bus);
                if  self.flags.z  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xD4 => {
                let addr = self.fetch_word(bus);
                if !self.flags.cy { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xDC => {
                let addr = self.fetch_word(bus);
                if  self.flags.cy { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xE4 => {
                let addr = self.fetch_word(bus);
                if !self.flags.p  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xEC => {
                let addr = self.fetch_word(bus);
                if  self.flags.p  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xF4 => {
                let addr = self.fetch_word(bus);
                if !self.flags.s  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }
            0xFC => {
                let addr = self.fetch_word(bus);
                if  self.flags.s  { let r = self.pc; self.push(r, bus); self.pc = addr; 17 } else { 11 }
            }

            // RET and conditional returns
            0xC9 | 0xD9 => { self.pc = self.pop(bus); 10 }

            0xC0 => { if !self.flags.z  { self.pc = self.pop(bus); 11 } else { 5 } }
            0xC8 => { if  self.flags.z  { self.pc = self.pop(bus); 11 } else { 5 } }
            0xD0 => { if !self.flags.cy { self.pc = self.pop(bus); 11 } else { 5 } }
            0xD8 => { if  self.flags.cy { self.pc = self.pop(bus); 11 } else { 5 } }
            0xE0 => { if !self.flags.p  { self.pc = self.pop(bus); 11 } else { 5 } }
            0xE8 => { if  self.flags.p  { self.pc = self.pop(bus); 11 } else { 5 } }
            0xF0 => { if !self.flags.s  { self.pc = self.pop(bus); 11 } else { 5 } }
            0xF8 => { if  self.flags.s  { self.pc = self.pop(bus); 11 } else { 5 } }

            // RST
            0xC7 => { let r = self.pc; self.push(r, bus); self.pc = 0x00; 11 }
            0xCF => { let r = self.pc; self.push(r, bus); self.pc = 0x08; 11 }
            0xD7 => { let r = self.pc; self.push(r, bus); self.pc = 0x10; 11 }
            0xDF => { let r = self.pc; self.push(r, bus); self.pc = 0x18; 11 }
            0xE7 => { let r = self.pc; self.push(r, bus); self.pc = 0x20; 11 }
            0xEF => { let r = self.pc; self.push(r, bus); self.pc = 0x28; 11 }
            0xF7 => { let r = self.pc; self.push(r, bus); self.pc = 0x30; 11 }
            0xFF => { let r = self.pc; self.push(r, bus); self.pc = 0x38; 11 }

            // IN / OUT
            0xDB => { let port = self.fetch_byte(bus); self.a = bus.io_read(port); 10 }
            0xD3 => { let port = self.fetch_byte(bus); bus.io_write(port, self.a); 10 }

            // Immediate ALU
            0xC6 => { let v = self.fetch_byte(bus); self.add(v, false); 7 }
            0xCE => { let v = self.fetch_byte(bus); self.add(v, true);  7 }
            0xD6 => { let v = self.fetch_byte(bus); self.sub(v, false); 7 }
            0xDE => { let v = self.fetch_byte(bus); self.sub(v, true);  7 }
            0xE6 => { let v = self.fetch_byte(bus); self.ana(v); 7 }
            0xEE => { let v = self.fetch_byte(bus); self.xra(v); 7 }
            0xF6 => { let v = self.fetch_byte(bus); self.ora(v); 7 }
            0xFE => { let v = self.fetch_byte(bus); self.cmp(v); 7 }

            // XCHG (DE ↔ HL)
            0xEB => {
                let de = self.de();
                let hl = self.hl();
                self.set_de(hl);
                self.set_hl(de);
                4
            }

            // XTHL (HL ↔ (SP))
            0xE3 => {
                let hl = self.hl();
                let lo = bus.mem_read(self.sp);
                let hi = bus.mem_read(self.sp.wrapping_add(1));
                bus.mem_write(self.sp, hl as u8);
                bus.mem_write(self.sp.wrapping_add(1), (hl >> 8) as u8);
                self.h = hi;
                self.l = lo;
                18
            }

            // SPHL (SP ← HL)
            0xF9 => { self.sp = self.hl(); 5 }

            // PCHL (PC ← HL)
            0xE9 => { self.pc = self.hl(); 5 }

            // EI / DI
            0xFB => { self.interrupts_enabled = true;  4 }
            0xF3 => { self.interrupts_enabled = false; 4 }

            // Anything else — treat as NOP
            _ => 4,
        };

        self.cycles += t as u64;
        t
    }

    /// Trigger an interrupt (inject RST vector byte).
    pub fn interrupt<B: BusInterface>(&mut self, rst_vector: u8, bus: &mut B) {
        if self.interrupts_enabled {
            self.interrupts_enabled = false;
            self.halted = false;
            let pc = self.pc;
            self.push(pc, bus);
            self.pc = (rst_vector as u16 & 0x38) * 1;
        }
    }
}
