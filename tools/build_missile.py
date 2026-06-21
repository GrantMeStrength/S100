#!/usr/bin/env python3
"""
MISSILE — A Missile Command-style game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit, bit1=fire)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis (0=center, 1-127=up, 128-255=down)
"""

import os, sys

# ─── Mini Z80 assembler (same as MAZECHASE) ────────────────────────────────────

class Z80:
    def __init__(self, org=0x0100):
        self.org = org
        self.code = bytearray()
        self.labels = {}
        self.fixups = []

    @property
    def pc(self):
        return self.org + len(self.code)

    def label(self, name):
        if name in self.labels:
            raise ValueError(f"Duplicate label: {name}")
        self.labels[name] = self.pc

    def emit(self, *bs):
        for b in bs:
            self.code.append(b & 0xFF)

    def emit16(self, v):
        self.emit(v & 0xFF, (v >> 8) & 0xFF)

    def db(self, *vals):
        for v in vals:
            if isinstance(v, (bytes, bytearray)):
                self.code.extend(v)
            elif isinstance(v, str):
                self.code.extend(v.encode('ascii'))
            else:
                self.emit(v)

    def ds(self, n, fill=0):
        self.code.extend([fill] * n)

    def _ref16(self, lbl):
        self.fixups.append((len(self.code), lbl, 16))
        self.emit16(0)

    def _ref8(self, lbl):
        self.fixups.append((len(self.code), lbl, 8))
        self.emit(0)

    def resolve(self):
        for off, lbl, bits in self.fixups:
            if lbl not in self.labels:
                raise ValueError(f"Undefined label: {lbl}")
            addr = self.labels[lbl]
            if bits == 16:
                self.code[off] = addr & 0xFF
                self.code[off+1] = (addr >> 8) & 0xFF
            else:
                rel = addr - (self.org + off + 1)
                if rel < -128 or rel > 127:
                    raise ValueError(f"JR out of range: {lbl} (offset {rel})")
                self.code[off] = rel & 0xFF

    def save(self, path):
        self.resolve()
        with open(path, 'wb') as f:
            f.write(self.code)
        print(f"Written {len(self.code)} bytes → {path}")

    # Register encodings
    R = {'b':0,'c':1,'d':2,'e':3,'h':4,'l':5,'(hl)':6,'a':7}
    RP = {'bc':0,'de':1,'hl':2,'sp':3}
    RP2 = {'bc':0,'de':1,'hl':2,'af':3}
    CC = {'nz':0,'z':1,'nc':2,'c':3}

    # Instructions
    def nop(self): self.emit(0x00)
    def di(self): self.emit(0xF3)
    def ei(self): self.emit(0xFB)
    def ret(self): self.emit(0xC9)
    def cpl(self): self.emit(0x2F)
    def halt(self): self.emit(0x76)
    def daa(self): self.emit(0x27)

    def ld_r_r(self, d, s): self.emit(0x40 + self.R[d]*8 + self.R[s])
    def ld_r_n(self, r, n): self.emit(0x06 + self.R[r]*8, n & 0xFF)
    def ld_rp_nn(self, rp, nn): self.emit(0x01 + self.RP[rp]*16); self.emit16(nn)
    def ld_rp_label(self, rp, lbl): self.emit(0x01 + self.RP[rp]*16); self._ref16(lbl)
    def ld_a_addr(self, addr): self.emit(0x3A); self.emit16(addr)
    def ld_a_lbl(self, lbl): self.emit(0x3A); self._ref16(lbl)
    def ld_lbl_a(self, lbl): self.emit(0x32); self._ref16(lbl)
    def ld_a_de(self): self.emit(0x1A)
    def ld_de_a(self): self.emit(0x12)
    def ld_sp_hl(self): self.emit(0xF9)
    def ld_hl_r(self, r): self.emit(0x70 + self.R[r])  # LD (HL), r
    def ld_r_hl(self, r): self.emit(0x46 + self.R[r]*8)  # LD r, (HL)

    def push(self, rp): self.emit(0xC5 + self.RP2[rp]*16)
    def pop(self, rp): self.emit(0xC1 + self.RP2[rp]*16)

    def inc_r(self, r): self.emit(0x04 + self.R[r]*8)
    def dec_r(self, r): self.emit(0x05 + self.R[r]*8)
    def inc_rp(self, rp): self.emit(0x03 + self.RP[rp]*16)
    def dec_rp(self, rp): self.emit(0x0B + self.RP[rp]*16)

    def add_a_r(self, r): self.emit(0x80 + self.R[r])
    def add_a_n(self, n): self.emit(0xC6, n & 0xFF)
    def adc_a_r(self, r): self.emit(0x88 + self.R[r])
    def sub_r(self, r): self.emit(0x90 + self.R[r])
    def sub_n(self, n): self.emit(0xD6, n & 0xFF)
    def and_r(self, r): self.emit(0xA0 + self.R[r])
    def and_n(self, n): self.emit(0xE6, n & 0xFF)
    def or_r(self, r): self.emit(0xB0 + self.R[r])
    def or_n(self, n): self.emit(0xF6, n & 0xFF)
    def xor_r(self, r): self.emit(0xA8 + self.R[r])
    def xor_n(self, n): self.emit(0xEE, n & 0xFF)
    def cp_r(self, r): self.emit(0xB8 + self.R[r])
    def cp_n(self, n): self.emit(0xFE, n & 0xFF)
    def add_hl_rp(self, rp): self.emit(0x09 + self.RP[rp]*16)

    def in_a(self, p): self.emit(0xDB, p & 0xFF)
    def out_a(self, p): self.emit(0xD3, p & 0xFF)

    def jr(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0x20 + self.CC[cc_or_lbl]*8); self._ref8(lbl2)
        else:    self.emit(0x18); self._ref8(cc_or_lbl)

    def jp(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC2 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xC3); self._ref16(cc_or_lbl)

    def call(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC4 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xCD); self._ref16(cc_or_lbl)

    def ret_cc(self, cc): self.emit(0xC0 + self.CC[cc]*8)
    def djnz(self, lbl): self.emit(0x10); self._ref8(lbl)
    def jp_hl(self): self.emit(0xE9)

    def srl(self, r): self.emit(0xCB, 0x38 + self.R[r])
    def sla(self, r): self.emit(0xCB, 0x20 + self.R[r])
    def rl(self, r):  self.emit(0xCB, 0x10 + self.R[r])
    def rr(self, r):  self.emit(0xCB, 0x18 + self.R[r])
    def bit(self, b, r): self.emit(0xCB, 0x40 + b*8 + self.R[r])
    def set_bit(self, b, r): self.emit(0xCB, 0xC0 + b*8 + self.R[r])
    def res_bit(self, b, r): self.emit(0xCB, 0x80 + b*8 + self.R[r])
    def rra(self): self.emit(0x1F)
    def rla(self): self.emit(0x17)
    def rlca(self): self.emit(0x07)
    def rrca(self): self.emit(0x0F)

    def ldir(self): self.emit(0xED, 0xB0)
    def neg(self): self.emit(0xED, 0x44)

