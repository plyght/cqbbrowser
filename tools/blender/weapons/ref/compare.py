"""IoU of the rendered silhouette vs the photo mask, plus the overlay and side-by-side PNGs.

    <venv>/python tools/blender/weapons/ref/compare.py <gun> <out-dir> <n>
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", ".cache")
gun, outdir, n = sys.argv[1], sys.argv[2], sys.argv[3]
photo = cv2.imread(os.path.join(CACHE, f"photo_{gun}.png"))
mask = cv2.imread(os.path.join(CACHE, f"mask_{gun}.png"), 0) > 127
import json  # noqa: E402

FLIP = json.load(open(os.path.join(HERE, "..", "profiles", f"{gun}.json"))).get("flip", False)
sil = cv2.imread(os.path.join(CACHE, f"sil_{gun}.png"), 0)
if FLIP:
    sil = cv2.flip(sil, 1)
H, W = mask.shape
sil = cv2.resize(sil, (W, H), interpolation=cv2.INTER_LINEAR) > 127
inter = np.logical_and(mask, sil).sum()
union = np.logical_or(mask, sil).sum()
iou = inter / union
os.makedirs(outdir, exist_ok=True)
# overlay: photo at 50 % with the model silhouette (cyan) and outline on top
ov = (photo.astype(np.float32) * 0.5 + 127).astype(np.uint8)
tint = ov.copy()
tint[sil] = (tint[sil] * 0.45 + np.array([230, 160, 30]) * 0.55).astype(np.uint8)
edges = cv2.Canny(sil.astype(np.uint8) * 255, 50, 150)
tint[edges > 0] = (0, 0, 255)
pe = cv2.Canny(mask.astype(np.uint8) * 255, 50, 150)
tint[pe > 0] = (0, 160, 0)
cv2.putText(tint, f"{gun}  side IoU {iou:.3f}  (green = photo, red = model)", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.1,
            (0, 0, 0), 2, cv2.LINE_AA)
cv2.imwrite(os.path.join(outdir, f"kit-{n}-{gun}-overlay.png"), tint)
beauty = cv2.imread(os.path.join(CACHE, f"beauty_{gun}.png"), cv2.IMREAD_UNCHANGED)
if beauty is not None and FLIP:
    beauty = cv2.flip(beauty, 1)
if beauty is not None:
    beauty = cv2.resize(beauty, (W, H))
    if beauty.shape[2] == 4:
        a = beauty[:, :, 3:4].astype(np.float32) / 255
        beauty = (beauty[:, :, :3] * a + 255 * (1 - a)).astype(np.uint8)
    sbs = np.hstack([photo, beauty])
    sbs = cv2.resize(sbs, (sbs.shape[1] // 2, sbs.shape[0] // 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(outdir, f"kit-{n}-{gun}-sidebyside.png"), sbs)
b34 = cv2.imread(os.path.join(CACHE, f"beauty34_{gun}.png"), cv2.IMREAD_UNCHANGED)
if b34 is not None:
    a = b34[:, :, 3:4].astype(np.float32) / 255
    cv2.imwrite(os.path.join(outdir, f"kit-{n}-{gun}-beauty.png"), (b34[:, :, :3] * a + 255 * (1 - a)).astype(np.uint8))
print(f"{gun} IoU {iou:.4f}")

# front view vs the published-dimension cross-section (guns.py "front": polygons in metres, x right / y up)
sys.path.insert(0, HERE)
from guns import GUNS  # noqa: E402

front = GUNS[gun].get("front")
silf_p = os.path.join(CACHE, f"silf_{gun}.png")
if front and os.path.exists(silf_p):
    silf = cv2.imread(silf_p, 0) > 127
    N = silf.shape[0]
    FS, cy = 0.1, 0.03 - 0.02
    # camera looks from the muzzle: image right = model -x (left side of the gun)
    spec = np.zeros_like(silf, np.uint8)
    for poly in front:
        pts = [(int(N / 2 - x / FS * N), int(N / 2 - (y - cy) / FS * N)) for x, y in poly]
        cv2.fillPoly(spec, [np.array(pts, np.int32)], 1)
    spec = spec > 0
    fi = np.logical_and(spec, silf).sum() / np.logical_or(spec, silf).sum()
    img = np.full((N, N, 3), 255, np.uint8)
    img[spec] = (img[spec] * 0.5 + np.array([60, 200, 60]) * 0.5).astype(np.uint8)
    img[silf] = (img[silf] * 0.5 + np.array([230, 160, 30]) * 0.5).astype(np.uint8)
    cv2.putText(img, f"{gun} front IoU {fi:.3f} (green = published dims, blue = model)", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)
    cv2.imwrite(os.path.join(outdir, f"kit-{n}-{gun}-front-overlay.png"), img)
    print(f"{gun} front IoU {fi:.4f}")
