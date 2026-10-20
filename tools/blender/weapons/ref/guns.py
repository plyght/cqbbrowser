"""Reference-photo setups for trace.py. Pixel coordinates are in the (optionally flipped) photo, muzzle LEFT.

Photos are reference only (not committed): download them into the photo dir with fetch.sh. `length` = published
overall length (m) used to scale the photo; `boreRow` = image row of the bore axis; `regions` = clip polygons (px)
that split the silhouette into parts ("rest" = everything not claimed); `marks` = named pixel points exported in the
weapon frame (pins, controls, sights) for the Blender build.
"""

GUNS = {
    # Glock 17 Gen 4, left side. MOD photo 45160305 (OGL v1.0), Wikimedia Commons:
    # https://commons.wikimedia.org/wiki/File:GLOCK_17_Gen_4_Pistol_MOD_45160305_(cropped).jpg
    "p17": {
        "photo": "g_GLOCK_17_Gen_4_Pistol_MOD_45160305_(cropped).jpg",
        "source": "https://commons.wikimedia.org/wiki/File:GLOCK_17_Gen_4_Pistol_MOD_45160305_(cropped).jpg",
        "length": 0.202,
        "boreRow": 195,
        "webBand": (330, 470),
        "eps": {"frame": 0.0003},
        "smooth": ["frame", "trigger"],
        "regions": {
            "frontSight": [(110, 30), (250, 30), (250, 88), (110, 88)],
            "rearSight": [(1590, 30), (1700, 30), (1700, 88), (1590, 88)],
            "slide": [(0, 88), (1920, 88), (1920, 283), (1860, 283), (1860, 300), (0, 300)],
            "trigger": [(1006, 452), (1100, 452), (1100, 650), (1006, 650)],
            "magbase": [(1400, 1258), (1840, 1258), (1840, 1376), (1400, 1376)],
            "frame": "rest",
        },
        # Front view from published dimensions (no square-on front photo on Commons): slide 25.5 mm with ~2 mm top
        # chamfers, 26 mm upper frame, 30 mm grip with ~5 mm corner radii, 30.5 mm base plate, controls at 32 mm.
        "front": [
            [(-0.01275, 0.0203), (0.01275, 0.0203), (0.01275, 0.0399), (0.01085, 0.0418), (-0.01085, 0.0418),
             (-0.01275, 0.0399)],
            [(-0.0017, 0.0418), (0.0017, 0.0418), (0.0017, 0.0447), (-0.0017, 0.0447)],
            [(-0.0051, 0.0418), (0.0051, 0.0418), (0.0051, 0.0458), (-0.0051, 0.0458)],
            [(-0.013, 0.0063), (0.013, 0.0063), (0.013, 0.0203), (-0.013, 0.0203)],
            [(-0.010, -0.088), (0.010, -0.088), (0.015, -0.083), (0.015, 0.0075), (0.010, 0.0125), (-0.010, 0.0125),
             (-0.015, 0.0075), (-0.015, -0.083)],
            [(-0.01525, -0.0948), (0.01525, -0.0948), (0.01525, -0.087), (-0.01525, -0.087)],
            [(-0.0172, -0.019), (-0.014, -0.019), (-0.014, -0.0085), (-0.0172, -0.0085)],
        ],
        "marks": {
            "frontSight": (215, 60),
            "rearSight": (1640, 60),
            "slideStopA": (1185, 360),
            "slideStopB": (1335, 345),
            "magRelease": (1245, 595),
            "takedown": (860, 345),
            "pinTrigger": (1003, 377),
            "pinBlock": (1020, 313),
            "pinRear": (1583, 525),
            "triggerPin": (1060, 455),
            "guardFront": (700, 600),
            "ejectFront": (575, 280),
            "serrFront": (1362, 160),
            "serrRear": (1665, 160),
            "slideFront": (62, 160),
            "slideRear": (1752, 160),
            "slideTop": (900, 88),
            "slideBottom": (900, 282),
            "dustFront": (75, 345),
            "railBottom": (300, 410),
            "magTopFront": (1290, 760),
        },
    },
    # M4 carbine (14.5", RAS, SOPMOD stock, GI 30-rd), right side. US Army PEO Soldier photo (public domain),
    # Wikimedia Commons: https://commons.wikimedia.org/wiki/File:PEO_M4_Carbine_RAS_noBG.png
    # Coordinates below are in the 2000-px-wide display of the unflipped photo (cs = 1.92); the photo is mirrored
    # so the muzzle points left. Scale from the receiver face → flash-hider shoulder (0.330 m for 14.5").
    "ar": {
        "photo": "PEO_M4_Carbine_RAS_noBG_w.jpg",
        "source": "https://commons.wikimedia.org/wiki/File:PEO_M4_Carbine_RAS_noBG.png",
        "flip": True,
        "cs": 1.92,
        "pxPerM": 4567,
        "boreRow": 219,
        "origin": {"px": 575, "z": 0.085},
        "eps": {"lower": 0.0003, "grip": 0.0004, "stock": 0.0004, "mag": 0.0004},
        "smooth": ["grip", "stock", "mag"],
        "regions": {
            "stock": [(60, 140), (548, 140), (548, 470), (60, 470)],
            "grip": [(490, 322), (700, 322), (700, 545), (490, 545)],
            "mag": [(850, 348), (1080, 348), (1080, 650), (850, 650)],
            "handguard": [(1030, 110), (1442, 110), (1442, 290), (1030, 290)],
            "fsb": [(1442, 55), (1570, 55), (1570, 290), (1442, 290)],
            "barrel": [(1570, 160), (1822, 160), (1822, 250), (1570, 250)],
            "fh": [(1822, 150), (1940, 150), (1940, 260), (1822, 260)],
            "trigger": [(752, 300), (792, 300), (792, 366), (752, 366)],
            "upper": [(548, 90), (1030, 90), (1030, 251), (548, 251)],
            "lower": "rest",
        },
        "marks": {
            "recvRear": (575, 250),
            "recvFront": (1030, 205),
            "magwellFront": (1000, 300),
            "magwellRear": (858, 300),
            "triggerPin": (790, 300),
            "fa": (790, 165),
            "chRear": (595, 140),
        },
    },
    # HK MP5 (A3 retractable stock, extended), right side, Wikimedia Commons "HK MP5 noBG.png"
    # (https://commons.wikimedia.org/wiki/File:HK_MP5_noBG.png). Mirrored so the muzzle points left; scaled to the
    # published 680 mm overall length (stock extended). Pixel coords in the unflipped original (cs = 1).
    "kp9": {
        "photo": "HK_MP5_noBG_w.jpg",
        "source": "https://commons.wikimedia.org/wiki/File:HK_MP5_noBG.png",
        "flip": True,
        "length": 0.68,
        "boreRow": 160,
        "webPx": (548, 268),
        "eps": {"lower": 0.0006, "mag": 0.0006, "stock": 0.0006, "handguard": 0.0006},
        "smooth": ["lower", "mag", "stock", "handguard"],
        "regions": {
            "stock": [(40, 105), (402, 105), (402, 335), (40, 335)],
            "handguard": [(868, 103), (1095, 103), (1095, 207), (868, 207)],
            "front": [(1095, 38), (1215, 38), (1215, 207), (1095, 207)],
            "mag": [(755, 250), (910, 250), (910, 525), (755, 525)],
            "lower": [(400, 187), (752, 187), (752, 320), (705, 445), (400, 445)],
            "receiver": "rest",
        },
        "marks": {
            "rearSight": (545, 75),
            "frontSight": (1120, 75),
            "recvRear": (412, 150),
            "triggerPin": (640, 250),
            "magCatch": (740, 265),
            "pushPinRear": (468, 200),
            "pushPinFront": (735, 225),
        },
    },
}