# ─── Constants ──────────────────────────────────────────────────────────────────
DAZ_NX, DAZ_NY = 0x0E, 0x0F
FB_BASE = 0x2000
FB_PAGE = 0x10
FB_SIZE = 2048
JOY_BTN, JOY_X, JOY_Y = 0x18, 0x19, 0x1A

BLACK, RED, GREEN, YELLOW = 0, 1, 2, 3
BLUE, MAGENTA, CYAN, WHITE = 4, 5, 6, 7
BRIGHT = 8
BRIGHT_RED = RED | BRIGHT
BRIGHT_GREEN = GREEN | BRIGHT
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_CYAN = CYAN | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

CITY1_X, CITY2_X, CITY3_X = 10, 32, 54
CITY_Y = 60
BASE_X, BASE_Y = 32, 62
ENEMY_SLOTS = 6
COUNTER_SLOTS = 3
EXP_SLOTS = 3
EXP_MAX = 6

# ═══════════════════════════════════════════════════════════════════════════════

a = Z80()

# ─── Python emission helpers ───────────────────────────────────────────────────

def plot_imm(x, y, color):
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.call('plot')


def hline_imm(x, y, w, color):
    if w <= 0:
        return
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('b', w)
    a.ld_r_n('c', color)
    a.call('hline')


def draw_city_block(cx, color):
    for yy in range(CITY_Y, 64):
        hline_imm(cx - 2, yy, 5, color)


def emit_draw_pixel_if_active(prefix, count, color):
    for i in range(count):
        cont = f'{prefix}_draw_cont_{i}'
        a.ld_a_lbl(f'{prefix}{i}_active')
        a.or_r('a')
        a.jp('z', cont)
        a.ld_a_lbl(f'{prefix}{i}_x')
        a.ld_r_r('d', 'a')
        a.ld_a_lbl(f'{prefix}{i}_y')
        a.ld_r_r('e', 'a')
        a.ld_r_n('c', color)
        a.call('plot')
        a.label(cont)


def emit_erase_pixel_if_active(prefix, count):
    for i in range(count):
        cont = f'{prefix}_erase_cont_{i}'
        a.ld_a_lbl(f'{prefix}{i}_active')
        a.or_r('a')
        a.jp('z', cont)
        a.ld_a_lbl(f'{prefix}{i}_x')
        a.ld_r_r('d', 'a')
        a.ld_a_lbl(f'{prefix}{i}_y')
        a.ld_r_r('e', 'a')
        a.ld_r_n('c', BLACK)
        a.call('plot')
        a.label(cont)


def emit_destroy_city(slot):
    lbl = f'destroy_city{slot}'
    cx = [CITY1_X, CITY2_X, CITY3_X][slot]
    a.label(lbl)
    a.ld_a_lbl(f'city{slot}_alive')
    a.or_r('a')
    a.ret_cc('z')
    a.xor_r('a')
    a.ld_lbl_a(f'city{slot}_alive')
    a.ld_a_lbl('cities_left')
    a.dec_r('a')
    a.ld_lbl_a('cities_left')
    # Erase the city pixels (draw black)
    for yy in range(CITY_Y, 64):
        hline_imm(cx - 2, yy, 5, BLACK)
    a.ret()


def emit_enemy_hit_city(slot):
    done = f'enemy_city_done_{slot}'
    chk1 = f'enemy_city_chk1_{slot}'
    chk2 = f'enemy_city_chk2_{slot}'
    a.ld_a_lbl(f'enemy{slot}_city')
    a.cp_n(0)
    a.jp('nz', chk1)
    a.call('destroy_city0')
    a.jp(done)
    a.label(chk1)
    a.cp_n(1)
    a.jp('nz', chk2)
    a.call('destroy_city1')
    a.jp(done)
    a.label(chk2)
    a.call('destroy_city2')
    a.label(done)


