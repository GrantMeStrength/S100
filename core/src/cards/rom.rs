use std::any::Any;
use crate::card::S100Card;

/// Read-only memory card. Ignores writes silently.
pub struct RomCard {
    name: String,
    base: u16,
    data: Vec<u8>,
}

impl RomCard {
    pub fn new(name: impl Into<String>, base: u16, data: Vec<u8>) -> Self {
        RomCard {
            name: name.into(),
            base,
            data,
        }
    }

    fn owns(&self, addr: u16) -> Option<usize> {
        let offset = addr.wrapping_sub(self.base) as usize;
        if offset < self.data.len() {
            Some(offset)
        } else {
            None
        }
    }
}

impl S100Card for RomCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }
    fn reset(&mut self) {}

    fn memory_read(&mut self, addr: u16) -> Option<u8> {
        self.owns(addr).map(|off| self.data[off])
    }

    fn memory_write(&mut self, _addr: u16, _data: u8) {
        // ROM ignores writes
    }

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }
    fn io_write(&mut self, _port: u8, _data: u8) {}
}
