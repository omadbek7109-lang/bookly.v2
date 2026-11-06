"""Builds the Unicode fonts embedded in PDF exports (public/fonts/*.ttf).

Source: Liberation fonts 2.x (SIL Open Font License 1.1) — metric-compatible with Times / Arial / Courier,
so PDF layout stays the same as with the old standard fonts. Liberation has a Reserved Font Name, so the
subsets are renamed "Bookly Serif / Sans / Mono" as the OFL requires for modified versions.

Kept: Latin (incl. Uzbek oʻ gʻ and ʻ ʼ), Cyrillic (Russian + Uzbek ў қ ғ ҳ), punctuation, currency, arrows.
Run: python3 scripts/build-fonts.py   (needs fontTools; output is committed)
"""
import os
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = '/usr/share/fonts/truetype/liberation'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'fonts')
FAMILIES = {'Serif': 'Serif', 'Sans': 'Sans', 'Mono': 'Mono'}
STYLES = ['Regular', 'Bold', 'Italic', 'BoldItalic']
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x250)) + list(range(0x2B0, 0x300)) +
    list(range(0x300, 0x370)) + list(range(0x400, 0x530)) + list(range(0x1E00, 0x1F00)) +
    list(range(0x2000, 0x2070)) + list(range(0x20A0, 0x20C0)) + list(range(0x2100, 0x2150)) +
    list(range(0x2190, 0x2200)) + [0x2212, 0x2022, 0x25CF, 0x25A0, 0x2713, 0x2605, 0xFFFD]
)

os.makedirs(OUT, exist_ok=True)
for fam, short in FAMILIES.items():
    for style in STYLES:
        src = f'{SRC}/Liberation{fam}-{style}.ttf'
        f = TTFont(src)
        opts = subset.Options()
        opts.hinting = False
        opts.layout_features = []  # no GSUB/GPOS needed: Bookly lays out text itself
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        opts.drop_tables += ['DSIG', 'GSUB', 'GPOS', 'GDEF', 'kern', 'hdmx', 'VDMX', 'LTSH', 'gasp']
        s = subset.Subsetter(opts)
        s.populate(unicodes=UNICODES)
        s.subset(f)
        family = f'Bookly {short}'
        ps = f'Bookly{short}-{style}'
        sub = {'Regular': 'Regular', 'Bold': 'Bold', 'Italic': 'Italic', 'BoldItalic': 'Bold Italic'}[style]
        name = f['name']
        for rec in list(name.names):
            if rec.nameID in (1, 16):
                rec.string = family
            elif rec.nameID == 4:
                rec.string = f'{family} {sub}'
            elif rec.nameID == 6:
                rec.string = ps
            elif rec.nameID == 3:
                rec.string = f'{ps}; subset of Liberation {fam} for Bookly'
        f.save(os.path.join(OUT, f'{ps}.ttf'))
        print(ps, os.path.getsize(os.path.join(OUT, f'{ps}.ttf')))