def emit_counter_move(slot):
    """Bresenham-style movement: Y is always the driving axis (missile goes up).
    Each frame: decrement y by 1, accumulate error for x steps."""
    end = f'cm_end_{slot}'
    notdone = f'cm_notdone_{slot}'

    a.ld_a_lbl(f'cm{slot}_active')
    a.or_r('a')
    a.jp('z', end)

    # Decrement Y (move up one pixel)
    a.ld_a_lbl(f'cm{slot}_y')
    a.dec_r('a')
    a.ld_lbl_a(f'cm{slot}_y')

    # Accumulate X error: err += dx
    a.ld_a_lbl(f'cm{slot}_err')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'cm{slot}_dx')
    a.add_a_r('b')
    a.ld_lbl_a(f'cm{slot}_err')

    # If err >= dy, step X and subtract dy
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'cm{slot}_dy')
    a.cp_r('b')            # compare dy with err: carry if dy < err (i.e. err >= dy)
    a.jp('nc', f'cm_nox_{slot}')  # if dy >= err, no X step
    # Step X in the correct direction
    a.ld_a_lbl(f'cm{slot}_sx')
    a.or_r('a')
    a.jp('z', f'cm_xleft_{slot}')
    # sx=1: move right
    a.ld_a_lbl(f'cm{slot}_x')
    a.inc_r('a')
    a.ld_lbl_a(f'cm{slot}_x')
    a.jp(f'cm_xdone_{slot}')
    a.label(f'cm_xleft_{slot}')
    # sx=0: move left
    a.ld_a_lbl(f'cm{slot}_x')
    a.dec_r('a')
    a.ld_lbl_a(f'cm{slot}_x')
    a.label(f'cm_xdone_{slot}')
    # Subtract dy from err
    a.ld_a_lbl(f'cm{slot}_err')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'cm{slot}_dy')
    a.ld_r_r('c', 'a')
    a.ld_r_r('a', 'b')
    a.sub_r('c')
    a.ld_lbl_a(f'cm{slot}_err')
    a.label(f'cm_nox_{slot}')

    # Check if reached target_y
    a.ld_a_lbl(f'cm{slot}_y')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'cm{slot}_ty')
    a.cp_r('b')
    a.jp('nz', notdone)
    # Reached target — explode
    a.xor_r('a')
    a.ld_lbl_a(f'cm{slot}_active')
    a.ld_a_lbl(f'cm{slot}_tx')
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(f'cm{slot}_ty')
    a.ld_r_r('e', 'a')
    a.call('start_explosion')
    a.label(notdone)
    a.label(end)


def emit_explosion_update(slot):
    end = f'ex_end_{slot}'
    grow = f'ex_grow_{slot}'
    stay = f'ex_stay_{slot}'

    a.ld_a_lbl(f'ex{slot}_active')
    a.or_r('a')
    a.jp('z', end)
    a.ld_a_lbl(f'ex{slot}_phase')
    a.cp_n(1)
    a.jp('z', grow)

    a.ld_a_lbl(f'ex{slot}_r')
    a.dec_r('a')
    a.ld_lbl_a(f'ex{slot}_r')
    a.or_r('a')
    a.jp('nz', end)
    a.xor_r('a')
    a.ld_lbl_a(f'ex{slot}_active')
    a.jp(end)

    a.label(grow)
    a.ld_a_lbl(f'ex{slot}_r')
    a.inc_r('a')
    a.ld_lbl_a(f'ex{slot}_r')
    a.cp_n(EXP_MAX)
    a.jp('c', stay)
    a.ld_r_n('a', 2)
    a.ld_lbl_a(f'ex{slot}_phase')
    a.label(stay)
    a.label(end)


def emit_draw_explosion(slot, erase=False):
    end = f'ex_draw_end_{slot}_{"e" if erase else "d"}'
    use_white = f'ex_draw_white_{slot}'
    color = BLACK if erase else None

    a.ld_a_lbl(f'ex{slot}_active')
    a.or_r('a')
    a.jp('z', end)
    a.ld_a_lbl(f'ex{slot}_x')
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(f'ex{slot}_y')
    a.ld_r_r('e', 'a')
    a.ld_a_lbl(f'ex{slot}_r')
    a.ld_r_r('b', 'a')
    if erase:
        a.ld_r_n('c', color)
    else:
        a.ld_a_lbl(f'ex{slot}_phase')
        a.cp_n(1)
        a.jp('nz', use_white)
        a.ld_r_n('c', BRIGHT_YELLOW)
        a.jp(f'ex_draw_go_{slot}')
        a.label(use_white)
        a.ld_r_n('c', BRIGHT_WHITE)
        a.label(f'ex_draw_go_{slot}')
    a.call('draw_diamond')
    a.label(end)


def emit_enemy_move(slot):
    end = f'enemy_end_{slot}'
    xeq = f'enemy_xeq_{slot}'
    miss = f'enemy_miss_{slot}'
    landed = f'enemy_landed_{slot}'

    a.ld_a_lbl(f'enemy{slot}_active')
    a.or_r('a')
    a.jp('z', end)

    a.ld_a_lbl(f'enemy{slot}_y')
    a.inc_r('a')
    a.ld_lbl_a(f'enemy{slot}_y')

    a.ld_a_lbl(f'enemy{slot}_x')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'enemy{slot}_tx')
    a.cp_r('b')
    a.jp('z', xeq)
    a.jp('c', f'enemy_xdec_{slot}')
    a.ld_a_lbl(f'enemy{slot}_x')
    a.inc_r('a')
    a.ld_lbl_a(f'enemy{slot}_x')
    a.jp(xeq)
    a.label(f'enemy_xdec_{slot}')
    a.ld_a_lbl(f'enemy{slot}_x')
    a.dec_r('a')
    a.ld_lbl_a(f'enemy{slot}_x')
    a.label(xeq)

    a.ld_a_lbl(f'enemy{slot}_y')
    a.cp_n(CITY_Y)
    a.jp('c', end)
    a.xor_r('a')
    a.ld_lbl_a(f'enemy{slot}_active')
    emit_enemy_hit_city(slot)
    a.jp(landed)
    a.label(miss)
    a.label(landed)
    a.label(end)


