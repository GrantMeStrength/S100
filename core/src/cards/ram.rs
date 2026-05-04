use std::any::Any;
use crate::card::S100Card;

pub struct RamCard {
    name: String,
    base: u16,
    data: Vec<u8>,
}

impl RamCard {
    pub fn new(name: impl Into<String>, base: u16, size: usize) -> Self {
        RamCard {
            name: name.into(),
            base,
            data: vec![0u8; size],
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

impl S100Card for RamCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }
    fn reset(&mut self) { /* RAM retains state across reset */ }

    fn memory_read(&mut self, addr: u16) -> Option<u8> {
        self.owns(addr).map(|off| self.data[off])
    }

    fn memory_write(&mut self, addr: u16, data: u8) {
        if let Some(off) = self.owns(addr) {
            self.data[off] = data;
        }
    }

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }
    fn io_write(&mut self, _port: u8, _data: u8) {}
}
