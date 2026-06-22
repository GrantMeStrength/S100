#!/usr/bin/env python3
"""
FROGGER — A lane-crossing game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis
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
BRIGHT_RED = RED | BRIGHT
BRIGHT_GREEN = GREEN | BRIGHT
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_BLUE = BLUE | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

FROG_START_X = 30
FROG_START_Y = 60
FROG_COLOR = BRIGHT_GREEN
TIMER_RESET = 60
TIMER_TICK_RESET = 6
DIR_RIGHT, DIR_LEFT, DIR_UP, DIR_DOWN = 1, 2, 3, 4
HOME_XS = [6, 22, 38, 54]
HOME_W = 4

LANES = [
    dict(idx=1, y=56, kind='road',  bg=BLACK, color=RED,         width=4, speed=6, direction='right', xs=[4, 26, 48]),
    dict(idx=2, y=52, kind='road',  bg=BLACK, color=YELLOW,      width=3, speed=4, direction='left',  xs=[10, 30, 50]),
    dict(idx=3, y=48, kind='road',  bg=BLACK, color=MAGENTA,     width=6, speed=6, direction='right', xs=[2, 24, 46]),
    dict(idx=4, y=44, kind='road',  bg=BLACK, color=BRIGHT_RED,  width=3, speed=2, direction='left',  xs=[14, 34, 54]),
    dict(idx=5, y=36, kind='river', bg=BLUE,  color=YELLOW,      width=6, speed=5, direction='right', xs=[0, 22, 44]),
    dict(idx=6, y=32, kind='river', bg=BLUE,  color=YELLOW,      width=4, speed=4, direction='left',  xs=[12, 32, 52]),
    dict(idx=7, y=28, kind='river', bg=BLUE,  color=YELLOW,      width=5, speed=5, direction='right', xs=[6, 28, 50]),
    dict(idx=8, y=24, kind='river', bg=BLUE,  color=GREEN,       width=7, speed=3, direction='left',  xs=[8, 30, 52]),
]

ROAD_LANES = [lane for lane in LANES if lane['kind'] == 'road']
RIVER_LANES = [lane for lane in LANES if lane['kind'] == 'river']

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


def rect_imm(x, y, w, h, color):
    for row in range(h):
        hline_imm(x, y + row, w, color)


def fill_rows(y0, y1, color):
    for y in range(y0, y1 + 1):
        hline_imm(0, y, 64, color)


def emit_store_a(label):
    a.ld_lbl_a(label)


def emit_load_reg_from_label(reg, label):
    a.ld_a_lbl(label)
    a.ld_r_r(reg, 'a')


def emit_obstacle_overlap(obs_label, width, hit_label, prefix):
    nowrap = f'{prefix}_nowrap'
    wrap = f'{prefix}_wrap'
    cont = f'{prefix}_cont'
    left_hit = f'{prefix}_left_hit'

    a.ld_a_lbl(obs_label)
    a.cp_n(65 - width)
    a.jp('c', nowrap)

    a.label(wrap)
    a.ld_a_lbl('frog_x')
    a.cp_n(width)
    a.jp('c', left_hit)
    a.inc_r('a')
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(obs_label)
    a.cp_r('b')
    a.jp('c', hit_label)
    a.jp('z', hit_label)
    a.jp(cont)

    a.label(left_hit)
    a.jp(hit_label)

    a.label(nowrap)
    a.ld_a_lbl('frog_x')
    a.add_a_n(2)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(obs_label)
    a.cp_r('b')
    a.jp('nc', cont)

    a.ld_a_lbl(obs_label)
    a.add_a_n(width)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl('frog_x')
    a.cp_r('b')
    a.jp('nc', cont)
    a.jp(hit_label)

    a.label(cont)


def emit_draw_wrapped_obstacle(obs_label, lane, prefix):
    width = lane['width']
    y = lane['y']
    color = lane['color']
    nowrap = f'{prefix}_nowrap'
    done = f'{prefix}_done'

    a.ld_a_lbl(obs_label)
    a.cp_n(65 - width)
    a.jp('c', nowrap)

    emit_load_reg_from_label('d', obs_label)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.ld_r_n('a', 64)
    a.sub_r('d')
    a.ld_r_r('b', 'a')
    a.call('rect4')

    a.ld_r_n('d', 0)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.ld_a_lbl(obs_label)
    a.add_a_n((width - 64) & 0xFF)
    a.ld_r_r('b', 'a')
    a.call('rect4')
    a.jp(done)

    a.label(nowrap)
    emit_load_reg_from_label('d', obs_label)
    a.ld_r_n('e', y)
    a.ld_r_n('b', width)
    a.ld_r_n('c', color)
    a.call('rect4')

    a.label(done)


def lane_speed_label(idx):
    return f'lane{idx}_speed'


def lane_counter_label(idx):
    return f'lane{idx}_counter'


def lane_move_label(idx):
    return f'lane{idx}_move'


def lane_x_label(idx, obj_idx):
    return f'lane{idx}_x{obj_idx}'


def home_label(idx):
    return f'home_{idx}'

# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)

a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)

a.call('init_game')

# ─── Main loop ─────────────────────────────────────────────────────────────────
a.label('main_loop')
a.call('vsync')
a.call('update_timer')
a.call('erase_frog')
a.call('move_lanes')
a.call('read_input')
a.call('move_frog')
a.call('check_collisions')
a.call('draw_ui')
a.call('draw_lanes')
a.call('draw_frog')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('init_game')
a.call('clear_fb')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.ld_r_n('a', 1)
a.ld_lbl_a('level')
a.xor_r('a')
a.ld_lbl_a('homes_filled')
a.ld_lbl_a('joy_prev')
a.ld_lbl_a('hop_cooldown')
a.call('init_lane_speeds')
a.call('clear_homes')
a.call('reset_round')
a.ret()

a.label('init_lane_speeds')
for lane in LANES:
    a.ld_r_n('a', lane['speed'])
    a.ld_lbl_a(lane_speed_label(lane['idx']))
a.ret()

a.label('clear_homes')
a.xor_r('a')
for idx in range(4):
    a.ld_lbl_a(home_label(idx))
a.ld_lbl_a('homes_filled')
a.ret()

a.label('reset_lane_positions')
for lane in LANES:
    a.xor_r('a')
    a.ld_lbl_a(lane_counter_label(lane['idx']))
    a.ld_lbl_a(lane_move_label(lane['idx']))
    for obj_idx, xpos in enumerate(lane['xs']):
        a.ld_r_n('a', xpos)
        a.ld_lbl_a(lane_x_label(lane['idx'], obj_idx))
a.ret()

a.label('reset_round')
a.ld_r_n('a', TIMER_RESET)
a.ld_lbl_a('timer_value')
a.ld_r_n('a', TIMER_TICK_RESET)
a.ld_lbl_a('timer_tick')
a.ld_r_n('a', FROG_START_X)
a.ld_lbl_a('frog_x')
a.ld_lbl_a('frog_prev_x')
a.ld_r_n('a', FROG_START_Y)
a.ld_lbl_a('frog_y')
a.ld_lbl_a('frog_prev_y')
a.xor_r('a')
a.ld_lbl_a('joy_prev')
a.ld_lbl_a('hop_cooldown')
a.call('draw_static_background')
a.call('reset_lane_positions')
a.call('draw_ui')
a.call('draw_lanes')
a.call('draw_frog')
a.ret()

a.label('draw_static_background')
fill_rows(0, 19, BLACK)
fill_rows(20, 23, BLACK)
fill_rows(24, 39, BLUE)
fill_rows(40, 43, GREEN)
fill_rows(44, 59, BLACK)
fill_rows(60, 63, GREEN)
a.call('draw_homes')
a.ret()

a.label('update_timer')
a.ld_a_lbl('timer_tick')
a.dec_r('a')
a.ld_lbl_a('timer_tick')
a.or_r('a')
a.ret_cc('nz')
a.ld_r_n('a', TIMER_TICK_RESET)
a.ld_lbl_a('timer_tick')
a.ld_a_lbl('timer_value')
a.or_r('a')
a.jp('z', 'lose_life')
a.dec_r('a')
a.ld_lbl_a('timer_value')
a.ret_cc('nz')
a.jp('lose_life')

a.label('read_input')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')
a.bit(0, 'a')
a.call('z', 'exit_to_cpm')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_Y)
a.ld_lbl_a('in_y')
a.ret()

a.label('move_lanes')
for lane in LANES:
    idx = lane['idx']
    moved = lane_move_label(idx)
    counter = lane_counter_label(idx)
    speed = lane_speed_label(idx)
    done = f'lane{idx}_move_done'
    moved_now = f'lane{idx}_do_move'

    a.xor_r('a')
    a.ld_lbl_a(moved)
    a.ld_a_lbl(counter)
    a.inc_r('a')
    a.ld_lbl_a(counter)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(speed)
    a.cp_r('b')
    a.jp('z', moved_now)
    a.jp(done)

    a.label(moved_now)
    a.xor_r('a')
    a.ld_lbl_a(counter)
    a.ld_r_n('a', 1 if lane['direction'] == 'right' else 0xFF)
    a.ld_lbl_a(moved)

    for obj_idx in range(3):
        lbl = lane_x_label(idx, obj_idx)
        if lane['direction'] == 'right':
            a.ld_a_lbl(lbl)
            a.inc_r('a')
            a.cp_n(64)
            store = f'lane{idx}_obj{obj_idx}_store'
            wrap = f'lane{idx}_obj{obj_idx}_wrap'
            a.jp('z', wrap)
            a.label(store)
            a.ld_lbl_a(lbl)
            cont = f'lane{idx}_obj{obj_idx}_cont'
            a.jp(cont)
            a.label(wrap)
            a.xor_r('a')
            a.ld_lbl_a(lbl)
            a.label(cont)
        else:
            not_zero = f'lane{idx}_obj{obj_idx}_not_zero'
            done_obj = f'lane{idx}_obj{obj_idx}_done'
            a.ld_a_lbl(lbl)
            a.or_r('a')
            a.jp('nz', not_zero)
            a.ld_r_n('a', 63)
            a.ld_lbl_a(lbl)
            a.jp(done_obj)
            a.label(not_zero)
            a.dec_r('a')
            a.ld_lbl_a(lbl)
            a.label(done_obj)

    a.label(done)
a.ret()

a.label('move_frog')
a.call('ride_frog')
a.ld_a_lbl('hop_cooldown')
a.or_r('a')
a.jp('z', 'mf_cd_done')
a.dec_r('a')
a.ld_lbl_a('hop_cooldown')
a.label('mf_cd_done')

a.xor_r('a')
a.ld_lbl_a('joy_dir')
a.ld_a_lbl('in_x')
a.cp_n(128)
a.jp('nc', 'mf_left')
a.or_r('a')
a.jp('nz', 'mf_right')
a.ld_a_lbl('in_y')
a.cp_n(128)
a.jp('nc', 'mf_down')
a.or_r('a')
a.jp('nz', 'mf_up')
a.xor_r('a')
a.ld_lbl_a('joy_prev')
a.ret()

a.label('mf_left')
a.ld_r_n('a', DIR_LEFT)
a.ld_lbl_a('joy_dir')
a.jp('mf_try_hop')

a.label('mf_right')
a.ld_r_n('a', DIR_RIGHT)
a.ld_lbl_a('joy_dir')
a.jp('mf_try_hop')

a.label('mf_up')
a.ld_r_n('a', DIR_UP)
a.ld_lbl_a('joy_dir')
a.jp('mf_try_hop')

a.label('mf_down')
a.ld_r_n('a', DIR_DOWN)
a.ld_lbl_a('joy_dir')

a.label('mf_try_hop')
a.ld_a_lbl('joy_prev')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('hop_cooldown')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('joy_dir')
a.ld_lbl_a('joy_prev')
a.ld_r_n('a', 8)
a.ld_lbl_a('hop_cooldown')
a.ld_a_lbl('joy_dir')
a.cp_n(DIR_LEFT)
a.jp('z', 'mf_hop_left')
a.cp_n(DIR_RIGHT)
a.jp('z', 'mf_hop_right')
a.cp_n(DIR_UP)
a.jp('z', 'mf_hop_up')
a.jp('mf_hop_down')

a.label('mf_hop_left')
a.ld_a_lbl('frog_x')
a.cp_n(4)
a.ret_cc('c')
a.sub_n(4)
a.ld_lbl_a('frog_x')
a.ret()

a.label('mf_hop_right')
a.ld_a_lbl('frog_x')
a.add_a_n(4)
a.cp_n(63)
a.jp('c', 'mf_hr_store')
a.ld_r_n('a', 62)
a.label('mf_hr_store')
a.ld_lbl_a('frog_x')
a.ret()

a.label('mf_hop_up')
a.ld_a_lbl('frog_y')
a.cp_n(4)
a.ret_cc('c')
a.sub_n(4)
a.ld_lbl_a('frog_y')
a.ret()

a.label('mf_hop_down')
a.ld_a_lbl('frog_y')
a.add_a_n(4)
a.cp_n(61)
a.jp('c', 'mf_hd_store')
a.ld_r_n('a', 60)
a.label('mf_hd_store')
a.ld_lbl_a('frog_y')
a.ret()

a.label('ride_frog')
a.ld_a_lbl('frog_y')
for lane in RIVER_LANES:
    a.cp_n(lane['y'])
    a.jp('z', f'ride_lane_{lane["idx"]}')
a.ret()

for lane in RIVER_LANES:
    idx = lane['idx']
    hit = f'ride_lane_{idx}_hit'
    done = f'ride_lane_{idx}_done'
    left = f'ride_lane_{idx}_left'
    store = f'ride_lane_{idx}_store'
    a.label(f'ride_lane_{idx}')
    a.ld_a_lbl(lane_move_label(idx))
    a.or_r('a')
    a.ret_cc('z')
    for obj_idx in range(3):
        emit_obstacle_overlap(lane_x_label(idx, obj_idx), lane['width'], hit, f'ride_lane_{idx}_obj{obj_idx}')
    a.ret()
    a.label(hit)
    a.ld_a_lbl(lane_move_label(idx))
    a.cp_n(0xFF)
    a.jp('z', left)
    a.ld_a_lbl('frog_x')
    a.cp_n(62)
    a.jp('nc', 'lose_life')
    a.inc_r('a')
    a.label(store)
    a.ld_lbl_a('frog_x')
    a.ret()
    a.label(left)
    a.ld_a_lbl('frog_x')
    a.or_r('a')
    a.jp('z', 'lose_life')
    a.dec_r('a')
    a.ld_lbl_a('frog_x')
    a.ret()
    a.label(done)

a.label('check_collisions')
a.ld_a_lbl('frog_y')
a.cp_n(24)
a.jp('c', 'check_homes')
for lane in LANES:
    a.cp_n(lane['y'])
    a.jp('z', f'check_lane_{lane["idx"]}')
a.ret()

for lane in LANES:
    idx = lane['idx']
    hit = f'check_lane_{idx}_hit'
    done = f'check_lane_{idx}_done'
    a.label(f'check_lane_{idx}')
    for obj_idx in range(3):
        emit_obstacle_overlap(lane_x_label(idx, obj_idx), lane['width'], hit, f'check_lane_{idx}_obj{obj_idx}')
    if lane['kind'] == 'road':
        a.ret()
    else:
        a.jp('lose_life')
    a.label(hit)
    if lane['kind'] == 'road':
        a.jp('lose_life')
    else:
        a.ret()
    a.label(done)

a.label('check_homes')
for idx, hx in enumerate(HOME_XS):
    taken = f'home_{idx}_taken'
    next_lbl = f'home_{idx}_next'
    fit = f'home_{idx}_fit'
    a.ld_a_lbl('frog_x')
    a.add_a_n(2)
    a.cp_n(hx)
    a.jp('c', next_lbl)
    a.ld_a_lbl('frog_x')
    a.cp_n(hx + HOME_W)
    a.jp('nc', next_lbl)
    a.label(fit)
    a.ld_a_lbl(home_label(idx))
    a.or_r('a')
    a.jp('nz', 'lose_life')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(home_label(idx))
    a.ld_a_lbl('homes_filled')
    a.inc_r('a')
    a.ld_lbl_a('homes_filled')
    a.cp_n(4)
    a.jp('z', 'level_complete')
    a.jp('reset_round')
    a.label(taken)
    a.jp('lose_life')
    a.label(next_lbl)
a.jp('lose_life')

a.label('level_complete')
a.ld_a_lbl('level')
a.inc_r('a')
a.ld_lbl_a('level')
a.call('speed_up_lanes')
a.call('clear_homes')
a.jp('reset_round')

a.label('speed_up_lanes')
for lane in LANES:
    skip = f'speed_skip_{lane["idx"]}'
    a.ld_a_lbl(lane_speed_label(lane['idx']))
    a.cp_n(1)
    a.jp('z', skip)
    a.dec_r('a')
    a.ld_lbl_a(lane_speed_label(lane['idx']))
    a.label(skip)
a.ret()

a.label('lose_life')
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'exit_to_cpm')
a.dec_r('a')
a.ld_lbl_a('lives')
a.jp('z', 'exit_to_cpm')
a.jp('reset_round')

a.label('draw_ui')
hline_imm(0, 2, 64, BLACK)
hline_imm(0, 3, 64, BLACK)
a.ld_a_lbl('timer_value')
a.or_r('a')
a.jp('z', 'du_timer_done')
a.ld_r_n('d', 2)
a.ld_r_n('e', 2)
a.ld_r_r('b', 'a')
a.ld_r_n('c', BRIGHT_YELLOW)
a.call('hline')
a.ld_r_n('d', 2)
a.ld_r_n('e', 3)
a.ld_a_lbl('timer_value')
a.ld_r_r('b', 'a')
a.ld_r_n('c', BRIGHT_YELLOW)
a.call('hline')
a.label('du_timer_done')

hline_imm(0, 8, 16, BLACK)
hline_imm(0, 9, 16, BLACK)
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'du_lives_done')
for idx in range(3):
    skip = f'du_life_{idx}_skip'
    a.ld_a_lbl('lives')
    a.cp_n(idx + 1)
    a.jp('c', skip)
    rect_imm(2 + idx * 4, 8, 2, 2, BRIGHT_GREEN)
    a.label(skip)
a.label('du_lives_done')
a.call('draw_homes')
a.ret()

a.label('draw_homes')
for idx, hx in enumerate(HOME_XS):
    skip = f'draw_home_{idx}_skip'
    a.ld_a_lbl(home_label(idx))
    a.or_r('a')
    a.jp('z', skip)
    rect_imm(hx, 20, HOME_W, 4, BRIGHT_GREEN)
    a.jp(f'draw_home_{idx}_done')
    a.label(skip)
    rect_imm(hx, 20, HOME_W, 4, GREEN)
    a.label(f'draw_home_{idx}_done')
a.ret()

a.label('draw_lanes')
for lane in LANES:
    rect_imm(0, lane['y'], 64, 4, lane['bg'])
    for obj_idx in range(3):
        emit_draw_wrapped_obstacle(lane_x_label(lane['idx'], obj_idx), lane, f'draw_lane_{lane["idx"]}_obj{obj_idx}')
a.ret()

a.label('draw_frog')
a.ld_a_lbl('frog_x')
a.ld_lbl_a('frog_prev_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('frog_y')
a.ld_lbl_a('frog_prev_y')
a.ld_r_r('e', 'a')
a.ld_r_n('b', 2)
a.ld_r_n('c', FROG_COLOR)
a.call('hline')
a.inc_r('e')
a.ld_r_n('b', 2)
a.ld_r_n('c', FROG_COLOR)
a.call('hline')
a.ret()

a.label('erase_frog')
a.ld_a_lbl('frog_prev_y')
a.cp_n(24)
a.jp('c', 'ef_black')
a.cp_n(40)
a.jp('c', 'ef_blue')
a.cp_n(44)
a.jp('c', 'ef_green')
a.cp_n(60)
a.jp('c', 'ef_black')
a.jp('ef_green')

a.label('ef_blue')
a.ld_r_n('c', BLUE)
a.jp('ef_draw')

a.label('ef_green')
a.ld_r_n('c', GREEN)
a.jp('ef_draw')

a.label('ef_black')
a.ld_r_n('c', BLACK)

a.label('ef_draw')
a.ld_a_lbl('frog_prev_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('frog_prev_y')
a.ld_r_r('e', 'a')
a.ld_r_n('b', 2)
a.call('hline')
a.inc_r('e')
a.ld_r_n('b', 2)
a.call('hline')
a.ret()

a.label('rect4')
a.push('bc')
a.push('de')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.pop('de')
a.pop('bc')
a.ret()

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

# ─── Data ──────────────────────────────────────────────────────────────────────
a.label('in_btn'); a.db(0xFF)
a.label('in_x'); a.db(0)
a.label('in_y'); a.db(0)
a.label('joy_prev'); a.db(0)
a.label('joy_dir'); a.db(0)
a.label('hop_cooldown'); a.db(0)
a.label('frog_x'); a.db(FROG_START_X)
a.label('frog_y'); a.db(FROG_START_Y)
a.label('frog_prev_x'); a.db(FROG_START_X)
a.label('frog_prev_y'); a.db(FROG_START_Y)
a.label('lives'); a.db(3)
a.label('level'); a.db(1)
a.label('timer_value'); a.db(TIMER_RESET)
a.label('timer_tick'); a.db(TIMER_TICK_RESET)
a.label('homes_filled'); a.db(0)
for idx in range(4):
    a.label(home_label(idx)); a.db(0)
for lane in LANES:
    a.label(lane_speed_label(lane['idx'])); a.db(lane['speed'])
    a.label(lane_counter_label(lane['idx'])); a.db(0)
    a.label(lane_move_label(lane['idx'])); a.db(0)
    for obj_idx, xpos in enumerate(lane['xs']):
        a.label(lane_x_label(lane['idx'], obj_idx)); a.db(xpos)

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'FROGGER.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'FROGGER.COM')
a.save(out2)