def emit_enemy_blast_checks(slot):
    slot_done = f'blast_slot_done_{slot}'
    for ex in range(EXP_SLOTS):
        next_lbl = f'blast_next_{slot}_{ex}'
        a.ld_a_lbl(f'enemy{slot}_active')
        a.or_r('a')
        a.jp('z', slot_done)
        a.ld_a_lbl(f'ex{ex}_active')
        a.or_r('a')
        a.jp('z', next_lbl)
        a.ld_a_lbl(f'enemy{slot}_x')
        a.ld_r_r('d', 'a')
        a.ld_a_lbl(f'enemy{slot}_y')
        a.ld_r_r('e', 'a')
        a.ld_a_lbl(f'ex{ex}_x')
        a.ld_r_r('b', 'a')
        a.ld_a_lbl(f'ex{ex}_y')
        a.ld_r_r('c', 'a')
        a.ld_a_lbl(f'ex{ex}_r')
        a.inc_r('a')
        a.ld_r_r('h', 'a')
        a.call('check_blast_hit')
        a.jp('nc', next_lbl)
        a.xor_r('a')
        a.ld_lbl_a(f'enemy{slot}_active')
        a.call('score_point')
        a.jp(slot_done)
        a.label(next_lbl)
    a.label(slot_done)

# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)

# Init Dazzler: normal, 2K, color
a.ld_r_n('a', 0x30)
a.out_a(DAZ_NY)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)

# Seed RNG
a.in_a(DAZ_NX)
a.ld_lbl_a('rng')

a.label('restart')
a.call('init_game')

a.label('main_loop')
a.call('vsync')
a.call('erase_moving')
a.call('input')
a.call('move_counters')
a.call('update_explosions')
a.call('check_blasts')
a.call('move_enemies')
a.call('check_blasts')
a.call('spawn_enemy')
a.call('redraw_static')
a.call('draw_moving')
a.call('check_wave')
a.call('check_game_over')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('vsync')
a.label('vs1')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('nz', 'vs1')
a.label('vs2')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('z', 'vs2')
a.ret()

a.label('clear_fb')
a.ld_rp_nn('hl', FB_BASE)
a.ld_rp_nn('de', FB_BASE + 1)
a.ld_rp_nn('bc', FB_SIZE - 1)
a.ld_r_n('(hl)', 0)
a.ldir()
a.ret()

# plot: pixel at D=x(0-63), E=y(0-63), color C. Clobbers A,HL
a.label('plot')
a.push('bc')
a.push('de')

a.ld_r_r('a', 'd')
a.cp_n(64)
a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e')
a.cp_n(64)
a.jp('nc', 'pl_out')

a.ld_rp_nn('hl', FB_BASE)

a.ld_r_r('a', 'd')
a.and_n(0x20)
a.jr('z', 'pl_lx')
a.push('bc')
a.ld_rp_nn('bc', 512)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_lx')

a.ld_r_r('a', 'e')
a.and_n(0x20)
a.jr('z', 'pl_ly')
a.push('bc')
a.ld_rp_nn('bc', 1024)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_ly')

a.ld_r_r('a', 'd')
a.and_n(0x1F)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e')
a.and_n(0x1F)

a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.srl('a')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.and_n(1)
a.jr('nz', 'pl_hi')

a.ld_r_r('a', '(hl)')
a.and_n(0xF0)
a.or_r('c')
a.ld_r_r('(hl)', 'a')
a.jr('pl_out')

a.label('pl_hi')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a'); a.sla('a'); a.sla('a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', '(hl)')
a.and_n(0x0F)
a.or_r('b')
a.ld_r_r('(hl)', 'a')

a.label('pl_out')
a.pop('de')
a.pop('bc')
a.ret()

a.label('hline')
a.push('bc')
a.push('de')
a.label('hl_lp')
a.call('plot')
a.inc_r('d')
a.djnz('hl_lp')
a.pop('de')
a.pop('bc')
a.ret()

# diamond outline at D,E radius B color C
a.label('draw_diamond')
a.ld_r_r('a', 'd')
a.ld_lbl_a('dia_cx')
a.ld_r_r('a', 'e')
a.ld_lbl_a('dia_cy')
a.ld_r_r('a', 'b')
a.ld_lbl_a('dia_r')
a.or_r('a')
a.jp('nz', 'dd_begin')
a.call('plot')
a.ret()
a.label('dd_begin')
a.xor_r('a')
a.ld_lbl_a('dia_i')
a.label('dd_loop')
a.ld_a_lbl('dia_i')
a.ld_r_r('b', 'a')
a.ld_a_lbl('dia_r')
a.sub_r('b')
a.ld_lbl_a('dia_dy')

# top-left
a.ld_a_lbl('dia_dy')
a.ld_r_r('h', 'a')
a.ld_a_lbl('dia_cx')
a.sub_r('b')
a.ld_r_r('d', 'a')
a.ld_a_lbl('dia_cy')
a.sub_r('h')
a.ld_r_r('e', 'a')
a.call('plot')

# top-right
a.ld_a_lbl('dia_dy')
a.ld_r_r('h', 'a')
a.ld_a_lbl('dia_cx')
a.add_a_r('b')
a.ld_r_r('d', 'a')
a.ld_a_lbl('dia_cy')
a.sub_r('h')
a.ld_r_r('e', 'a')
a.call('plot')

# bottom-left
a.ld_a_lbl('dia_dy')
a.ld_r_r('h', 'a')
a.ld_a_lbl('dia_cx')
a.sub_r('b')
a.ld_r_r('d', 'a')
a.ld_a_lbl('dia_cy')
a.add_a_r('h')
a.ld_r_r('e', 'a')
a.call('plot')

