"""Builds assets-src/mark.png, the simplified mark for 16/32px icons, from
assets-src/logo.png: a solid silhouette of the bird in the logo's gradient.
Run after replacing the logo, then `npm run icons`."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'assets-src/logo.png').convert('RGBA')
a = np.array(src)
S = src.size[0]

# Merge the mesh, feathers and dark fill into one shape. Pad first: the bird
# nearly touches the edges, and closing would otherwise fuse it to the border.
PAD = 100
m = Image.new('L', (S + 2 * PAD, S + 2 * PAD), 0)
m.paste(Image.fromarray(((a[..., 3] > 100) * 255).astype('uint8')), (PAD, PAD))
m = m.filter(ImageFilter.MaxFilter(81)).filter(ImageFilter.MinFilter(81)).crop((PAD, PAD, PAD + S, PAD + S))
# ...and fill any holes left inside it (whatever the outside can't reach).
outside = m.point(lambda v: 0 if v else 128)
ImageDraw.floodfill(outside, (0, 0), 255)
mask = np.array(m) | (np.array(outside) == 128)

yy, xx = np.mgrid[0:S, 0:S]
t = np.clip(((xx - yy) / S + 1) / 2 * 1.15 - 0.05, 0, 1)  # red-orange tail → yellow head
c0, c1 = np.array([255, 84, 24]), np.array([255, 196, 32])
out = np.zeros((S, S, 4), 'uint8')
out[..., :3] = (c0 * (1 - t[..., None]) + c1 * t[..., None]).astype('uint8')
out[..., 3] = np.where(mask, 255, 0)

# Eye: the bright dot in the head of the original.
eye = (a[..., 0] > 230) & (a[..., 1] > 170) & (a[..., 3] > 200) & (xx > S * 0.8) & (yy < S * 0.45)
cy, cx = np.nonzero(eye)
r = S * 0.03
out[(yy - cy.mean()) ** 2 + (xx - cx.mean()) ** 2 <= r * r] = (20, 22, 27, 255)

Image.fromarray(out).save(root / 'assets-src/mark.png')
print('wrote assets-src/mark.png')
