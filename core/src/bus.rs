use crate::card::S100Card;
use crate::trace::{TraceBuffer, TraceEntry, OpKind};

/// The trait the CPU uses to drive the bus.
pub trait BusInterface {
    fn mem_read(&mut self, addr: u16) -> u8;
    fn mem_write(&mut self, addr: u16, data: u8);
    fn io_read(&mut self, port: u8) -> u8;
    fn io_write(&mut self, port: u8, data: u8);
}

/// The S-100 bus — owns all peripheral cards and routes cycles.
pub struct Bus {
    pub cards: Vec<Box<dyn S100Card>>,
    pub trace: TraceBuffer,
    pub cycle_count: u64,
}

impl Bus {
    pub fn new() -> Self {
        Bus {
            cards: Vec::new(),
            trace: TraceBuffer::new(16384),
            cycle_count: 0,
        }
    }

    pub fn add_card(&mut self, card: Box<dyn S100Card>) {
        self.cards.push(card);
    }

    pub fn reset(&mut self) {
        for card in &mut self.cards {
            card.reset();
        }
    }

    /// Call step() on each card (e.g. for DMA / timers).
    pub fn step_cards(&mut self) {
        for card in &mut self.cards {
            card.step();
        }
    }

    fn record(&mut self, entry: TraceEntry) {
        self.trace.push(entry);
    }
}

impl BusInterface for Bus {
    fn mem_read(&mut self, addr: u16) -> u8 {
        self.cycle_count += 1;
        for card in &mut self.cards {
            if let Some(data) = card.memory_read(addr) {
                let name = card.name().to_owned();
                self.record(TraceEntry {
                    cycle: self.cycle_count,
                    address: addr,
                    data,
                    op: OpKind::MemRead,
                    source: name,
                });
                return data;
            }
        }
        // Open bus — no card responded
        0xFF
    }

    fn mem_write(&mut self, addr: u16, data: u8) {
        self.cycle_count += 1;
        let mut source = String::from("none");
        for card in &mut self.cards {
            // Use owns_mem for ownership check — avoids triggering memory_read side effects.
            if card.owns_mem(addr) && source == "none" {
                source = card.name().to_owned();
            }
            card.memory_write(addr, data);
        }
        self.record(TraceEntry {
            cycle: self.cycle_count,
            address: addr,
            data,
            op: OpKind::MemWrite,
            source,
        });
    }

    fn io_read(&mut self, port: u8) -> u8 {
        self.cycle_count += 1;
        for card in &mut self.cards {
            if let Some(data) = card.io_read(port) {
                let name = card.name().to_owned();
                self.record(TraceEntry {
                    cycle: self.cycle_count,
                    address: port as u16,
                    data,
                    op: OpKind::IoRead,
                    source: name,
                });
                return data;
            }
        }
        0xFF
    }

    fn io_write(&mut self, port: u8, data: u8) {
        self.cycle_count += 1;
        let mut source = String::from("none");
        for card in &mut self.cards {
            // Use owns_io for ownership check — avoids triggering destructive side effects
            // that io_read() might have (e.g. FDC triggering a disk read).
            if card.owns_io(port) && source == "none" {
                source = card.name().to_owned();
            }
            card.io_write(port, data);
        }
        self.record(TraceEntry {
            cycle: self.cycle_count,
            address: port as u16,
            data,
            op: OpKind::IoWrite,
            source,
        });
    }
}