# bottom-right
a.ld_a_lbl('dia_dy')
a.ld_r_r('h', 'a')
a.ld_a_lbl('dia_cx')
a.add_a_r('b')
a.ld_r_r('d', 'a')
a.ld_a_lbl('dia_cy')
a.add_a_r('h')
a.ld_r_r('e', 'a')
a.call('plot')

a.ld_a_lbl('dia_i')
a.inc_r('a')
a.ld_lbl_a('dia_i')
a.ld_r_r('b', 'a')
a.ld_a_lbl('dia_r')
a.cp_r('b')
a.jp('nc', 'dd_loop')
a.ret()

# D=enemy x, E=enemy y, B=blast x, C=blast y, H=radius+1. Carry=hit
a.label('check_blast_hit')
a.ld_r_r('a', 'd')
a.cp_r('b')
a.jp('nc', 'cbh_dx1')
a.ld_r_r('a', 'b')
a.sub_r('d')
a.jp('cbh_dx2')
a.label('cbh_dx1')
a.sub_r('b')
a.label('cbh_dx2')
a.ld_r_r('l', 'a')
a.ld_r_r('a', 'e')
a.cp_r('c')
a.jp('nc', 'cbh_dy1')
a.ld_r_r('a', 'c')
a.sub_r('e')
a.jp('cbh_dy2')
a.label('cbh_dy1')
a.sub_r('c')
a.label('cbh_dy2')
a.add_a_r('l')
a.cp_r('h')
a.ret()

a.label('rand8')
a.ld_a_lbl('rng')
a.ld_r_r('b', 'a')
a.add_a_r('a')
a.add_a_r('a')
a.add_a_r('b')
a.add_a_n(3)
a.ld_lbl_a('rng')
a.ret()

a.label('score_point')
a.ld_a_lbl('score_len')
a.cp_n(63)
a.jp('nc', 'sp_max')
a.add_a_n(2)
a.cp_n(65)
a.jp('c', 'sp_store')
a.ld_r_n('a', 64)
a.label('sp_store')
a.ld_lbl_a('score_len')
a.ret()
a.label('sp_max')
a.ld_r_n('a', 64)
a.ld_lbl_a('score_len')
a.ret()

a.label('exit_to_cpm')
a.ld_r_n('a', 0)
a.out_a(DAZ_NX)
a.ei()
a.emit(0xC3); a.emit16(0x0000)

a.label('init_game')
a.call('clear_fb')
a.ld_r_n('a', 32)
a.ld_lbl_a('cross_x')
a.ld_lbl_a('cross_y')
a.ld_r_n('a', 0xFF)
a.ld_lbl_a('prev_btn')
a.xor_r('a')
a.ld_lbl_a('score_len')
a.ld_lbl_a('enemy_timer')
a.ld_lbl_a('spawn_timer')
a.ld_lbl_a('pause_frames')
a.ld_lbl_a('wave_num')
a.ld_r_n('a', 3)
a.ld_lbl_a('cities_left')
a.ld_r_n('a', 1)
a.ld_lbl_a('city0_alive')
a.ld_lbl_a('city1_alive')
a.ld_lbl_a('city2_alive')
for prefix, count in [('enemy', ENEMY_SLOTS), ('cm', COUNTER_SLOTS), ('ex', EXP_SLOTS)]:
    for i in range(count):
        a.xor_r('a')
        a.ld_lbl_a(f'{prefix}{i}_active')
if True:
    a.call('start_wave1')
    a.call('redraw_static')
    a.call('draw_moving')
    a.ret()

a.label('start_wave1')
a.ld_r_n('a', 1)
a.ld_lbl_a('wave_num')
a.ld_r_n('a', 4)
a.ld_lbl_a('spawn_remaining')
a.ld_r_n('a', 6)
a.ld_lbl_a('enemy_delay')
a.ld_r_n('a', 10)
a.ld_lbl_a('spawn_timer')
a.ld_r_n('a', 10)
a.ld_lbl_a('ammo')
a.ld_r_n('a', 32)
a.ld_lbl_a('pause_frames')
a.xor_r('a')
a.ld_lbl_a('enemy_timer')
a.ret()

a.label('check_game_over')
a.ld_a_lbl('cities_left')
a.or_r('a')
a.ret_cc('nz')
a.call('game_over')
a.jp('restart')

a.label('game_over')
a.call('clear_fb')
# Draw mushroom cloud in red/bright red
# Stem (narrow column, bottom to middle)
hline_imm(30, 58, 4, RED)
hline_imm(30, 57, 4, RED)
hline_imm(30, 56, 4, RED)
hline_imm(30, 55, 4, RED)
hline_imm(30, 54, 4, RED)
hline_imm(30, 53, 4, RED)
hline_imm(30, 52, 4, RED)
hline_imm(30, 51, 4, RED)
hline_imm(29, 50, 6, RED)
hline_imm(29, 49, 6, RED)
hline_imm(29, 48, 6, RED)
# Expanding fireball (widens toward top)
hline_imm(27, 47, 10, RED)
hline_imm(26, 46, 12, RED)
hline_imm(24, 45, 16, BRIGHT_RED)
hline_imm(22, 44, 20, BRIGHT_RED)
hline_imm(20, 43, 24, BRIGHT_RED)
hline_imm(19, 42, 26, BRIGHT_YELLOW)
hline_imm(18, 41, 28, BRIGHT_YELLOW)
hline_imm(17, 40, 30, BRIGHT_RED)
hline_imm(16, 39, 32, BRIGHT_RED)
hline_imm(16, 38, 32, BRIGHT_RED)
# Cap (dome shape)
hline_imm(17, 37, 30, BRIGHT_RED)
hline_imm(18, 36, 28, BRIGHT_RED)
hline_imm(19, 35, 26, BRIGHT_YELLOW)
hline_imm(20, 34, 24, BRIGHT_YELLOW)
hline_imm(22, 33, 20, BRIGHT_RED)
hline_imm(24, 32, 16, BRIGHT_RED)
hline_imm(26, 31, 12, RED)
hline_imm(28, 30, 8, RED)
# Ground ripple
hline_imm(20, 60, 24, RED)
hline_imm(16, 61, 32, BRIGHT_RED)
hline_imm(12, 62, 40, RED)
hline_imm(8, 63, 48, RED)
# Pause for 3 seconds (~180 frames at 60fps)
a.ld_r_n('b', 180)
a.label('go_wait')
a.call('vsync')
a.djnz('go_wait')
a.ret()

