#!/usr/bin/env python3
"""Plot camera and gun offsets over time from the traces `MOVE_OUT=<dir> bunx playwright test movement` writes.

usage: tools/plot-movement.py <trace-dir> <out-dir>
Writes <out-dir>/move-plot-<clip>.png for the walk and sprint clips (rifle and pistol).
"""
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# Column order of the trace rows (see tests/e2e/movement.spec.ts).
COLS = "t speed camY camX camZ pitch yaw roll gunX gunY gunZ gunPitch gunYaw gunRoll phase ads grounded".split()
DEG = 180 / 3.141592653589793


def plot(src: Path, dst: Path):
    rows = json.loads(src.read_text())
    cols = {k: [r[i] for r in rows] for i, k in enumerate(COLS)}
    t0 = cols["t"][0]
    t = [x - t0 for x in cols["t"]]
    # Skip the start-up so the cycle is steady, keep ~2.5 s.
    i0 = next(i for i, x in enumerate(t) if x >= 1.2)
    i1 = next((i for i, x in enumerate(t) if x >= 3.7), len(t))
    sl = slice(i0, i1)
    tt = t[sl]

    def mean(xs):
        return sum(xs) / len(xs)

    def rel(k, scale=1.0):
        xs = cols[k][sl]
        m = mean(xs)
        return [(x - m) * scale for x in xs]

    fig, ax = plt.subplots(3, 2, figsize=(11, 8.5), sharex=True, constrained_layout=True)
    fig.suptitle(f"{src.stem}: camera (chest mount) and gun offsets, mean removed", fontsize=13)
    panels = [
        (ax[0][0], "Camera height (cm)", [("camY", 100, "height")]),
        (ax[1][0], "Camera lateral (cm)", [("camX", 100, "lateral")]),
        (ax[2][0], "Camera attitude (deg)", [("pitch", DEG, "pitch"), ("roll", DEG, "roll"), ("yaw", DEG, "yaw")]),
        (ax[0][1], "Gun height in camera frame (cm)", [("gunY", 100, "up")]),
        (ax[1][1], "Gun lateral / depth in camera frame (cm)", [("gunX", 100, "right"), ("gunZ", 100, "forward")]),
        (ax[2][1], "Gun attitude vs camera (deg)", [("gunPitch", DEG, "pitch"), ("gunRoll", DEG, "roll"), ("gunYaw", DEG, "yaw")]),
    ]
    for a, title, series in panels:
        for k, s, label in series:
            a.plot(tt, rel(k, s), label=label, linewidth=1.4)
        a.set_title(title, fontsize=10)
        a.grid(alpha=0.3)
        a.legend(loc="upper right", fontsize=8)
        a.axhline(0, color="k", linewidth=0.5, alpha=0.4)
    for a in ax[2]:
        a.set_xlabel("time (s)")
    # Heel strikes: gait phase crosses a multiple of pi.
    ph = cols["phase"][sl]
    for i in range(1, len(ph)):
        if int(ph[i] // 3.141592653589793) != int(ph[i - 1] // 3.141592653589793):
            for a in ax.flat:
                a.axvline(tt[i], color="tab:red", alpha=0.25, linewidth=0.8)
    fig.savefig(dst, dpi=110)
    plt.close(fig)


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    for f in sorted(src.glob("*.json")):
        if f.stem.startswith(("walk-", "sprint-")):
            plot(f, dst / f"move-plot-{f.stem}.png")
            print("wrote", dst / f"move-plot-{f.stem}.png")


if __name__ == "__main__":
    main()
