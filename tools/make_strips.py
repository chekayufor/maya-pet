"""Cut Maya's atlas into per-state palette-PNG strips (the format the desktop app shows) as a TS module."""
import sys, io, base64, json
from pathlib import Path
from PIL import Image

atlas_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 0.75
colors = int(sys.argv[4]) if len(sys.argv) > 4 else 128
LIMIT = 120_000  # characters of href per SVG, under the 131,072 cap with room for the markup
CW, CH = 192, 208
STATES = {  # state: (row, frames, durations ms)
    'idle':    (0, 6, [280, 110, 110, 140, 140, 320]),
    'waving':  (3, 4, [140, 140, 140, 280]),
    'jumping': (4, 5, [140, 140, 140, 140, 280]),
    'failed':  (5, 8, [140] * 7 + [240]),
    'waiting': (6, 6, [150] * 5 + [260]),
    'running': (7, 6, [120] * 5 + [220]),
    'review':  (8, 6, [150] * 5 + [280]),
    'look':    (9, 16, [160] * 16),
}
atlas = Image.open(atlas_path).convert('RGBA')
w, h = round(CW * scale), round(CH * scale)


def encode(img):
    # Round alpha to on/off, then a shared palette with one transparent index.
    alpha = img.getchannel('A').point(lambda a: 255 if a >= 128 else 0)
    p = img.convert('RGB').quantize(colors=colors - 1, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE)
    pal = p.getpalette()[:(colors - 1) * 3]
    p.putpalette(pal + [0, 0, 0])
    p.paste(colors - 1, mask=alpha.point(lambda a: 255 - a))
    b = io.BytesIO()
    p.save(b, 'PNG', optimize=True, transparency=colors - 1)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


out, worst = {}, 0
for state, (row, n, durs) in STATES.items():
    strip = Image.new('RGBA', (w * n, h), (0, 0, 0, 0))
    for i in range(n):
        r, c = row + i // 8, i % 8
        cell = atlas.crop((c * CW, r * CH, (c + 1) * CW, (r + 1) * CH)).resize((w, h), Image.LANCZOS)
        strip.paste(cell, (i * w, 0))
    uri = encode(strip)
    worst = max(worst, len(uri))
    out[state] = {'frames': n, 'durations': durs, 'href': uri}
    print(f'{state:8} frames={n:2} chars={len(uri):6}{"  TOO BIG" if len(uri) > LIMIT else ""}')

if worst > LIMIT:
    raise SystemExit(f'largest strip {worst} > {LIMIT}; try a smaller scale or fewer colors')
ts = ['// Generated from maya-spritesheet.png by make_strips_png.py; do not edit by hand.',
      f'export const FRAME_W = {w}', f'export const FRAME_H = {h}', '',
      'export const STRIPS = {']
for state, v in out.items():
    ts.append(f"  {state}: {{ frames: {v['frames']}, durations: {json.dumps(v['durations'])}, href: '{v['href']}' }},")
ts += ['} as const', '', 'export type StripName = keyof typeof STRIPS']
out_path.write_text('\n'.join(ts) + '\n', encoding='utf-8')
print('frame', w, 'x', h, 'largest', worst, '->', out_path)