a.label('input')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_Y)
a.ld_lbl_a('in_y')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')

# Button 1 exits
a.ld_a_lbl('in_btn')
a.bit(0, 'a')
a.call('z', 'exit_to_cpm')

# X axis
a.ld_a_lbl('in_x')
a.cp_n(128)
a.jp('nc', 'in_left')
a.or_r('a')
a.jp('z', 'in_ycheck')
a.ld_a_lbl('cross_x')
a.cp_n(63)
a.jp('z', 'in_ycheck')
a.inc_r('a')
a.ld_lbl_a('cross_x')
a.jp('in_ycheck')
a.label('in_left')
a.ld_a_lbl('cross_x')
a.or_r('a')
a.jp('z', 'in_ycheck')
a.dec_r('a')
a.ld_lbl_a('cross_x')

a.label('in_ycheck')
a.ld_a_lbl('in_y')
a.cp_n(128)
a.jp('nc', 'in_down')
a.or_r('a')
a.jp('z', 'in_fire')
a.ld_a_lbl('cross_y')
a.or_r('a')
a.jp('z', 'in_fire')
a.dec_r('a')
a.ld_lbl_a('cross_y')
a.jp('in_fire')
a.label('in_down')
a.ld_a_lbl('cross_y')
a.cp_n(63)
a.jp('z', 'in_fire')
a.inc_r('a')
a.ld_lbl_a('cross_y')

a.label('in_fire')
a.ld_a_lbl('in_btn')
a.bit(1, 'a')
a.jp('nz', 'in_not_pressed')
a.ld_a_lbl('prev_btn')
a.bit(1, 'a')
a.call('nz', 'launch_counter')
a.label('in_not_pressed')
a.ld_a_lbl('in_btn')
a.ld_lbl_a('prev_btn')
a.ret()

a.label('launch_counter')
# Check ammo
a.ld_a_lbl('ammo')
a.or_r('a')
a.ret_cc('z')
for i in range(COUNTER_SLOTS):
    nxt = f'lc_next_{i}'
    a.ld_a_lbl(f'cm{i}_active')
    a.or_r('a')
    a.jp('nz', nxt)
    # Decrement ammo
    a.ld_a_lbl('ammo')
    a.dec_r('a')
    a.ld_lbl_a('ammo')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'cm{i}_active')
    a.ld_r_n('a', BASE_X)
    a.ld_lbl_a(f'cm{i}_x')
    a.ld_r_n('a', BASE_Y)
    a.ld_lbl_a(f'cm{i}_y')
    a.ld_a_lbl('cross_x')
    a.ld_lbl_a(f'cm{i}_tx')
    a.ld_a_lbl('cross_y')
    a.ld_lbl_a(f'cm{i}_ty')
    # Guard: if target is at or below base, cancel launch
    a.cp_n(BASE_Y)
    a.jp('nc', f'lc_cancel_{i}')
    # Compute dy = BASE_Y - ty (always positive, target above base)
    a.ld_r_n('a', BASE_Y)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'cm{i}_ty')
    a.ld_r_r('c', 'a')
    a.ld_r_r('a', 'b')
    a.sub_r('c')
    a.jp('z', f'lc_cancel_{i}')  # dy=0, can't fire
    a.ld_lbl_a(f'cm{i}_dy')
    # Compute dx = abs(tx - BASE_X), sx = direction
    a.ld_a_lbl(f'cm{i}_tx')
    a.cp_n(BASE_X)
    a.jp('nc', f'lc_right_{i}')
    # tx < BASE_X: dx = BASE_X - tx, sx = 0 (left)
    a.ld_r_r('b', 'a')
    a.ld_r_n('a', BASE_X)
    a.sub_r('b')
    a.ld_lbl_a(f'cm{i}_dx')
    a.xor_r('a')
    a.ld_lbl_a(f'cm{i}_sx')
    a.jp(f'lc_init_done_{i}')
    a.label(f'lc_right_{i}')
    # tx >= BASE_X: dx = tx - BASE_X, sx = 1 (right)
    a.sub_n(BASE_X)
    a.ld_lbl_a(f'cm{i}_dx')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'cm{i}_sx')
    a.label(f'lc_init_done_{i}')
    # err = 0
    a.xor_r('a')
    a.ld_lbl_a(f'cm{i}_err')
    a.ret()
    a.label(f'lc_cancel_{i}')
    # Cancel: deactivate and refund ammo
    a.xor_r('a')
    a.ld_lbl_a(f'cm{i}_active')
    a.ld_a_lbl('ammo')
    a.inc_r('a')
    a.ld_lbl_a('ammo')
    a.ret()
    a.label(nxt)
a.ret()

