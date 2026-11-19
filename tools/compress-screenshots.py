"""Small README images: palette PNGs from the full captures in artifacts/ (see readme-screenshots.mjs)."""
import pathlib
from PIL import Image

root = pathlib.Path(__file__).resolve().parent.parent
(root / 'docs' / 'images').mkdir(parents=True, exist_ok=True)
for name in ('activity', 'report'):
    source, target = root / 'artifacts' / f'readme-{name}.png', root / 'docs' / 'images' / f'{name}.png'
    image = Image.open(source).convert('RGB')
    # 96 colours keep text edges and the pastel chips clean at a fraction of the size.
    image.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(target, optimize=True)
    print(f'{target.relative_to(root)}: {source.stat().st_size // 1024} KB -> {target.stat().st_size // 1024} KB')
