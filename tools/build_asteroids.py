#!/usr/bin/env python3
"""
ASTEROIDS — An Asteroids-style game for the Cromemco Dazzler + D+7A joystick.
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
DAZ_NX, DAZ_CC = 0x0E, 0x0F
FB_BASE = 0x2000
FB_PAGE = 0x10
FB_SIZE = 2048
JOY_BTN, JOY_X, JOY_Y = 0x18, 0x19, 0x1A

BLACK, RED, GREEN, YELLOW = 0, 1, 2, 3
BLUE, MAGENTA, CYAN, WHITE = 4, 5, 6, 7
BRIGHT = 8
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

DIR_VECS = [
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
]

SHIP_PIXELS = {
    0: [(0, 0), (-1, 1), (1, 1)],
    1: [(0, 0), (-1, 0)],
    2: [(0, 0), (-1, -1), (-1, 1)],
    3: [(0, 0), (0, -1)],
    4: [(0, 0), (-1, -1), (1, -1)],
    5: [(0, 0), (1, 0)],
    6: [(0, 0), (1, -1), (1, 1)],
    7: [(0, 0), (0, 1)],
}

FLAME_PIXELS = {
    0: [(0, 2)],
    1: [(-1, 1)],
    2: [(-2, 0)],
    3: [(-1, -1)],
    4: [(0, -2)],
    5: [(1, -1)],
    6: [(2, 0)],
    7: [(1, 1)],
}

AST_STARTS = [
    (8, 8, 1, 1),
    (55, 10, -1, 1),
    (10, 52, 1, -1),
    (54, 54, -1, -1),
    (24, 12, 1, 1),
    (40, 20, -1, 1),
    (18, 36, 1, -1),
    (46, 44, -1, -1),
    (30, 8, 1, 1),
    (52, 30, -1, 1),
    (12, 26, 1, -1),
    (34, 50, -1, -1),
]

AST_LARGE = [(0, -2), (-1, -1), (1, -1), (-2, 0), (2, 0), (-1, 1), (1, 1), (0, 2)]
AST_MED = [(0, -1), (-1, 0), (1, 0), (0, 1)]
EXPLOSION_POINTS = [
    (0, 0, BRIGHT_YELLOW),
    (1, 0, RED),
]

BULLET_SLOTS = 3
AST_SLOTS = 12

a = Z80()


def s8(v):
    return v & 0xFF


def set_a(val):
    a.ld_r_n('a', val & 0xFF)


def store_imm(lbl, val):
    set_a(val)
    a.ld_lbl_a(lbl)


def copy_lbl(src, dst):
    a.ld_a_lbl(src)
    a.ld_lbl_a(dst)


def emit_plot_rel(base_x_lbl, base_y_lbl, dx, dy, color):
    a.ld_a_lbl(base_x_lbl)
    if dx:
        a.add_a_n(s8(dx))
    a.and_n(0x3F)
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(base_y_lbl)
    if dy:
        a.add_a_n(s8(dy))
    a.and_n(0x3F)
    a.ld_r_r('e', 'a')
    a.ld_r_n('c', color)
    a.call('plot')


def emit_dir_branch(branch_label, dir_lbl, per_dir):
    a.label(branch_label)
    a.ld_a_lbl(dir_lbl)
    for idx in range(8):
        nxt = f'{branch_label}_next_{idx}'
        a.cp_n(idx)
        a.jp('nz', nxt)
        per_dir(idx)
        a.ret()
        a.label(nxt)
    a.ret()


def emit_var_inc_vel(lbl):
    a.ld_a_lbl(lbl)
    a.call('inc_vel')
    a.ld_lbl_a(lbl)


def emit_var_dec_vel(lbl):
    a.ld_a_lbl(lbl)
    a.call('dec_vel')
    a.ld_lbl_a(lbl)


def emit_var_friction(lbl):
    a.ld_a_lbl(lbl)
    a.call('friction_vel')
    a.ld_lbl_a(lbl)


def emit_plot_var(x_lbl, y_lbl, color):
    a.ld_a_lbl(x_lbl)
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(y_lbl)
    a.ld_r_r('e', 'a')
    a.ld_r_n('c', color)
    a.call('plot')


def asteroid_prefix(i):
    return f'ast{i}'


def bullet_prefix(i):
    return f'bul{i}'


# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)
a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)
a.call('clear_fb')
a.call('init_game')

a.label('main_loop')
a.call('vsync')
a.call('clear_fb')
a.call('update_frame')
a.call('handle_input')
a.call('update_ship')
a.call('move_bullets')
a.call('move_asteroids')
a.call('handle_collisions')
a.call('post_collision')
a.call('draw_scene')
a.jp('main_loop')

# ─── Game init / frame state ───────────────────────────────────────────────────
a.label('init_game')
store_imm('lives', 3)
store_imm('score', 0)
store_imm('wave_count', 4)
store_imm('frame', 0)
store_imm('frame3', 0)
store_imm('invuln', 0)
store_imm('explosion_timer', 0)
store_imm('thrust_flag', 0)
store_imm('active_count', 0)
for i in range(BULLET_SLOTS):
    store_imm(f'bul{i}_active', 0)
for i in range(AST_SLOTS):
    store_imm(f'ast{i}_active', 0)
a.call('respawn_ship')
a.call('spawn_wave')
a.ret()

a.label('respawn_ship')
store_imm('ship_x', 32)
store_imm('ship_y', 32)
store_imm('ship_dir', 0)
store_imm('ship_vx', 0)
store_imm('ship_vy', 0)
store_imm('invuln', 60)
store_imm('explosion_timer', 0)
store_imm('thrust_flag', 0)
copy_lbl('ship_x', 'exp_x')
copy_lbl('ship_y', 'exp_y')
a.ret()

a.label('update_frame')
a.ld_a_lbl('frame')
a.inc_r('a')
a.ld_lbl_a('frame')
a.ld_a_lbl('frame3')
a.inc_r('a')
a.cp_n(3)
a.jp('c', 'uf_store')
a.xor_r('a')
a.label('uf_store')
a.ld_lbl_a('frame3')
a.xor_r('a')
a.ld_lbl_a('thrust_flag')
a.ret()

# ─── Input ──────────────────────────────────────────────────────────────────────
a.label('handle_input')
a.in_a(JOY_BTN)
a.ld_lbl_a('btn_state')
a.bit(0, 'a')
a.jp('z', 'exit_to_cpm')
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('nz', 'hi_done')
a.in_a(JOY_X)
a.or_r('a')
a.jp('z', 'hi_y')
a.cp_n(128)
a.jp('c', 'rot_right')
a.ld_a_lbl('ship_dir')
a.dec_r('a')
a.and_n(7)
a.ld_lbl_a('ship_dir')
a.jp('hi_y')
a.label('rot_right')
a.ld_a_lbl('ship_dir')
a.inc_r('a')
a.and_n(7)
a.ld_lbl_a('ship_dir')
a.label('hi_y')
a.in_a(JOY_Y)
a.or_r('a')
a.jp('z', 'hi_fire')
a.cp_n(128)
a.jp('nc', 'hi_fire')
store_imm('thrust_flag', 1)
a.call('apply_thrust')
a.label('hi_fire')
a.ld_a_lbl('btn_state')
a.bit(1, 'a')
a.jp('nz', 'hi_done')
a.call('fire_bullet')
a.label('hi_done')
a.ret()

# ─── Ship physics ───────────────────────────────────────────────────────────────
emit_dir_branch('apply_thrust', 'ship_dir', lambda idx: (
    emit_var_inc_vel('ship_vx') if DIR_VECS[idx][0] > 0 else emit_var_dec_vel('ship_vx') if DIR_VECS[idx][0] < 0 else None,
    emit_var_inc_vel('ship_vy') if DIR_VECS[idx][1] > 0 else emit_var_dec_vel('ship_vy') if DIR_VECS[idx][1] < 0 else None,
))

a.label('update_ship')
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('ship_vx')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_x')
a.call('add_a_b_wrap')
a.ld_lbl_a('ship_x')
a.ld_a_lbl('ship_vy')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_y')
a.call('add_a_b_wrap')
a.ld_lbl_a('ship_y')
a.ld_a_lbl('frame')
a.and_n(0x0F)
a.jp('nz', 'us_done')
emit_var_friction('ship_vx')
emit_var_friction('ship_vy')
a.label('us_done')
a.ret()

a.label('add_a_b_wrap')
a.add_a_r('b')
a.and_n(0x3F)
a.ret()

a.label('inc_vel')
a.cp_n(3)
a.ret_cc('z')
a.inc_r('a')
a.ret()

a.label('dec_vel')
a.cp_n(0xFD)
a.ret_cc('z')
a.dec_r('a')
a.ret()

a.label('friction_vel')
a.or_r('a')
a.ret_cc('z')
a.cp_n(0x80)
a.jp('c', 'fv_pos')
a.inc_r('a')
a.ret()
a.label('fv_pos')
a.dec_r('a')
a.ret()

# ─── Bullet handling ────────────────────────────────────────────────────────────
emit_dir_branch('set_tmp_dir_from_ship', 'ship_dir', lambda idx: (
    store_imm('tmp_dx', DIR_VECS[idx][0]),
    store_imm('tmp_dy', DIR_VECS[idx][1]),
))

a.label('fire_bullet')
a.call('set_tmp_dir_from_ship')
for i in range(BULLET_SLOTS):
    nxt = f'fire_bullet_next_{i}'
    a.ld_a_lbl(f'bul{i}_active')
    a.or_r('a')
    a.jp('nz', nxt)
    store_imm(f'bul{i}_active', 1)
    copy_lbl('ship_x', f'bul{i}_x')
    copy_lbl('ship_y', f'bul{i}_y')
    copy_lbl('tmp_dx', f'bul{i}_dx')
    copy_lbl('tmp_dy', f'bul{i}_dy')
    store_imm(f'bul{i}_life', 20)
    a.ret()
    a.label(nxt)
a.ret()

a.label('move_bullets')
for i in range(BULLET_SLOTS):
    p = bullet_prefix(i)
    skip = f'mb_skip_{i}'
    dead = f'mb_dead_{i}'
    a.ld_a_lbl(f'{p}_active')
    a.or_r('a')
    a.jp('z', skip)
    a.ld_a_lbl(f'{p}_life')
    a.dec_r('a')
    a.ld_lbl_a(f'{p}_life')
    a.jp('z', dead)
    for _ in range(2):
        a.ld_a_lbl(f'{p}_dx')
        a.ld_r_r('b', 'a')
        a.ld_a_lbl(f'{p}_x')
        a.call('add_a_b_wrap')
        a.ld_lbl_a(f'{p}_x')
        a.ld_a_lbl(f'{p}_dy')
        a.ld_r_r('b', 'a')
        a.ld_a_lbl(f'{p}_y')
        a.call('add_a_b_wrap')
        a.ld_lbl_a(f'{p}_y')
    a.jp(skip)
    a.label(dead)
    store_imm(f'{p}_active', 0)
    a.label(skip)
a.ret()

# ─── Asteroid handling ──────────────────────────────────────────────────────────
a.label('spawn_child_from_temp')
for i in range(AST_SLOTS):
    nxt = f'spawn_child_next_{i}'
    a.ld_a_lbl(f'ast{i}_active')
    a.or_r('a')
    a.jp('nz', nxt)
    store_imm(f'ast{i}_active', 1)
    copy_lbl('tmp_x', f'ast{i}_x')
    copy_lbl('tmp_y', f'ast{i}_y')
    copy_lbl('tmp_dx', f'ast{i}_dx')
    copy_lbl('tmp_dy', f'ast{i}_dy')
    copy_lbl('tmp_size', f'ast{i}_size')
    a.ret()
    a.label(nxt)
a.ret()

a.label('spawn_wave')
for i in range(BULLET_SLOTS):
    store_imm(f'bul{i}_active', 0)
for i, (x, y, dx, dy) in enumerate(AST_STARTS):
    skip = f'sw_skip_{i}'
    a.ld_a_lbl('wave_count')
    a.cp_n(i + 1)
    a.jp('c', skip)
    store_imm(f'ast{i}_active', 1)
    store_imm(f'ast{i}_x', x)
    store_imm(f'ast{i}_y', y)
    store_imm(f'ast{i}_dx', dx)
    store_imm(f'ast{i}_dy', dy)
    store_imm(f'ast{i}_size', 2)
    a.jp(f'sw_done_{i}')
    a.label(skip)
    store_imm(f'ast{i}_active', 0)
    a.label(f'sw_done_{i}')
a.ret()

for i in range(AST_SLOTS):
    p = asteroid_prefix(i)
    a.label(f'destroy_{p}')
    a.ld_a_lbl('score')
    a.inc_r('a')
    a.ld_lbl_a('score')
    a.ld_a_lbl(f'{p}_size')
    a.or_r('a')
    a.jp('z', f'destroy_{p}_small')
    a.dec_r('a')
    a.ld_lbl_a('tmp_size')
    copy_lbl(f'{p}_x', 'tmp_x')
    copy_lbl(f'{p}_y', 'tmp_y')
    copy_lbl(f'{p}_dx', 'tmp_dx')
    copy_lbl(f'{p}_dy', 'tmp_dy')
    copy_lbl('tmp_size', f'{p}_size')
    a.ld_a_lbl(f'{p}_dy')
    a.neg()
    a.ld_lbl_a(f'{p}_dy')
    a.ld_a_lbl('tmp_dx')
    a.neg()
    a.ld_lbl_a('tmp_dx')
    a.call('spawn_child_from_temp')
    a.ret()
    a.label(f'destroy_{p}_small')
    store_imm(f'{p}_active', 0)
    a.ret()

a.label('move_asteroids')
for i in range(AST_SLOTS):
    p = asteroid_prefix(i)
    skip = f'ma_skip_{i}'
    do_move = f'ma_do_{i}'
    a.ld_a_lbl(f'{p}_active')
    a.or_r('a')
    a.jp('z', skip)
    a.ld_a_lbl(f'{p}_size')
    a.or_r('a')
    a.jp('z', f'ma_small_{i}')
    a.cp_n(1)
    a.jp('z', f'ma_med_{i}')
    a.ld_a_lbl('frame')
    a.and_n(3)
    a.jp('z', do_move)
    a.jp(skip)
    a.label(f'ma_med_{i}')
    a.ld_a_lbl('frame3')
    a.or_r('a')
    a.jp('z', do_move)
    a.jp(skip)
    a.label(f'ma_small_{i}')
    a.ld_a_lbl('frame')
    a.and_n(1)
    a.jp('z', do_move)
    a.jp(skip)
    a.label(do_move)
    a.ld_a_lbl(f'{p}_dx')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'{p}_x')
    a.call('add_a_b_wrap')
    a.ld_lbl_a(f'{p}_x')
    a.ld_a_lbl(f'{p}_dy')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(f'{p}_y')
    a.call('add_a_b_wrap')
    a.ld_lbl_a(f'{p}_y')
    a.label(skip)
a.ret()

# ─── Collision handling ─────────────────────────────────────────────────────────
a.label('pair_hit_test')
copy_lbl('pair_x1', 'tmp_a')
a.ld_a_lbl('pair_x2')
a.ld_r_r('b', 'a')
a.ld_a_lbl('tmp_a')
a.sub_r('b')
a.cp_n(3)
a.jp('c', 'pht_x_ok')
a.cp_n(254)
a.jp('nc', 'pht_x_ok')
a.xor_r('a')
a.ret()
a.label('pht_x_ok')
copy_lbl('pair_y1', 'tmp_a')
a.ld_a_lbl('pair_y2')
a.ld_r_r('b', 'a')
a.ld_a_lbl('tmp_a')
a.sub_r('b')
a.cp_n(3)
a.jp('c', 'pht_yes')
a.cp_n(254)
a.jp('nc', 'pht_yes')
a.xor_r('a')
a.ret()
a.label('pht_yes')
store_imm('tmp_a', 1)
a.ld_a_lbl('tmp_a')
a.ret()

a.label('trigger_ship_hit')
copy_lbl('ship_x', 'exp_x')
copy_lbl('ship_y', 'exp_y')
a.ld_a_lbl('lives')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('lives')
store_imm('explosion_timer', 12)
store_imm('thrust_flag', 0)
store_imm('invuln', 0)
a.ret()

a.label('handle_collisions')
for bi in range(BULLET_SLOTS):
    bp = bullet_prefix(bi)
    bullet_done = f'hc_bullet_done_{bi}'
    bullet_next = f'hc_bullet_next_{bi}'
    a.ld_a_lbl(f'{bp}_active')
    a.or_r('a')
    a.jp('z', bullet_done)
    for ai in range(AST_SLOTS):
        ap = asteroid_prefix(ai)
        pair_next = f'hc_pair_next_{bi}_{ai}'
        a.ld_a_lbl(f'{ap}_active')
        a.or_r('a')
        a.jp('z', pair_next)
        copy_lbl(f'{bp}_x', 'pair_x1')
        copy_lbl(f'{bp}_y', 'pair_y1')
        copy_lbl(f'{ap}_x', 'pair_x2')
        copy_lbl(f'{ap}_y', 'pair_y2')
        a.call('pair_hit_test')
        a.or_r('a')
        a.jp('z', pair_next)
        store_imm(f'{bp}_active', 0)
        a.call(f'destroy_{ap}')
        a.jp(bullet_next)
        a.label(pair_next)
    a.label(bullet_next)
    a.label(bullet_done)
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('invuln')
a.or_r('a')
a.ret_cc('nz')
for ai in range(AST_SLOTS):
    ap = asteroid_prefix(ai)
    ship_next = f'hc_ship_next_{ai}'
    a.ld_a_lbl(f'{ap}_active')
    a.or_r('a')
    a.jp('z', ship_next)
    copy_lbl('ship_x', 'pair_x1')
    copy_lbl('ship_y', 'pair_y1')
    copy_lbl(f'{ap}_x', 'pair_x2')
    copy_lbl(f'{ap}_y', 'pair_y2')
    a.call('pair_hit_test')
    a.or_r('a')
    a.jp('z', ship_next)
    a.call('trigger_ship_hit')
    a.ret()
    a.label(ship_next)
a.ret()

# ─── Post-step management ───────────────────────────────────────────────────────
a.label('count_asteroids')
a.xor_r('a')
a.ld_r_r('b', 'a')
for i in range(AST_SLOTS):
    skip = f'ca_skip_{i}'
    a.ld_a_lbl(f'ast{i}_active')
    a.or_r('a')
    a.jp('z', skip)
    a.inc_r('b')
    a.label(skip)
a.ld_r_r('a', 'b')
a.ld_lbl_a('active_count')
a.ret()

a.label('post_collision')
a.call('count_asteroids')
a.ld_a_lbl('active_count')
a.or_r('a')
a.jp('nz', 'pc_no_wave')
a.ld_a_lbl('wave_count')
a.cp_n(AST_SLOTS)
a.jp('nc', 'pc_wave_same')
a.inc_r('a')
a.ld_lbl_a('wave_count')
a.label('pc_wave_same')
a.call('spawn_wave')
a.label('pc_no_wave')
a.ld_a_lbl('invuln')
a.or_r('a')
a.jp('z', 'pc_no_inv')
a.dec_r('a')
a.ld_lbl_a('invuln')
a.label('pc_no_inv')
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('z', 'pc_done')
a.dec_r('a')
a.ld_lbl_a('explosion_timer')
a.jp('nz', 'pc_done')
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'exit_to_cpm')
a.call('respawn_ship')
a.label('pc_done')
a.ret()

# ─── Drawing ────────────────────────────────────────────────────────────────────
a.label('draw_tmp_asteroid')
a.ld_a_lbl('tmp_size')
a.or_r('a')
a.jp('z', 'dta_small')
a.cp_n(1)
a.jp('z', 'dta_med')
for dx, dy in AST_LARGE:
    emit_plot_rel('tmp_x', 'tmp_y', dx, dy, WHITE)
a.ret()
a.label('dta_med')
for dx, dy in AST_MED:
    emit_plot_rel('tmp_x', 'tmp_y', dx, dy, WHITE)
a.ret()
a.label('dta_small')
emit_plot_rel('tmp_x', 'tmp_y', 0, 0, WHITE)
a.ret()

a.label('draw_explosion')
for dx, dy, color in EXPLOSION_POINTS:
    emit_plot_rel('exp_x', 'exp_y', dx, dy, color)
a.ret()

a.label('draw_scene')
for i in range(BULLET_SLOTS):
    skip = f'draw_bul_skip_{i}'
    a.ld_a_lbl(f'bul{i}_active')
    a.or_r('a')
    a.jp('z', skip)
    emit_plot_var(f'bul{i}_x', f'bul{i}_y', BRIGHT_WHITE)
    a.label(skip)
for i in range(AST_SLOTS):
    p = asteroid_prefix(i)
    skip = f'draw_ast_skip_{i}'
    a.ld_a_lbl(f'{p}_active')
    a.or_r('a')
    a.jp('z', skip)
    copy_lbl(f'{p}_x', 'tmp_x')
    copy_lbl(f'{p}_y', 'tmp_y')
    copy_lbl(f'{p}_size', 'tmp_size')
    a.call('draw_tmp_asteroid')
    a.label(skip)
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('z', 'draw_ship_check')
a.call('draw_explosion')
a.ret()
a.label('draw_ship_check')
a.ld_a_lbl('invuln')
a.or_r('a')
a.jp('z', 'draw_ship_now')
a.ld_a_lbl('frame')
a.and_n(0x04)
a.jp('nz', 'draw_ship_done')
a.label('draw_ship_now')
a.ld_a_lbl('ship_dir')
for idx in range(8):
    nxt = f'draw_ship_next_{idx}'
    a.cp_n(idx)
    a.jp('nz', nxt)
    for dx, dy in SHIP_PIXELS[idx]:
        emit_plot_rel('ship_x', 'ship_y', dx, dy, BRIGHT_WHITE)
    a.ld_a_lbl('thrust_flag')
    a.or_r('a')
    a.jp('z', 'draw_ship_done')
    for dx, dy in FLAME_PIXELS[idx]:
        emit_plot_rel('ship_x', 'ship_y', dx, dy, BRIGHT_YELLOW)
    a.jp('draw_ship_done')
    a.label(nxt)
a.label('draw_ship_done')
a.ret()

# ─── Exit / hardware ────────────────────────────────────────────────────────────
a.label('exit_to_cpm')
a.emit(0xC3, 0x00, 0x00)

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

# ─── Data ───────────────────────────────────────────────────────────────────────
a.label('ship_x'); a.db(32)
a.label('ship_y'); a.db(32)
a.label('ship_dir'); a.db(0)
a.label('ship_vx'); a.db(0)
a.label('ship_vy'); a.db(0)
a.label('invuln'); a.db(0)
a.label('thrust_flag'); a.db(0)
a.label('explosion_timer'); a.db(0)
a.label('exp_x'); a.db(32)
a.label('exp_y'); a.db(32)
a.label('frame'); a.db(0)
a.label('frame3'); a.db(0)
a.label('btn_state'); a.db(0xFF)
a.label('lives'); a.db(3)
a.label('score'); a.db(0)
a.label('wave_count'); a.db(4)
a.label('active_count'); a.db(0)
a.label('pair_x1'); a.db(0)
a.label('pair_y1'); a.db(0)
a.label('pair_x2'); a.db(0)
a.label('pair_y2'); a.db(0)
a.label('tmp_x'); a.db(0)
a.label('tmp_y'); a.db(0)
a.label('tmp_dx'); a.db(0)
a.label('tmp_dy'); a.db(0)
a.label('tmp_size'); a.db(0)
a.label('tmp_diff'); a.db(0)
a.label('tmp_a'); a.db(0)

for i in range(BULLET_SLOTS):
    a.label(f'bul{i}_active'); a.db(0)
    a.label(f'bul{i}_x'); a.db(0)
    a.label(f'bul{i}_y'); a.db(0)
    a.label(f'bul{i}_dx'); a.db(0)
    a.label(f'bul{i}_dy'); a.db(0)
    a.label(f'bul{i}_life'); a.db(0)

for i in range(AST_SLOTS):
    a.label(f'ast{i}_active'); a.db(0)
    a.label(f'ast{i}_x'); a.db(0)
    a.label(f'ast{i}_y'); a.db(0)
    a.label(f'ast{i}_dx'); a.db(0)
    a.label(f'ast{i}_dy'); a.db(0)
    a.label(f'ast{i}_size'); a.db(0)

a.resolve()
if len(a.code) > 8192:
    raise SystemExit(f'Program too large: {len(a.code)} bytes')

out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'ASTEROIDS.COM')
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'ASTEROIDS.COM')
os.makedirs(os.path.dirname(out), exist_ok=True)
os.makedirs(os.path.dirname(out2), exist_ok=True)
a.save(out)
a.save(out2)