a.label('start_explosion')
for i in range(EXP_SLOTS):
    nxt = f'se_next_{i}'
    a.ld_a_lbl(f'ex{i}_active')
    a.or_r('a')
    a.jp('nz', nxt)
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'ex{i}_active')
    a.ld_lbl_a(f'ex{i}_phase')
    a.ld_lbl_a(f'ex{i}_r')
    a.ld_r_r('a', 'd')
    a.ld_lbl_a(f'ex{i}_x')
    a.ld_r_r('a', 'e')
    a.ld_lbl_a(f'ex{i}_y')
    a.ret()
    a.label(nxt)
a.ret()

a.label('move_counters')
for i in range(COUNTER_SLOTS):
    emit_counter_move(i)
a.ret()

a.label('update_explosions')
for i in range(EXP_SLOTS):
    emit_explosion_update(i)
a.ret()

a.label('move_enemies')
a.ld_a_lbl('enemy_delay')
a.ld_r_r('b', 'a')
a.ld_a_lbl('enemy_timer')
a.inc_r('a')
a.ld_lbl_a('enemy_timer')
a.cp_r('b')
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('enemy_timer')
for i in range(ENEMY_SLOTS):
    emit_enemy_move(i)
a.ret()

a.label('check_blasts')
for i in range(ENEMY_SLOTS):
    emit_enemy_blast_checks(i)
a.ret()

a.label('spawn_enemy')
a.ld_a_lbl('pause_frames')
a.or_r('a')
a.jp('z', 'spw_chkrem')
a.dec_r('a')
a.ld_lbl_a('pause_frames')
a.ret()
a.label('spw_chkrem')
a.ld_a_lbl('spawn_remaining')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('spawn_timer')
a.or_r('a')
a.jp('z', 'spw_try')
a.dec_r('a')
a.ld_lbl_a('spawn_timer')
a.ret()
a.label('spw_try')
for i in range(ENEMY_SLOTS):
    nxt = f'spw_nextslot_{i}'
    done = f'spw_done_{i}'
    a.ld_a_lbl(f'enemy{i}_active')
    a.or_r('a')
    a.jp('nz', nxt)
    a.call('rand8')
    a.and_n(63)
    a.ld_lbl_a(f'enemy{i}_x')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'enemy{i}_y')
    a.call('rand8')
    a.and_n(3)
    a.cp_n(0)
    a.jp('z', f'spw_city0_{i}')
    a.cp_n(1)
    a.jp('z', f'spw_city1_{i}')
    a.jp(f'spw_city2_{i}')

    a.label(f'spw_city0_{i}')
    a.ld_a_lbl('city0_alive')
    a.or_r('a')
    a.jp('nz', f'spw_set0_{i}')
    a.jp(f'spw_city1_{i}')
    a.label(f'spw_set0_{i}')
    a.ld_r_n('a', CITY1_X)
    a.ld_lbl_a(f'enemy{i}_tx')
    a.xor_r('a')
    a.ld_lbl_a(f'enemy{i}_city')
    a.jp(f'spw_finish_{i}')

    a.label(f'spw_city1_{i}')
    a.ld_a_lbl('city1_alive')
    a.or_r('a')
    a.jp('nz', f'spw_set1_{i}')
    a.jp(f'spw_city2_{i}')
    a.label(f'spw_set1_{i}')
    a.ld_r_n('a', CITY2_X)
    a.ld_lbl_a(f'enemy{i}_tx')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'enemy{i}_city')
    a.jp(f'spw_finish_{i}')

    a.label(f'spw_city2_{i}')
    a.ld_a_lbl('city2_alive')
    a.or_r('a')
    a.jp('nz', f'spw_set2_{i}')
    a.ld_a_lbl('city0_alive')
    a.or_r('a')
    a.jp('nz', f'spw_set0_{i}')
    a.ld_a_lbl('city1_alive')
    a.or_r('a')
    a.jp('nz', f'spw_set1_{i}')
    a.ret()
    a.label(f'spw_set2_{i}')
    a.ld_r_n('a', CITY3_X)
    a.ld_lbl_a(f'enemy{i}_tx')
    a.ld_r_n('a', 2)
    a.ld_lbl_a(f'enemy{i}_city')

    a.label(f'spw_finish_{i}')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(f'enemy{i}_active')
    a.ld_a_lbl('spawn_remaining')
    a.dec_r('a')
    a.ld_lbl_a('spawn_remaining')
    a.ld_r_n('a', 12)
    a.ld_lbl_a('spawn_timer')
    a.ret()
    a.label(nxt)
a.ret()

a.label('check_wave')
a.ld_a_lbl('pause_frames')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('spawn_remaining')
a.or_r('a')
a.ret_cc('nz')
for i in range(ENEMY_SLOTS):
    a.ld_a_lbl(f'enemy{i}_active')
    a.or_r('a')
    a.ret_cc('nz')
a.call('next_wave')
a.ret()

a.label('next_wave')
a.ld_a_lbl('wave_num')
a.inc_r('a')
a.ld_lbl_a('wave_num')
a.add_a_n(3)
a.cp_n(10)
a.jp('c', 'nw_store_count')
a.ld_r_n('a', 10)
a.label('nw_store_count')
a.ld_lbl_a('spawn_remaining')
a.ld_a_lbl('wave_num')
a.cp_n(3)
a.jp('c', 'nw_d6')
a.cp_n(5)
a.jp('c', 'nw_d5')
a.cp_n(7)
a.jp('c', 'nw_d4')
a.ld_r_n('a', 3)
a.jp('nw_dstore')
a.label('nw_d4')
a.ld_r_n('a', 4)
a.jp('nw_dstore')
a.label('nw_d5')
a.ld_r_n('a', 5)
a.jp('nw_dstore')
a.label('nw_d6')
a.ld_r_n('a', 6)
a.label('nw_dstore')
a.ld_lbl_a('enemy_delay')
a.ld_r_n('a', 16)
a.ld_lbl_a('spawn_timer')
a.ld_r_n('a', 10)
a.ld_lbl_a('ammo')
a.ld_r_n('a', 36)
a.ld_lbl_a('pause_frames')
a.xor_r('a')
a.ld_lbl_a('enemy_timer')
a.ret()

