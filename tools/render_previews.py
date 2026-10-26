"""Render Maya's preview GIFs from the final atlas; never alters pet artwork.

Standalone, cross-platform rewrite of render-final-previews.py: no dependency on the
Codex create-pet plugin. Frame timings are the ones baked into the original previews.

Usage (Windows, macOS or Linux; needs Python 3.9+ and Pillow 9.1+):
    python render_previews.py
    python render_previews.py --atlas maya-spritesheet.png --out previews
"""
from pathlib import Path
import argparse
import json
from PIL import Image, ImageDraw

CELL_W, CELL_H = 192, 208

# Per-row frame durations in ms, in atlas row order (rows 0-8).
ROW_DURATIONS = {
    'idle':          [280, 110, 110, 140, 140, 320],
    'running-right': [120] * 7 + [220],
    'running-left':  [120] * 7 + [220],
    'waving':        [140, 140, 140, 280],
    'jumping':       [140, 140, 140, 140, 280],
    'failed':        [140] * 7 + [240],
    'waiting':       [150] * 5 + [260],
    'running':       [120] * 5 + [220],
    'review':        [150] * 5 + [280],
}
STATE_LABELS = ['Idle', 'Run right', 'Run left', 'Hello', 'Jump', 'Whoops', 'Waiting', 'Thinking', 'Checking']
LOOK_FIRST_ROW, LOOK_FRAMES, LOOK_DURATION = 9, 16, 160
BACKGROUND, INK = '#f7f3f5', '#343039'
ALPHA_CUTOFF = 128


def gif_frame(frame):
    """Round alpha to on/off at 50% so faint edge pixels don't turn into solid specks."""
    alpha = frame.getchannel('A').point(lambda a: 255 if a >= ALPHA_CUTOFF else 0)
    rgb = frame.convert('RGB')
    # MAXCOVERAGE keeps the worst-case colour error low (no off-colour specks in hair or skin).
    paletted = rgb.quantize(colors=255, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE)
    palette = paletted.getpalette()[:255 * 3]
    paletted.putpalette(palette + [0, 0, 0])  # index 255 is reserved for transparency
    paletted.paste(255, mask=alpha.point(lambda a: 255 - a))
    paletted.info['transparency'] = 255
    return paletted


def save_preview(frames, durations, path):
    """Save RGBA frames as a looping GIF with a transparent background."""
    frames = [gif_frame(f) for f in frames]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, disposal=2, transparency=255, optimize=False)


def crop(atlas, row, col):
    return atlas.crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--atlas', type=Path, default=here / 'maya-spritesheet.png')
    parser.add_argument('--out', type=Path, default=here / 'previews')
    parser.add_argument('--frames', type=Path, default=None,
                        help='optional folder to also write each frame as PNG')
    args = parser.parse_args()

    atlas = Image.open(args.atlas).convert('RGBA')
    expected = (8 * CELL_W, 11 * CELL_H)
    if atlas.size != expected:
        raise SystemExit(f'Atlas is {atlas.size}, expected {expected}')
    args.out.mkdir(parents=True, exist_ok=True)

    by_state, all_frames, all_durations = {}, [], []
    for row, (state, durations) in enumerate(ROW_DURATIONS.items()):
        frames = [crop(atlas, row, col) for col in range(len(durations))]
        by_state[state] = frames
        if args.frames:
            folder = args.frames / state
            folder.mkdir(parents=True, exist_ok=True)
            for col, frame in enumerate(frames):
                frame.save(folder / f'{col:02d}.png')
        for frame in frames:
            labeled = Image.new('RGB', (256, 256), BACKGROUND)
            labeled.paste(frame, (32, 24), frame)
            ImageDraw.Draw(labeled).text((10, 238), STATE_LABELS[row], fill=INK)
            all_frames.append(labeled)
        all_durations.extend(durations)
        save_preview(frames, durations, args.out / f'{state}.gif')

    all_frames[0].save(args.out / 'maya-all-states.gif', save_all=True, append_images=all_frames[1:],
                       duration=all_durations, loop=0, disposal=2)

    idle, jump = by_state['idle'], by_state['jumping']
    save_preview(idle + jump + idle,
                 ROW_DURATIONS['idle'] + ROW_DURATIONS['jumping'] + ROW_DURATIONS['idle'],
                 args.out / 'idle-jump-idle.gif')

    looks = [crop(atlas, LOOK_FIRST_ROW + i // 8, i % 8) for i in range(LOOK_FRAMES)]
    save_preview(looks, [LOOK_DURATION] * LOOK_FRAMES, args.out / 'look-loop.gif')

    # Four labelled proof frames of the jump, taken straight from the atlas.
    proof = Image.new('RGB', (4 * CELL_W, CELL_H + 24), BACKGROUND)
    for i, (frame, label) in enumerate([(idle[0], 'Ready'), (jump[0], 'Anticipation'),
                                        (jump[2], 'Airborne peak'), (jump[-1], 'Landing')]):
        proof.paste(frame, (i * CELL_W, 24), frame)
        ImageDraw.Draw(proof).text((i * CELL_W + 6, 6), label, fill=INK)
    proof.save(args.out / 'motion-proof.png')

    print(json.dumps({'ok': True, 'atlas': str(args.atlas), 'frames': len(all_frames),
                      'previews': str(args.out)}))


if __name__ == '__main__':
    main()
