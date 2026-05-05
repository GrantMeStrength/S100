use std::any::Any;
use crate::card::S100Card;

/// Read-only memory card. Ignores writes silently.
///
/// Optional phantom-port support: if `phantom_port` is set, any I/O write to
/// that port pages the ROM out of the address space (active → false).  A reset
/// re-enables it.  This replaces the old dedicated `boot_rom` / Shadow ROM card.
pub struct RomCard {
    name: String,
    base: u16,
    data: Vec<u8>,
    /// If Some, a write to this I/O port disables the ROM until next reset.
    pub phantom_port: Option<u8>,
    /// False once paged out via the phantom port; reset restores to true.
    pub active: bool,
}

impl RomCard {
    pub fn new(name: impl Into<String>, base: u16, data: Vec<u8>) -> Self {
        RomCard { name: name.into(), base, data, phantom_port: None, active: true }
    }

    fn owns(&self, addr: u16) -> Option<usize> {
        if !self.active { return None; }
        let offset = addr.wrapping_sub(self.base) as usize;
        if offset < self.data.len() { Some(offset) } else { None }
    }
}

impl S100Card for RomCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) { self.active = true; }

    fn memory_read(&mut self, addr: u16) -> Option<u8> {
        self.owns(addr).map(|off| self.data[off])
    }

    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }

    fn io_write(&mut self, port: u8, _data: u8) {
        if self.phantom_port == Some(port) {
            self.active = false;
        }
    }

    fn owns_mem(&self, addr: u16) -> bool { self.owns(addr).is_some() }
}