a.label('erase_moving')
a.call('erase_crosshair')
emit_erase_pixel_if_active('enemy', ENEMY_SLOTS)
emit_erase_pixel_if_active('cm', COUNTER_SLOTS)
for i in range(EXP_SLOTS):
    emit_draw_explosion(i, erase=True)
a.ret()

a.label('draw_moving')
emit_draw_pixel_if_active('enemy', ENEMY_SLOTS, BRIGHT_RED)
emit_draw_pixel_if_active('cm', COUNTER_SLOTS, BRIGHT_GREEN)
for i in range(EXP_SLOTS):
    emit_draw_explosion(i, erase=False)
a.call('draw_crosshair')
a.ret()

a.label('draw_crosshair')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ld_a_lbl('cross_x')
a.dec_r('a')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ld_a_lbl('cross_x')
a.inc_r('a')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.dec_r('a')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.inc_r('a')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_WHITE)
a.call('plot')
a.ret()

a.label('erase_crosshair')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ld_a_lbl('cross_x')
a.dec_r('a')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ld_a_lbl('cross_x')
a.inc_r('a')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.dec_r('a')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ld_a_lbl('cross_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('cross_y')
a.inc_r('a')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BLACK)
a.call('plot')
a.ret()

a.label('redraw_static')
a.call('draw_score')
a.call('draw_ground')
a.call('draw_cities')
a.call('draw_base')
a.ret()

a.label('draw_score')
a.ld_a_lbl('score_len')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('b', 'a')
a.ld_r_n('d', 0)
a.ld_r_n('e', 0)
a.ld_r_n('c', BRIGHT_CYAN)
a.call('hline')
a.ret()

a.label('draw_ground')
hline_imm(0, 59, 64, BLUE)
a.ret()

a.label('draw_base')
hline_imm(BASE_X - 1, 61, 3, BRIGHT_GREEN)
hline_imm(BASE_X - 2, 62, 5, GREEN)
hline_imm(BASE_X - 1, 63, 3, BRIGHT_GREEN)
a.ret()

a.label('draw_cities')
a.ld_a_lbl('city0_alive')
a.or_r('a')
a.jp('z', 'dc_city1')
draw_city_block(CITY1_X, BRIGHT_CYAN)
a.label('dc_city1')
a.ld_a_lbl('city1_alive')
a.or_r('a')
a.jp('z', 'dc_city2')
draw_city_block(CITY2_X, BRIGHT_YELLOW)
a.label('dc_city2')
a.ld_a_lbl('city2_alive')
a.or_r('a')
a.jp('z', 'dc_done')
draw_city_block(CITY3_X, BRIGHT_MAGENTA if 'BRIGHT_MAGENTA' in globals() else MAGENTA)
a.label('dc_done')
a.ret()

emit_destroy_city(0)
emit_destroy_city(1)
emit_destroy_city(2)

# ─── Data ──────────────────────────────────────────────────────────────────────
a.label('rng'); a.db(1)
a.label('cross_x'); a.db(32)
a.label('cross_y'); a.db(32)
a.label('in_x'); a.db(0)
a.label('in_y'); a.db(0)
a.label('in_btn'); a.db(0xFF)
a.label('prev_btn'); a.db(0xFF)
a.label('score_len'); a.db(0)
a.label('wave_num'); a.db(1)
a.label('spawn_remaining'); a.db(0)
a.label('spawn_timer'); a.db(0)
a.label('enemy_delay'); a.db(6)
a.label('enemy_timer'); a.db(0)
a.label('pause_frames'); a.db(0)
a.label('cities_left'); a.db(3)
a.label('ammo'); a.db(10)
a.label('city0_alive'); a.db(1)
a.label('city1_alive'); a.db(1)
a.label('city2_alive'); a.db(1)
a.label('dia_cx'); a.db(0)
a.label('dia_cy'); a.db(0)
a.label('dia_r'); a.db(0)
a.label('dia_i'); a.db(0)
a.label('dia_dy'); a.db(0)

for i in range(ENEMY_SLOTS):
    a.label(f'enemy{i}_active'); a.db(0)
    a.label(f'enemy{i}_x'); a.db(0)
    a.label(f'enemy{i}_y'); a.db(0)
    a.label(f'enemy{i}_tx'); a.db(0)
    a.label(f'enemy{i}_city'); a.db(0)

for i in range(COUNTER_SLOTS):
    a.label(f'cm{i}_active'); a.db(0)
    a.label(f'cm{i}_x'); a.db(0)
    a.label(f'cm{i}_y'); a.db(0)
    a.label(f'cm{i}_tx'); a.db(0)
    a.label(f'cm{i}_ty'); a.db(0)
    a.label(f'cm{i}_dx'); a.db(0)
    a.label(f'cm{i}_dy'); a.db(0)
    a.label(f'cm{i}_sx'); a.db(0)
    a.label(f'cm{i}_err'); a.db(0)

for i in range(EXP_SLOTS):
    a.label(f'ex{i}_active'); a.db(0)
    a.label(f'ex{i}_x'); a.db(0)
    a.label(f'ex{i}_y'); a.db(0)
    a.label(f'ex{i}_r'); a.db(0)
    a.label(f'ex{i}_phase'); a.db(0)

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'MISSILE.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'MISSILE.COM')
a.save(out2)
