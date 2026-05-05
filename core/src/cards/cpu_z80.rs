use crate::card::S100Card;
use crate::cpu_z80::CpuZ80;

pub struct Z80Card {
    cpu: CpuZ80,
    speed_hz: u64,
    cycles_per_tick: u64,
    cycle_accumulator: u64,
}

impl Z80Card {
    pub fn new(speed_hz: u64) -> Self {
        Self {
            cpu: CpuZ80::new(),
            speed_hz,
            cycles_per_tick: speed_hz.max(1),
            cycle_accumulator: 0,
        }
    }

    pub fn into_cpu(self) -> CpuZ80 {
        self.cpu
    }

    pub fn speed_hz(&self) -> u64 {
        self.speed_hz
    }

    pub fn cycles_per_tick(&self) -> u64 {
        self.cycles_per_tick
    }

    pub fn cycle_accumulator(&self) -> u64 {
        self.cycle_accumulator
    }
}

impl S100Card for Z80Card {
    fn as_any(&self) -> &dyn std::any::Any { self }
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any { self }
    fn name(&self) -> &str { "Z80" }
    fn reset(&mut self) { self.cpu = CpuZ80::new(); }
    fn step(&mut self) {}
    fn memory_read(&mut self, _: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _: u16, _: u8) {}
    fn io_read(&mut self, _: u8) -> Option<u8> { None }
    fn io_write(&mut self, _: u8, _: u8) {}
}
