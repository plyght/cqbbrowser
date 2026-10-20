# SHORTBARREL: Product Requirements Document

**Title:** SHORTBARREL (branding: **CAM04**, the in-world camera unit and footage watermark)
**Platform:** Desktop web browser (Chromium, Firefox, Safari 17+), Three.js / WebGL2
**Input:** Mouse + keyboard, **trackpad**, and **controller**, all first-class and on by default
**Status:** Draft v0.3, 2026-10-19 (implementation started)
**Scope of this PRD:** Single-player training content (ranges, steel courses, shoot houses). Core-feel first: no AI or multiplayer until the base gameplay is great.

### Changelog
- **v0.3:** Owner decisions: lean is **Q/E** (LB/RB on pad); no trackpad-swipe lean. Roster centred on **SBRs** incl. **HB-300** (Honey Badger–style integrally suppressed .300 BLK PDW), short AK, Glock-pattern pistol; maximum customization. Fictional PMC is **UMBRA CO.** (nod to CoD's Shadow Company + old-school subdued patches). Controller aim slowdown = Light on Standard. Hosting-after-private deferred. Tooling: **bun**.
- **v0.2:** Name chosen. Deep Bodycam teardown from Reissad's *Locked and Loaded* devlogs (§2). View-leads/weapon-follows aim model (§6.3). Ready or Not–style ammo check HUD (§6.6). Trackpad and controller input designed in depth (§7). Private-contractor framing. Helmet cam for replays and recording. Sonniss audio allowed (licensing plan in §10.3). Normal menus, no tablet UI. CI/CD plan (§12.3).
- **v0.1:** Initial draft.

---

## 1. Vision

A browser-based close-quarters shooter that captures the **Bodycam** look and physicality: the chest-rig camera, a body that actually exists, weapons with weight, and audio that sounds like it came through a cheap camera mic. It's tuned to be **fun and replayable**, not a punishing milsim.

You are a **private security contractor** running your company's training facility: square ranges, steel courses, and kill houses, against the shot timer. Every run is recorded on your **CAM04** chest unit, and the footage is the reward.

> **Feel target:** "That looks like real helmet-cam footage of a contractor clearing a house, and I want to beat my time."

### 1.1 Design pillars
1. **The camera sells it.** The lens, motion, image pipeline, and *microphone* make it feel like footage.
2. **The body exists.** The camera rides a simulated body; the gun is held by hands that are driven by that body, not glued to the screen.
3. **Weight, not friction.** Inertia, sway, real reload steps, and stress. All of it stays responsive. Tedium gets cut.
4. **Sound is information.** Room acoustics, pressure, steel pings. Players should be able to read a room with their ears.
5. **Short, replayable runs.** 20–90 second drills, instant restart, footage replay, "one more run."
6. **Every input is a first-class input.** Mouse, trackpad, and controller each get their own tuning, not a port of one another.
7. **Zero cost, zero friction.** Free assets only. No accounts, keys, or payments.

### 1.2 Non-goals (this phase)
- Multiplayer, hostile AI, civilians, player damage/ragdoll. *Revisit only after the core loop is proven fun.*
- Bodycam's in-world tablet UI and spawn-into-the-range menu. **We use a normal, fast menu.**
- Shops, skins, monetization
- Real company names or trademarks (generic weapon names; fictional contractor company)
- Mobile/touch

---

## 2. Bodycam teardown (research)

Sources: Reissad Studio's *Locked and Loaded* devlogs (animations/loadouts/UI/gadgets, sound design, and "final" episodes, supplied by the project owner), plus press and community sources linked in §16. Each subsection lists **what Bodycam does**, then **what SHORTBARREL does**.

### 2.1 Camera as a physical object
**Bodycam:**
- The camera is a real object on the character, not the POV. The character **turns it on at spawn and off when leaving**.
- The camera system was rebuilt from studying real bodycam footage: how it moves when the wearer walks, runs, or changes direction suddenly.
- After heavy impacts or sudden movement, the character **reaches up and readjusts the camera** to keep it recording. While the hand is on it, the **audio becomes muffled**.
- When there's a flashbang or explosion, the character instinctively shields their face, and the camera sees the arm come up.
- Look: fisheye/wide-angle, barrel distortion, chromatic aberration, digital sharpening, compression, lens dirt.

**SHORTBARREL:**
- **CAM04 power-on sequence** at drill start: a black frame, a brief sensor "boot" (exposure hunting, a white-balance shift over about 0.6 s), a record-LED reflection, and a soft beep. It doubles as the "Standby…" moment before the shot timer beep. **Power-off** at drill end: freeze, a small glitch, black. The replay file is the clip between those two moments.
- **Camera readjust:** after a sprint stop, vault, door kick, or bumping a wall hard, the mount gets knocked slightly crooked (a 1–4° roll/pitch offset). If the offset is large, the left hand auto-reaches to straighten it at the next idle moment, muffling the mic for about 0.4 s. Players can also trigger it manually ("fix cam"). It's never forced mid-engagement, which matters for fun.
- **Flinch:** loud events nearby (falling steel, a door slam, a range-neighbor shot in an adjacent bay) produce a small flinch. Flashbang training is a stretch goal, with the arm-up shield.
- Full post stack in §5.

### 2.2 "True body": the camera doesn't drive the body
**Bodycam:**
- Most FPS games lock the arms to the camera. Bodycam's **True Body** system fully simulates the body. The camera is just a point of view on it, so the character keeps doing actions while you look elsewhere.
- **To check your magazine you actually have to look at it**, or you'll miss the information.
- After firing, the character **readjusts their grip**. The less stable the weapon, the more adjustments happen. **Long strings cause hand fatigue.**

**SHORTBARREL:**
- **Body-first rig:** input rotates the *body* (yaw) and the *upper torso/arms* (pitch). The chest camera is mounted to the torso, and the weapon is held by **IK hands** following the torso aim with spring lag (§6.3). That is the "view first, then gun" feel.
- Reloads, mag checks, and door pushes play in **body space**. You can keep turning and moving during them, and the hands keep working.
- **Mag check:** the character tilts the mag into view. On chest cam it's naturally in frame; on helmet cam you have to look down slightly. The HUD readout (§6.6) is the accessibility layer on top. In Hardcore, it's the *only* source of the information.
- **Grip readjust** micro-animations after strings of fire (scaled by weapon stability). **Hand fatigue** builds with sustained fire and raises sway and recoil recovery time, then decays over a few seconds.

### 2.3 Stress
**Bodycam:**
- Pressure such as being shot at, injured, or just trying to survive makes **breathing heavy and hands shake**.
- That stress feeds directly into reloads (§2.4).

**SHORTBARREL** (training only, so no incoming fire):
- **Stress (0–1)** comes from sprinting, shooting fast, being near or over par time, failure events (fumbles, malfunctions, no-shoot hits), and a loud environment (indoor shots without ear pro).
- It decays when you're still or slow-walking, and faster when you take a breath (hold breath and exhale is a stretch goal).
- Effects: breathing audio, hand-shake noise on sway, reload variant selection, fumble chance (Standard/Hardcore only), and a slightly faster camera bob frequency.
- **No UI bar.** You hear and see it.

### 2.4 Reloads: calm vs. stressed, multiple variants, no repeats
**Bodycam:**
- Two entirely different reload **states: calm and stressed**, with **multiple variations inside each**. Variants differ in timing and movement, so reloads never feel repetitive.
- Applies to **every weapon**:
  - Shotgun shell inserts have several calm variants; stressed ones are rushed and less precise.
  - Bolt-action round loading has calm variants; stressed ones can **struggle with or fumble a round**.
  - Running the bolt has several variants; under stress the **hand slips off the bolt**, regrips, and chambers.
- **Revolver:** a unique animation for **every possible reload count** (fire 1, replace 1; fire 3, replace 3; empty, reload all 8). Each has its own timing, so reloading is a decision.
- **Procedural positioning:** the weapon is never held in exactly the same place (slightly higher, lower, or off-center).
- Pipeline: real-life reference recorded by the creative director → hand-keyed animation. That's weeks per weapon.

**SHORTBARREL:**
- We can't hand-key a month per weapon, so reloads are **procedural animation graphs**. Each reload is a sequence of **beats** (e.g., *grip mag → release → mag out → stow/drop → draw fresh → index → seat → tap → bolt release*). Each beat is an IK target trajectory for the hands plus a weapon pose, authored as small keyframe tracks.
- **Variation layers** on every beat:
  1. A **calm or stressed track set**: stressed beats are shorter, overshoot more, and have looser IK targets.
  2. **2–4 authored variants per beat**, randomly chosen without immediate repeats (e.g., seat with a palm slap vs. a push and tug-test).
  3. **Per-run noise**: ±8% beat timing, small positional offsets, and a hold position that drifts (higher, lower, off-center) per Bodycam's procedural positioning.
  4. **Fumble beats** (stress-gated): mag misses the well (re-index +0.35 s), shell drops (+0.5 s, and the shell stays on the floor), hand slips off the charging handle or bolt (+0.3 s).
- **Revolver:** reload by **count**. Tap = load one round into the next empty chamber; the speedloader is used only when 4 or more are empty. Partial reloads are naturally faster than full ones.
- **Shotgun:** single-shell inserts, interruptible by fire. Calm vs. stressed insert variants. A stressed fumble drops the shell.
- **Animation authoring tool** (dev-only page): a timeline editor for beats with live IK preview. Exports JSON. This is how we get "a lot of variants" cheaply.
- **Video reference:** we record our own reference (phone video of dry reloads with a training gun or a blue gun) and rotoscope beat timings. No paid mocap.

### 2.5 Loadouts and weapon customization
**Bodycam:**
- Modify almost every part: **barrels, stocks, grips, magazines**. Some parts **unlock others**: an AK needs a rail before a sight.
- Every part changes behavior. **Compact is fast but harder to control; heavy is slower but more stable.**
- You can aim with the main sight, a **secondary offset sight** on the side, or **no optic at all**.
- Unlimited saved loadouts

**SHORTBARREL:**
- **Part slots:** barrel (length → velocity, handling, blast/flash, sound), stock (collapsed/extended → ADS time, recoil), handguard/rail, grip (vertical/angled/none), optic (iron / red dot / holo / LPVO 1–6× / magnifier flip), **offset dot** (45°), muzzle (bare / brake / flash hider / **suppressor**), light, magazine (capacity, weight), and sling (affects weapon-switch time).
- **Dependency graph:** e.g., an optic needs a rail, an offset dot needs a rail at 45°, and some guns have no rail without a handguard swap.
- **Stats:** mass and length feed the handling model (§6.3): heavier means more inertia (slower start and stop) and more stability (less sway, better recoil recovery). Front-heavy setups lag more on turns.
- **Aim modes cycle:** primary optic → offset dot → irons (if co-witnessed or BUIS). Each is a different eye-to-sight pose.
- **Loadout slots:** unlimited, saved locally. Plus **gear**: plate carrier with mag count by pouches (§6.5), belt (sidearm, dump pouch), gloves.
- *This is the name's origin: the short-barrel builds are the CQB meta (fast handling, loud and flashy). The tradeoff is real.*

### 2.6 Optics
**Bodycam:**
- They rejected **camera-zoom scopes** (not realistic) and avoided **full picture-in-picture** (renders the world twice: expensive, rigid, blurry). They built a custom UE rendering extension that gives **PiP-quality magnification at much lower cost**, plus an optic shader with **realistic glass, reticle distortion, reflections, and dynamic lighting**.

**SHORTBARREL** (Three.js plan):
- **Red dots and holos:** reticle rendered in the lens as **projected at infinity**: the dot position is computed from the bore/sight axis, so there's real **parallax and an occluded-eye** feel at odd head positions. The glass has a slight tint, an edge reflection, and a dirty-glass sprite that catches lights.
- **Magnified (LPVO / magnifier), hybrid technique:**
  - **≤2×:** the lens shader **samples the already-rendered main frame** with magnified UVs around the sight axis. It costs almost nothing. Resolution loss at 1–2× is acceptable and is hidden by the bodycam softness.
  - **>2×:** a **second low-cost render** into a small target (e.g., 512² on Medium), with a tight frustum (cheap culling), no post stack, simplified shadows (reuse the main shadow map), and reduced LOD bias. The sight picture is small in the frame, so the pixel count stays low.
  - Lens shader adds barrel distortion inside the tube, **eye box/scope shadow** that depends on head offset (the black ring creeps in if your cheek weld is off during movement), chromatic fringing, glass reflections, and a first-focal-plane or second-focal-plane reticle.
- The magnifier flips with a key/button and has a real animation.

### 2.7 Organic reverb, propagation, and the bodycam mic (sound)
**Bodycam:**
- Real gunshots aren't cinematic. They're a **shockwave**. Avoid the Hollywood bass and punch.
- **Organic reverb:** a dynamic system that analyzes **room size, ceiling height, openings, windows, corridors, enclosure, and how much air can escape**, in real time, for every shot.
  - Tiny bathroom: the pressure has nowhere to go, the **bass becomes overwhelming**, and the shockwave bounces violently, so the space feels compressed.
  - Big room: it breathes, with longer tails and more air.
- **Shockwave propagation:** the blast wave travels down corridors and out of rooms to the listener, which lets you follow the pressure to the shooter. Exterior shockwaves: pressure escapes through openings outdoors.
- **Smooth indoor↔outdoor evolution** as you move while firing, with no hard switch.
- Reworked **occlusion** (shots behind walls) and **vertical positioning** (above or below)
- **Footsteps:** **38 surfaces**, each with sub-variants (polished, dusty, damaged, sidewalk, and debris-covered concrete, etc.), plus **pivot/slide scuff sounds** on direction changes for every surface
- **Mic artifacts:** running impacts travel through the body into the **chest rig and helmet**, producing **thumps and vibrations in the mic**. A **dynamic stereo wind** in the mic changes with rotation direction (turn left and the left mic catches more wind) and gets more aggressive with movement. It's attenuated indoors.
- Camera readjust **muffles the mix**.
- Every reload was rebuilt with hand-recorded clicks, rattles, impacts, and mechanical detail.

**SHORTBARREL:** all of this is achievable in Web Audio. Full design in §9.

### 2.8 Other Bodycam systems and our call
| Bodycam system | Call |
|---|---|
| Procedural **stumbling** self-balancing body (non-lethal hits) | Later, if player damage or AI arrives. Interesting for *targets*: "stumbling" reactive dummies are a stretch goal |
| Ragdolls | Later (AI phase). Steel and paper use rigid-body physics now |
| RC cars, FPV drones (casual and real-physics modes) | Later. An **RC car recon drill** in the shoot house is a fun stretch goal |
| Tablet UI / spawn into the shooting range as the menu | **No.** Normal menu (owner preference) |
| Settings: camera shake, gamma calibration, hold/toggle behavior, precise sensitivity | **Yes**, all in v1 (§11) |
| Controller support ("playable but rough" by their own admission) | **We beat this.** First-class from M0 (§7) |
| Performance is heavy (needs a powerful PC; upscalers) | Browser-first budget, resolution scaling, quality tiers (§12.2) |
| Peer-to-peer, host migration, voice chat | N/A this phase |
| Grenades | Later (flashbang training is a stretch goal) |

---

## 3. Target player and success metrics
**Players:** fans of Bodycam / Ready or Not / Ground Branch, practical-shooting nerds, and people who share helmet-cam clips. They want zero install and they play on whatever they have, **including a laptop trackpad on the couch** or **a controller plugged into a laptop**.

**Metrics (v1):**
- Time to first shot under 15 s warm, under 30 s cold
- At least 60% of first-drill finishers start a second drill
- Median session of 10 minutes or more
- At least 30% of sessions using trackpad or controller can complete the tutorial drill with a medal (input parity check)
- 60 FPS at 1080p on Iris Xe / M1-class GPUs on Medium; 120+ FPS on discrete GPUs
- First playable download under 40 MB; later content streamed

---

## 4. Core loop
```
Menu → Facility → Drill → Loadout → [CAM04 powers on] → "Shooter ready… standby…" → BEEP
  → move, clear, engage → final target / finish line → BEEP → [CAM04 powers off]
  → score (time, hits, penalties, splits) → [Retry] [Watch footage] [Export clip] [Next]
```
- **Scoring** (simplified USPSA/IDPA): paper A/C/D = 5/3/1, steel = hit/miss (must fall or ring), no-shoot and miss penalties. *Time + penalties* or *hit factor* depending on drill. Medals: Bronze, Silver, Gold, Instructor. Local PBs.
- **Instant restart:** hold Backspace (keyboard) or hold View/Share (controller). It goes back to "standby" in under 1 s. Critical for fun.
- **Footage replay:** deterministic input/state log → re-simulate through the CAM04 pipeline (§12.4). Scrub, speed control, **helmet-cam re-render**, free cam, and **export WebM** with burned-in CAM04 overlay.

---

## 5. Camera and visual presentation

### 5.1 Mounts
| Mount | Use | Details |
|---|---|---|
| **Chest (default)** | Gameplay | About 1.35 m. Rides the plate carrier, offset slightly left of center (a typical shoulder-strap or MOLLE mount). Rolls and pitches with the torso, not the head. The gun sits big and low in frame. |
| **Helmet** | **Replays and recording**, optional for gameplay | Eye-line plus a small offset (side rail mount). Follows head look. Bigger bob. More "GoPro." |

Replays can be re-rendered from either mount, since the sim is deterministic and the body pose is known. Export lets you pick chest, helmet, or **split-screen side by side**.

### 5.2 Camera motion model (body-coupled)
- The camera is a **spring-damper on the torso bone**. Inputs: footstep impulses (heel strike per foot), torso yaw acceleration (lag and overshoot), lean roll, recoil impulse through the shoulder (the stock pushes the body, which pushes the camera), and plate-carrier jiggle (a secondary spring with small amplitude and low frequency).
- **Gait-synced bob:** a vertical double bounce per stride, lateral sway per step, and slight roll. Amplitude scales with speed; frequency scales with cadence and stress.
- **Direction-change jolt:** a quick lateral or roll spike on sharp strafe reversals. That's the classic footage tell.
- **Mount knock** (§2.1) adds a persistent offset until fixed.
- **Accessibility:** a "Camera shake" slider (0–100%) scales all of the above, plus a "Stable horizon" toggle (removes roll only).

### 5.3 Post stack (custom passes, merged where possible)
1. **Fisheye/barrel distortion** (Brown–Conrady k1/k2, with optional OpenCV fisheye model) and edge stretch. Chest cam is about 120° diagonal; helmet is about 140°.
2. **Radial chromatic aberration**, increasing toward the edges
3. **Auto-exposure** with lag and hunting (it overshoots when entering or leaving a dark room)
4. **Auto white balance** drift (slow, small), plus a **highlight clip with a magenta/cyan fringe** on muzzle flash
5. **Sensor noise**: luminance-dependent, chroma noise in the shadows, with **temporal grain** at the camera's frame cadence
6. **Over-sharpening halo** (an unsharp mask with a wide radius)
7. **Compression**: 8×8 block quantization, 4:2:0 chroma, **bitrate starvation** during fast motion (block size and quantization spike for 2–6 frames on fast yaw), and **I-frame pulsing** (subtle quality "breathe" every about 1 s)
8. **Rolling shutter** skew on fast yaw (subtle)
9. **Optional cadence lock**: present the camera at a fake 30 fps "recording" cadence *for the replay export only*. Gameplay renders at full refresh.
10. **Lens dirt, smudge, and vignette.** Dirt lights up from bright sources.
11. **Overlay** (diegetic, the CAM04 watermark): `CAM04 · UMBRA CO. · UNIT 0412 · 2026-10-19 14:32:07` (fictional PMC), a REC dot, and a battery icon. Toggleable. Always on in exports unless disabled.

One **"Footage intensity"** slider (0–100%) plus per-effect overrides in Advanced settings.

### 5.4 Rendering
- Three.js (WebGL2; WebGPU renderer as a stretch goal), PBR, **baked lightmaps** for houses, an HDRI sky (Poly Haven), and 1–2 shadowed lights max
- Decals: paper holes, drywall/wood/concrete impacts, paint scuffs on steel (pooled projected decals)
- Particles: muzzle flash flipbooks plus a light, instanced brass with physics-lite bounces and surface-aware sound, drywall dust, steel spall sparks, smoke wisps (suppressor "first-round pop" puff)
- **Weapon light:** a spotlight with a cookie, plus volumetric-ish dust cone in dark rooms. Momentary or constant modes.

---

## 6. Gameplay systems

### 6.1 Movement
| Action | KBM | Controller (Xbox / PS) | Notes |
|---|---|---|---|
| Move | WASD | LS | Combat walk about 1.6 m/s by default |
| Slow walk | Hold Alt | Light LS deflection (analog) | About 0.8 m/s; steadier, quieter |
| Sprint | Shift | Click LS | About 4.5 m/s; weapon to low ready, short ramp, raises stress |
| Crouch | C / Ctrl | B / ○ (tap toggle, hold = momentary) | |
| Lean L/R | Q / E | Hold LB / L1 and RB / R1 | Smooth, about 25° roll plus lateral offset; works while moving. Optional **analog lean** (hold LB + RS horizontal) |
| Ready position | Mouse wheel / X | D-pad down (cycle) | High ready / low ready / compressed (tucked for doorways) |
| Aim (ADS) | RMB | LT / L2 | Hold by default; toggle option |
| Fire | LMB | RT / R2 | |
| **Reload / ammo check** | **R** | **X / □** | See §6.6: tap, double-tap, or hold |
| Cycle aim mode | V | D-pad up | Optic → offset dot → irons |
| Magnifier flip | B | D-pad up (hold) | |
| Weapon light | T | D-pad left | Tap = momentary, double-tap = constant (configurable) |
| Fire mode | N | D-pad right | |
| Switch weapon | 1 / 2 / wheel click | Y / △ | Real sling/holster times |
| Interact / door | F | A / ✕ | Door: tap = open, hold + move = slow push (slice the pie), sprint into it = shove |
| Fix camera | H | Hold D-pad down | §2.1 |
| Chamber check | Hold F (no target) | Hold A / ✕ (no target) | |
| Restart drill | Hold Backspace | Hold View / Share | |
| Pause | Esc | Menu / Options | |

- **Rapier `KinematicCharacterController` capsule:** step-up, slope limits, crouch collision, and auto-step for thresholds
- **Inertia:** about 150 ms to full speed, deceleration slide, and turn-rate coupling into weapon lag. Loadout weight scales acceleration (±15%).
- **Weapon collision ("muzzle tuck"):** when the muzzle would clip a wall or door frame, the weapon smoothly retracts or cants up. **You cannot fire through a tucked muzzle at a wall.** This is critical for CQB authenticity and for the short-barrel tradeoff: shorter guns tuck less.

### 6.2 Weapons (v1, generic names)
| Slot | Weapon | Notes |
|---|---|---|
| Primary | **SB-16** (AR-15 SBR 5.56, 10.3″/11.5″/12.5″/14.5″ barrels) | The flagship. Barrel length is the "SHORTBARREL" choice |
| Primary | **HB-300** (Honey Badger–style .300 BLK PDW, integral suppressor; unsuppressed short variant) | Owner favourite. Quiet, compact, subsonic |
| Primary | **KP-9** (MP5-pattern 9 mm SMG) | Low recoil, beginner-friendly, roller-delayed sound character |
| Primary | **K-47S** (AK-pattern short, 7.62×39) | Needs a rail for optics (dependency example from §2.5) |
| Primary | **PM-12** (pump 12 ga) | Single-shell, interruptible inserts; pellets vs. steel; slugs |
| Sidearm | **P-17** (Glock-pattern 9 mm) | Optional red dot, light |
| Sidearm | **R-357** (8-shot .357 revolver) | Per-count reloads (§2.4) |
| Stretch | Bolt-action precision rifle, suppressed PCC, flashbangs (training) | |

### 6.3 Aim model: view leads, weapon follows
This is the "short version of body/POV first, then gun" feel. It's the most important gameplay tuning in the game.

1. **Input → body:** input deltas rotate the **body yaw and torso pitch** immediately. The **chest camera follows the torso** with a very stiff spring (it responds within about 1 frame and adds only small overshoot/jiggle). The *view* is immediate and never feels floaty.
2. **Torso → weapon:** the weapon's aim direction chases the torso aim through a **critically damped spring** with a **short lag** (tunable half-life about 25–60 ms by weapon mass, length, and attachments; plus a slight overshoot on stop for heavy and front-heavy builds).
   - Fast flick: the view arrives first, and the muzzle sweeps in a beat later, swinging slightly past and settling.
   - **Bullets leave the barrel**, not the screen center. A shot mid-swing lands where the gun points. There's no crosshair, so the sight picture tells you everything.
3. **Positional sway:** the weapon also translates opposite to turn direction (inertia) and with strafe (lateral drag), using a separate spring.
4. **Idle sway:** breathing (slow ellipse) plus **stress hand shake** (higher-frequency noise) plus **fatigue** (§2.2). Lower when crouched, braced against a wall or door frame (auto-brace detection), or in ADS.
5. **ADS:** the weapon rises to the eye line and the spring stiffens (less lag). The **chest cam doesn't move up**, but the sight comes into frame. On chest cam, ADS shows the gun and sight in the upper-center part of the frame. On helmet cam, it's a classic sight picture. *Tuning goal: at ADS, a player can make an A-zone hit at 7 m within 0.25 s of a 90° turn.*
6. **Sight-over-bore offset** is modeled: at 3 m, a 2.6″ height-over-bore matters (a real "pro" detail).
7. **Recoil:** a per-weapon impulse (climb, horizontal wander, roll, rearward kick) into the *weapon* spring and the *body/camera* spring. **Recovery returns toward the original point of aim**, so good shooting is cadence, not mouse-yanking. Grip and stock attachments modify it. Fatigue slows recovery.
8. **Per-input lag scaling:** controller and trackpad get optional slightly-lower lag defaults (smoother, less precise inputs would otherwise compound the lag). Every lag and spring value is exposed under Advanced → "Weapon handling," with a **"Weapon inertia" master slider** (0 = arcade-locked gun, 100 = heavy).

### 6.4 Gunplay
- **Hitscan with mechanical offset and simple penetration:** drywall, interior doors, and furniture are penetrable with velocity loss. Concrete, brick, and steel stop rounds. Steel creates spall sparks and **ricochet sounds**, but no ricochet damage (it's training).
- **Malfunctions** (Hardcore, or a toggle): failure to feed or stovepipe (visible on the model). Clear by tap-rack (hold Reload + Interact).
- Rate of fire, burst, and auto per weapon. Suppressor: lower report, first-round pop, more back-gas visual, and a slightly different mechanical sound mix.

### 6.5 Magazines and ammo (real inventory)
- Every magazine is an object with its own round count. Pouches on the plate carrier and belt have fixed slots (e.g., 3 rifle + 2 pistol on the carrier, a **dump pouch** on the belt).
- **Tactical/retention reload:** the partial mag goes to the dump pouch (or back into a pouch slot if one is free) and can be used later.
- **Speed/emergency reload:** the mag hits the floor and **stays there**, with a surface-aware drop sound. It's visible in the replay.
- On the next reload, the game picks the **fullest available mag** (Standard) or the **next pouch in order** (Hardcore, so you manage your own mags).
- Chamber tracking: tactical reloads keep +1 in the chamber; empty reloads require bolt or slide release (part of the beat sequence).

### 6.6 Minimal HUD and the Reload/Ammo-check button (Ready or Not–style)
One button does three things. It's **X / □** on controller and **R** on KBM.

| Gesture | Action |
|---|---|
| **Tap** | **Tactical reload** (retain the mag) |
| **Double-tap** (second press within 300 ms) | **Speed reload**: dump the mag on the floor |
| **Hold** (≥ 220 ms) | **Ammo check**: plays the mag-check animation and shows the HUD readout while held |

**No added latency:** the tactical reload starts on the first **release**. If a second press arrives within the window *while the reload is still in its "mag out" beat*, it **branches into the dump variant** (the hand lets go instead of stowing). So the double-tap never delays a single-tap reload.

**HUD readout (during hold):** a small, low-contrast panel near the bottom center, styled like the CAM04 overlay text:
```
SB-16   ▮▮▮▮▮▮▮▮▯▯   ~23 / 30   +1
MAGS    ███  ███  ██▌  █▏         (3 full · 1 partial)
```
- **Standard:** exact round count ("23 / 30") plus a mag list with fill bars. Partial mags are distinguished.
- **Hardcore:** no readout. You must look at the mag (the animation still plays; translucent or windowed mags show the actual rounds).
- **Arcade:** a persistent small ammo counter plus a tiny center dot (accessibility and new players).
- Other minimal HUD elements: a **shot timer readout only at drill end**. Optional "objective whisper" text at drill start (fades). An **input prompt glyph** when near an interactable (Standard and Arcade).

### 6.7 Realism presets
| | Arcade | **Standard (default)** | Hardcore |
|---|---|---|---|
| HUD | Ammo counter + dot | Ammo check on hold | None |
| Fumbles | Off | Rare (high stress only) | On |
| Malfunctions | Off | Off | On |
| Mag choice | Auto fullest | Auto fullest | Pouch order |
| Weapon inertia | 40% | 100% | 120% |
| Aim assist (controller) | Standard | Light | Off |

---

## 7. Input: mouse, trackpad, controller (all first-class)

### 7.1 Input architecture
- An **action map layer** (like Unity's Input System): actions (`Look`, `Move`, `Fire`, `ReloadOrCheck`, …) with **bindings per device class** and per-action **interaction types** (`tap`, `doubleTap`, `hold`, `press`, `release`, `analog`). Gameplay code only sees actions.
- **Hot-switching:** the last-used device becomes active instantly. **Glyphs swap live** (keyboard, Xbox, PlayStation, Switch) using **Kenney Input Prompts (CC0)**. PlayStation glyphs come from the pixel/1-bit packs if the vector pack lacks them.
- **Rebinding UI** for all devices, plus **hold/toggle per action** (ADS, crouch, lean, sprint, light)
- **Sensitivity in real units:** cm/360 for mouse, °/s at full deflection for stick, and °/cm-equivalent for trackpad. Separate hip and ADS multipliers per device, optional **per-optic-magnification ADS scaling** (monitor-distance-match style).

### 7.2 Mouse
- **Pointer Lock** with `unadjustedMovement: true` (raw, no OS acceleration) where supported (Chromium). Detect and fall back gracefully elsewhere.
- **High-polling sanity:** accumulate all `pointermove` deltas per frame (use `getCoalescedEvents` where available), never sample just the last event.
- Sub-pixel accumulation and **no smoothing by default**. Optional smoothing for the replay camera only.

### 7.3 Trackpad (designed for it, not just tolerated)
No browser game handles trackpads well. Our approach:

**Detection:** auto-detect trackpad from wheel-event heuristics (fractional deltas, high-frequency small deltas, `ctrlKey` pinch events, `wheelDeltaY` patterns) and ask once: "Looks like you're on a trackpad. Use the trackpad preset?" Users can always pick manually in settings.

**Trackpad preset:**
| Gesture | Action | Notes |
|---|---|---|
| One-finger glide | **Look** | Pointer lock, but **OS acceleration kept on** (`unadjustedMovement: false`). On a small surface, acceleration is a feature: slow = precise, fast = turn. Plus our own optional **precision curve** (low-speed gain reduction, high-speed boost) tunable with a live graph |
| Click / tap-to-click | **Fire** | |
| Two-finger click / tap (right-click) | **ADS toggle** | Toggle by default on trackpad (holding a two-finger click while gliding is awkward) |
| **Two-finger vertical scroll** | Ready position up/down (or LPVO zoom while ADS on a variable optic) | Wheel events still fire under pointer lock. Thresholded and debounced so inertial scrolling doesn't spam |
| **Pinch** (`wheel` + `ctrlKey`) | Magnifier flip / cycle aim mode | `preventDefault` with `{ passive: false }` to block page zoom. Safari also supports `gesturechange` |
| **Force Click** (Safari, `webkitmouseforcechanged`) | Optional: deep press = ADS hold | Safari-only bonus |
| Keyboard (left hand) | Movement and everything else | Same as KBM |

**Trackpad-specific helpers:**
- **Turn assist:** optional **edge-glide turning**. If your finger reaches the trackpad edge and stays moving, keep turning at that velocity until it stops. This is the trackpad equivalent of a stick's outer-zone ramp. Implemented as velocity continuation when deltas keep coming at a constant rate, or via **fast-glide momentum** (a short inertial carry after lift, like a trackball, off by default).
- **Keyboard snap turns:** optional ±45°/90°/180° quick-turn keys (Z/X, plus a configurable key) that animate the body turn over about 120 ms. Great for clearing corners without a mouse.
- No aim assist on trackpad or mouse (controller only, §7.4).
- **Typing-suppression detection:** Windows Precision Touchpad's "touchpad sensitivity" setting (and some laptop palm-rejection) **ignores touchpad input while keys are held**. That breaks WASD + trackpad. Detect it (movement keys held, trackpad active, deltas drop to zero) and show a one-time tip on how to change it. Without this, people just think the game is broken.
- **Precision ADS:** a separate, lower trackpad ADS multiplier plus optional **micro-adjust zone** (very slow deltas get extra reduction).

### 7.4 Controller (Gamepad API, standard mapping)
**Sticks:**
- **Radial inner deadzone** (default 0.08, adjustable) plus an **outer deadzone** (0.97) with rescaling so the full range is used. Separate **axial deadzones** (off by default). Anti-deadzone option.
- **Response curve:** exponential/dynamic (default exponent 1.8), linear, or classic presets, plus a **custom curve editor** with a live preview of stick input → turn rate
- **Turn ramp (outer zone):** when the stick is past about 92% for more than 120 ms, yaw speed ramps up to +70% over 250 ms. Ramp delay, time, and boost are adjustable. Precise aiming stays slow, and 180° turns stay fast.
- **Separate hip and ADS sensitivities**, separate yaw and pitch scaling, invert Y
- **Analog movement:** stick deflection maps to walk speed continuously (slow walk ↔ walk), and full deflection plus a click is sprint
- **Analog lean option**

**Aim assist (single-player training, so it's a fun and accessibility tool, not a competitive one):**
- Setting: **Off / Light (default) / Standard**; Hardcore forces Off. **Gamepad only**, never mouse or trackpad.
- **Slowdown:** 25% (Light) / 35% (Standard) lower look sensitivity while the reticle or bore line is over or near a shootable hitbox, smoothstep falloff to nothing 3.5 deg outside the hitbox edge; fades out for full-speed turns.
- **Follow:** while moving and steering, 20% / 35% of the target's line-of-sight angular rate is added (capped at 8 deg/s). No snap-to.
- **ADS magnetism:** on ADS entry a pull of at most 1 / 1.5 deg, spread over ~0.14 s, only toward a target whose centre is inside a 3 deg cone.
- **No-shoots are skipped entirely** (no slowdown, follow or pull) and targets behind walls or other targets are ignored (line-of-sight ray).
- **Leaderboards tag runs** with input type and assist level

**Gyro aiming (big differentiator):**
- The Gamepad API **doesn't expose gamepad motion sensors**. We use **WebHID** (Chromium-only) via libraries like `dualsense-ts` (DualSense) and `webhid-ds4` (DualShock 4), plus Switch Pro / Joy-Con WebHID libraries. The user has to opt in; there's a one-click permission prompt.
- Gyro modes: **always on**, **on while ADS**, or **ratcheting** (hold a button to disable and recenter, like lifting a mouse)
- Gyro space options: local/player/world; sensitivity in real-world-to-in-game ratio; tightening (small-motion damping); smoothing threshold; calibration on stillness
- **Flick Stick** option (RS direction = instant body turn to that direction, rotating the stick = turning); pairs with gyro
- Firefox and Safari: gyro is unavailable, so the UI explains it and hides the option

**Haptics:**
- `vibrationActuator.playEffect('dual-rumble')` per shot (weapon-specific), steel hit "tick," mag seat thunk, door impact
- `trigger-rumble` (Xbox controllers on Chromium/Windows) for trigger break and recoil
- **DualSense adaptive triggers** via WebHID: trigger resistance and break simulation per weapon (pistol vs. rifle vs. shotgun). Stretch goal. A haptics strength slider and off switch.

**Menus:** fully navigable with the controller (focus rings, D-pad/stick navigation, A/✕ confirm, B/○ back, LB/RB tabs).

### 7.5 Input QA matrix
Every milestone is tested on: mouse (Windows Chrome, macOS Safari), MacBook trackpad (Safari, Chrome), Windows precision touchpad (Edge), Xbox Series controller (Chrome, Firefox), DualSense (Chrome with WebHID gyro, Safari). The tutorial must be medal-completable on each.

---

## 8. Content: facilities and targets

### 8.1 Targets
| Target | Behavior | Feedback |
|---|---|---|
| **Paper IPSC/IDPA-style** | A/C/D scoring zones, persistent holes | Flutter, a soft "thup," holes visible in replay |
| **AR500-style steel** | Gongs (swing on chains), **poppers** (fall when momentum above the calibration line exceeds a threshold), **plate rack** (6 plates), **dueling tree**, **Texas star** (spins as plates come off), **swinger**, **Bianchi-style mover** | Procedural steel ring (§9.4), paint splash, Rapier hinge joints |
| **No-shoot** | Paper with hands, or a different color | Penalty, and a distinct sound (no "good" ping) |
| **Activated** | Pressure pads, popper-activated drop-turners and swingers, timed pop-ups | |
| **Breakables** | Clays and bottles at the range | Fun filler |

Poppers use **momentum thresholds**: a 9 mm round may only ring a heavy popper, so caliber choice and barrel length matter.

### 8.2 Facilities (UMBRA CO. Training Facility, fictional)
1. **Square range** (outdoor, 3–50 m): bays, adjustable distances, and a drill menu: Bill Drill, El Presidente, Mozambique, failure drill, reload drills, a Dot Torture-lite, and a Draw (holster) drill. Range neighbors shoot occasionally in other bays (ambient life and audio propagation showcase).
2. **Steel park:** 5 stages (plate rack, 5-to-go, Texas star, popper fields, 100 m gong with an LPVO)
3. **Plywood kill house "A":** no roof, catwalk overhead (great replay angles). Hallways, a T-intersection, center-fed and corner-fed rooms, closed doors, hard corners. Randomized threat and no-shoot placement.
4. **Residential house:** single story; kitchen, living room, hallway, 3 bedrooms, **a tiny bathroom (the organic reverb showcase)**, and a garage. Dim and furnished, so the weapon light matters.
5. **Concrete "tire house"** (2 floors, stairs, mouse-holes, vertical audio): a stretch goal

### 8.3 Level kit and generation
- A modular kit (1 m / 2 m walls, door and window frames, corners, stairs) assembled from **JSON layouts**. Rooms and portals are explicit in the data, and that also feeds the audio system (§9.2).
- **Procedural shoot-house generator** (grid rooms + door graph) and a **daily seed** with a local leaderboard: M5
- An in-game layout editor with seeds shareable in the URL: stretch goal

---

## 9. Audio: matching Bodycam's sound philosophy in Web Audio

**Philosophy:** *real, not cinematic.* No Hollywood sub-boom. Gunshots are pressure events whose character comes from the **space**. Everything is heard **through the CAM04 microphone**.

### 9.1 Gunshot construction
Each shot is assembled from layers:
1. **Mechanical** (close and dry): hammer, bolt carrier, slide, spring twang. Per weapon, round-robin.
2. **Report/crack:** the near-field blast transient (Sonniss / Free Firearm Library sources), chosen by weapon *and barrel length* (shorter = louder, harsher, more concussive)
3. **Pressure layer:** a short low-frequency pulse whose gain and decay are driven by **room enclosure** (§9.2). Huge in a bathroom; nearly gone outdoors.
4. **Early reflections:** 3–8 taps with delay, gain, and filter computed from distances to the nearest surfaces (raycasts)
5. **Late tail:** convolution reverb, choice and blend driven by the room's acoustic parameters
6. **Exterior/escape layer:** an outdoor slapback and echo from openings, routed through portals (§9.3)
7. **Mic stage** (§9.5)

Variation: pitch ±3%, gain ±1.5 dB, round-robin with no immediate repeats, and per-layer randomization.

### 9.2 "Organic reverb" (real-time acoustic analysis)
Two complementary sources of room data:

**A. Authored room graph** (from the JSON layout): every room has volume, floor area, ceiling height, surface materials (absorption coefficients per band), and **portals** (doors and windows with an open/closed state). The doors are dynamic, so portal openness updates live.
- Derived per room: **RT60 via Sabine/Eyring** per frequency band, **bass buildup** for small rooms (low-shelf boost + short modal ringing tuned to the room's axial modes), and **"leakiness"** = open portal area / room surface area. A leaky room vents pressure, so the pressure layer is shorter.

**B. Real-time listener probe** (for smooth indoor↔outdoor and arbitrary geometry): every about 100 ms, cast **24–32 rays** (Rapier) from the listener/shooter.
- **Enclosure** = the fraction of rays that hit within 30 m
- **Mean free path** → reverb size and pre-delay
- **Ceiling height** = the up-ray distance
- **Openness direction** = the average direction of escaping rays (used to pan the exterior layer toward the doorway)
- Results are low-pass smoothed, so walking out a door while firing makes the **indoor tail morph continuously into the outdoor slapback**. No switch.

**Implementation:** a small bank of convolution reverbs (impulse responses generated procedurally at load from RT60 bands: noise × band-limited exponential decays, plus a few CC0 real IRs). Crossfade between 2 active convolvers plus parametric early reflections. That's cheap enough for browsers.

### 9.3 Shockwave propagation, occlusion, and vertical positioning
- **Portal-based propagation** (like rooms-and-portals spatial audio middleware): sound from a source room reaches the listener via the **shortest path through open portals**. Each portal hop adds delay, low-pass, and attenuation, and repositions the apparent source to the **last portal** on the path, so the sound "comes from the doorway." You hear the **blast wave travel down the corridor** and can follow it.
- **Direct occlusion:** if there's no portal path and a wall is in between, the sound goes through a transmission loss filter by wall material (drywall leaks, concrete blocks).
- **Exterior escape:** shots inside a room near an open window or door also emit a delayed, filtered **exterior burst** from the opening, heard by listeners outside. In single-player, it's audible when *you* step out and range neighbors fire indoors, and in replays.
- **Vertical:** HRTF panning (`PannerNode` with `panningModel: 'HRTF'`) plus a floor/ceiling transmission filter so above and below read distinctly
- **Use case in training:** range neighbors in other bays and houses, **"instructor" demo runs** through the kill house (an AI-free scripted ghost firing blanks), and your own echoes returning through doorways

### 9.4 Steel, targets, and the world
- **Procedural steel** (modal synthesis): 4–8 inharmonic partials with frequencies from plate size and thickness, decays from mount type (chain-hung rings long; a popper hinge clanks short). Hit position changes partial weights. Distance adds **speed-of-sound delay** (the 100 m gong *ping* arrives about 0.3 s late), plus air absorption.
- **Ricochet/spall:** short whizz and spit layers, randomized
- **Paper:** a "thup" plus a berm impact (dirt) behind it
- **Brass:** per-surface tinkles, delayed and bounced (instanced physics), plus round-robin samples. **Shotgun hulls** sound different.
- **Mags hitting the floor:** per surface, polymer vs. steel mag
- **Doors:** latch, hinge creak, slam, and kick per door type
- **Ambience:** wind, distant traffic, birds, HVAC hum indoors, fluorescent buzz, and range PA announcements (TTS-free; we record or synthesize short beeps and tones)

### 9.5 Footsteps and the operator's body
- **Surfaces v1: 14 core types** (concrete polished/dusty/damaged/debris, wood plywood/hardwood, carpet, tile, gravel, dirt, grass, metal grate/plate, linoleum), each with 6–10 variants. The goal is to grow toward Bodycam's 38. The material comes from mesh material tags.
- **Pivot/slide scuffs** triggered by sharp direction changes and turn-in-place (velocity-change magnitude → scuff layer)
- **Gear foley:** plate carrier, pouches, sling, mags rattling (count- and speed-dependent), and gloves on the handguard during lean
- **Breathing** tied to stress and exertion (§2.3)

### 9.6 The CAM04 microphone (the "through the camera" stage)
The whole mix goes through a **mic model** before output:
- **Body-borne thumps:** heel strikes, running impacts, and mag slaps on the carrier inject low-frequency thumps and rattle **into the mic bus** (as if it were transmitted through the chest rig and helmet)
- **Dynamic stereo wind:** a band-passed noise per channel (L/R). Gain is driven by movement speed + **yaw rate per side** (turning left = more wind on the left mic) + an outdoor wind field, and **attenuated by enclosure** indoors.
- **Mic response:** a small-capsule EQ (thin lows, peaky presence), **AGC/compressor pumping** after gunshots (the ambience ducks, then breathes back up over about 1 s), and **soft clipping/distortion** on close shots. That's the authentic "clipped bodycam gunshot."
- **Hand on camera** (readjust, §2.1): a low-pass and muffle crossfade, plus a fabric/handling rumble
- **Listening mode:**
  - **"Footage" (default):** you hear exactly what CAM04 records
  - **"Ears + electronic hearing protection":** a cleaner mix with a protective compressor and gate. Mic artifacts are reduced.
  - **"No protection" (Hardcore option):** tinnitus whine and a temporary dulling after indoor shots

### 9.7 Reload and weapon foley
- Every reload beat (§2.4) has its own sound events, timed to the animation beats (mag release click, mag drag out, pouch Velcro or shock cord, mag index, seat, tug, bolt release slam), with **calm vs. stressed variants** (stressed = harder, faster, more rattle) and round-robin
- Weapon handling noise: sling swivels, handguard knocks during lean, safety clicks

---

## 10. Asset strategy (free, no sign-ups for the owner)

### 10.1 Visual
| Need | Source |
|---|---|
| PBR materials | **ambientCG**, **Poly Haven** (CC0, keyless APIs). A build script fetches them, downsizes them, and outputs KTX2 |
| HDRIs | Poly Haven |
| Furniture and props | Poly Haven models, **Kenney** (CC0), **Quaternius** (CC0) |
| Weapons | **Script-generated in Blender** (Python): mid-poly, beveled, PBR, with separated parts (mag, bolt, slide, charging handle, cylinder, triggers) for procedural animation. Started from CC0 references/kits: [Low Poly FPS Rifle & Hands](https://opengameart.org/content/low-poly-fps-rifle-and-hands), [chilly_durango Low Poly Firearms](https://chilly-durango.itch.io/low-poly-firearms), [CC0 Flat Guns East](https://pichuliru.itch.io/cc0-flat-guns-east). Bodycam's filter hides polycount, so the hands are the hero detail |
| Arms, hands, and body | CC0 hands as a base, or a procedurally generated gloved and sleeved arm rig. Full-body lower torso and legs visible on chest cam when looking down (plate carrier, belt, pants, boots), assembled from CC0 kits + generated meshes |
| Animation | **Procedural + data-authored beats** (§2.4). No Mixamo (it needs an Adobe login) |
| Input glyphs | **Kenney Input Prompts** (CC0) |
| Fonts | OFL fonts (e.g., Share Tech Mono / IBM Plex Mono for CAM04 overlay text) |

### 10.2 Audio
1. **Sonniss GameAudioGDC bundles** (royalty-free, no attribution required, unlimited projects) for gunshots, Foley, ambience, and impacts. This is the *primary realism source*.
2. **The Free Firearm Sound Library (CC0):** extra real recorded firearms
3. **Freesound CC0 only:** steel, brass, mags, footsteps
4. **Procedural Web Audio:** steel modal synthesis, mic wind, body thumps, tinnitus, beeps, pressure layer
5. **Own recordings** (optional, later): Foley of mags and gear, which is cheap with a phone. Real reload Foley can be recorded with training or dummy gear.

### 10.3 Licensing plan (Sonniss vs. a temporarily public repo)
The Sonniss license allows sounds **embedded in a project** (a game) but **forbids redistributing them as standalone files** or using them to train AI. A public repo with raw WAVs in it reads as standalone redistribution. A deployed game serving processed audio is normal "embedded in a project" use.

**Plan:**
- **While the repo is public:** commit **no Sonniss files**. The game ships with a CC0 + procedural **"open" sound set** (fully functional). The audio system loads sounds through a **manifest**, so swapping sound sets is a data change, not a code change.
- **Once the repo is private:** add the **"pro" Sonniss sound set** (`assets/audio/pro/`, processed: trimmed, layered, Opus-encoded) to the repo and to the build. CI builds whichever set is present.
- Every file is listed in `assets/ATTRIBUTION.md` (source URL, license, and set). A **CI license check** fails the build if any asset is missing from the manifest, or if a `pro` file is present while the repo is public.
- **Hosting heads-up:** GitHub Pages on a **private** repo requires a paid plan (Pro/Team). Options are in §15.

### 10.4 Pipeline
`tools/assets/` scripts (Node + Blender headless + ffmpeg):
- fetch and convert textures → KTX2; glTF → meshopt/Draco
- audio: normalize (LUFS target per category), trim, generate round-robins, **encode Opus (WebM) + AAC fallback** for Safari
- generate IRs, decal atlases, muzzle-flash flipbooks
- Size budget: audio under 25 MB with the pro set, loaded progressively per facility

---

## 11. UX and menus (normal menus)
- A **conventional, fast menu.** No tablet, no walk-around hub. A clean main menu (Play / Loadout / Footage / Settings) styled with CAM04 typography and a muted contractor palette, with the live 3D range behind it as the background.
- **Play:** Facility → Drill (best time, medal, par) → Loadout quick-pick → GO. Two clicks from boot to the shot timer.
- **Loadout:** a weapon bench view (rotate the 3D gun, part slots with dependency hints, stat deltas, a "try it" button that jumps to the square range)
- **Footage:** saved replays (thumbnail, drill, time, input type). Watch, re-render chest or helmet, export WebM, delete.
- **Settings** (all fully controller-navigable):
  - **Controls:** device tabs (Mouse / Trackpad / Controller / Keyboard), rebinding, hold/toggle per action, sensitivities in real units, curves with live graphs, deadzones, turn ramp, aim assist, gyro setup, haptics
  - **Gameplay:** realism preset and overrides, weapon inertia, camera mount, auto-fix camera
  - **Video:** quality preset, resolution scale, FOV, footage intensity and per-effect toggles, **camera shake**, **gamma calibration** screen, frame cap
  - **Audio:** master/SFX/ambience/mic artifacts, listening mode, HRTF on/off
  - **Accessibility:** stable horizon, reduced flashes, subtitle-style captions for key audio cues, colorblind-safe target paint, high-contrast reticles
- **Onboarding:** a 2-minute "Range Day 1" guided drill covering movement, ready positions, lean, ADS, the reload button's tap/double-tap/hold, mag check, a door, and a first steel ping. Adapts prompts to the active input device.

---

## 12. Technical architecture

### 12.1 Stack
| Layer | Choice |
|---|---|
| Language / build | TypeScript, **Vite** |
| Renderer | **Three.js** (vanilla game loop) |
| Post | `postprocessing` (pmndrs) + custom merged effect shaders |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`): KCC, joints (steel, doors), raycasts (hitscan, audio probes, muzzle tuck) |
| Audio | Web Audio API custom graph (convolvers, `AudioWorklet` for the mic model and modal synthesis) |
| Input | Pointer Lock (raw where available), `wheel`/gesture events, Gamepad API, **WebHID** (gyro and adaptive triggers, Chromium) |
| ECS | `bitecs` or a lightweight custom ECS |
| Animation | Custom IK (two-bone + weapon constraint) + beat-graph player |
| Assets | glTF/GLB (meshopt), KTX2, Opus/AAC |
| Persistence | IndexedDB (replays, PBs, loadouts), `localStorage` (settings) |
| UI | DOM overlay (lightweight, no framework or Preact), with a focus-navigation manager for controller support |

### 12.2 Performance budget (mid-range laptop, 1080p, Medium)
- Under 300 draw calls (instancing for walls, brass, decals), under 1.5 M triangles
- Post under 3 ms. The audio thread stays comfortable with at most 2 active convolvers plus worklets.
- **Fixed 60 Hz sim** with an interpolated render. Input is sampled at render rate and applied to look immediately (not quantized to sim ticks), so aim feels instant.
- Presets: Low / Medium / High / Ultra, plus dynamic resolution scaling with an FPS target

### 12.3 CI/CD (GitHub Actions)
Works on public repos now, and **also on private repos** (the GitHub Free plan includes a monthly Actions minute allowance for private repos).
- **On PR:** lint (ESLint), format check (Prettier), `tsc --noEmit`, unit tests (Vitest), asset license check (§10.3)
- **E2E (Playwright + Chromium, pre-installed in CI images):** boot the game, load each facility, run scripted drills via a **test input driver** (injecting actions, not DOM events), and assert scoring
- **Screenshot suite:** capture each facility, the menu, a replay frame, and each post-effect toggle. Upload as artifacts plus an HTML contact sheet. Optional visual diff vs. main (tolerant threshold, since GPU output differs).
- **Perf smoke:** headless frame-time sampling on a fixed camera path (trend tracking, not a hard gate, since CI GPUs are software-rendered)
- **Determinism test:** record a drill, re-simulate, and assert an identical final state hash (protects the replay system)
- **On main:** build + deploy (§15)

### 12.4 Replay system
- Deterministic fixed-step sim. Logs per-tick actions plus a seed. Physics determinism comes from Rapier's deterministic mode with fixed ordering.
- Replays are small (KBs), stored in IndexedDB, and shareable as a file
- Re-render: chest/helmet/free cam/split. **Export:** `canvas.captureStream()` + `MediaRecorder` (WebM VP9/Opus, or MP4 where supported) at a fake 30 fps "camera" cadence, with the CAM04 overlay burned in. Filename: `CAM04_UMBRA_0412_2026-10-19_143207.webm`.

---

## 13. Milestones
| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0: Spike (1–2 wk)** | Vite + Three + Rapier scaffold, CI (lint/type/test/Playwright screenshot), KCC, **input action layer with mouse + controller + trackpad preset**, grey-box range, SB-16 hitscan | Walk and shoot on all three input types. CI posts screenshots |
| **M1: The Feel (3–4 wk)** | Chest cam rig + full CAM04 post stack, **body-first aim + weapon lag springs**, sway, lean, ready positions, muzzle tuck, procedural reload beats (tac/speed, calm/stressed, 2 variants each), **Reload button tap/double/hold + ammo HUD**, gunshot layers + organic reverb v1 (probe-based) + mic stage, procedural steel, open sound set | A 30 s range clip looks *and sounds* like real footage. Blind test: 5 people prefer the weapon feel at the default inertia over 0% |
| **M2: Range content (2–3 wk)** | Square range + drill menu, shot timer + scoring + medals, paper zones, steel suite, KP-9, P-17, R-357 (per-count reloads), PM-12, mag inventory, normal menus, settings v1, gyro (WebHID) | 8+ drills; tutorial medal-able on every input type in the QA matrix |
| **M3: Shoot houses (3–4 wk)** | Modular kit + room/portal graph, Kill House A, residential house, doors, weapon light, penetration, no-shoots, randomized placement, **portal propagation + room-graph reverb**, footsteps (14 surfaces + scuffs), camera knock/fix | Full house clear with timer and penalties. Bathroom-vs-living-room audio difference is obvious |
| **M4: Footage & polish (2–3 wk)** | Deterministic replay, scrub, helmet re-render, WebM export, loadout bench + attachments + dependencies, LPVO (hybrid magnification), offset dots, K-47S, perf pass, accessibility | Meets perf budget; export works in Chrome and Firefox |
| **M5: Replayability (stretch)** | Shoot-house generator + daily seed, tire house, layout editor, more surfaces (→38), "pro" Sonniss set (once private), adaptive triggers, RC car recon drill, flashbang training | |

---

## 14. Risks and mitigations
| Risk | Mitigation |
|---|---|
| Weapon lag feels floaty or "drunk" | View is always immediate; only the weapon lags. Short, mass-based half-lives; a master slider; A/B tests in M1 |
| Trackpad play is inherently limited | Dedicated preset, acceleration kept, edge-glide turning, snap turns, optional slowdown, typing-suppression detection. Measure medal-completion parity |
| Gyro is Chromium-only (WebHID) | Treated as an enhancement; stick play is fully tuned on its own |
| Procedural reloads look robotic | Beat variants + noise + secondary motion; a dev timeline tool for fast iteration; own phone video reference |
| Web Audio CPU cost (convolvers, worklets) | At most 2 convolvers crossfaded, parametric early reflections, voice limits, an audio quality tier |
| Fisheye and shake cause motion sickness | Camera shake slider, stable horizon, FOV, helmet/chest choice, footage intensity |
| Sonniss licensing on a public repo | Open and pro sound sets; the CI guard keeps pro files out while the repo is public (§10.3) |
| Pages hosting once the repo is private | Decide host in §15 |
| Browser quirks (pointer lock, autoplay, Safari codecs, `unadjustedMovement`) | A click-to-start gate unlocks audio and pointer lock; feature detection; QA matrix |
| Contractor theme sensitivity | Training facility only, fictional company, paper and steel targets |

---

## 15. Open questions
1. **Hosting after going private:** deferred by the owner. Options remain GitHub Pro, a free Cloudflare/Netlify account, or a separate public deploy repo with built files only.
2. ~~Trackpad swipe lean~~: decided, lean is Q/E only.
3. ~~Aim assist default~~: decided, Light slowdown on Standard.
4. ~~Roster~~: decided, SBR-focused (SB-16, HB-300, K-47S, P-17; KP-9/R-357/PM-12 later).
5. ~~Company~~: decided, UMBRA CO.

## 16. Sources
- Reissad Studio, *Bodycam: Locked and Loaded* devlogs (animations/loadouts/UI/gadgets; sound design; final/systems), provided by the project owner
- [80.lv: Bodycam update](https://80.lv/articles/an-update-on-bodycam-a-hyperrealistic-ue5-powered-shooter-game/) · [80.lv: playtest](https://80.lv/articles/bodycam-a-ue5-powered-fps-with-hyperrealistic-graphics-is-inviting-playtesters/) · [Superjump: Bodycam's perspective](https://www.superjumpmagazine.com/bodycams-unique-perspective-demands-your-attention/) · [ExitLag guide](https://www.exitlag.com/blog/how-to-play-bodycam/) · [Steam: no ammo UI thread](https://steamcommunity.com/app/2406770/discussions/0/4339861336970587914) · [Fab bodycam PP pack (effect reference)](https://www.fab.com/listings/cc5f9ed8-de14-4a59-996a-68744a2df36e)
- [Segments.ai: simulating real cameras in Three.js](https://segments.ai/?p=4869) · [three.js forum: chromatic aberration](https://discourse.threejs.org/t/chromatic-aberation/20044)
- [W3C gamepad: motion sensors discussion](https://github.com/w3c/gamepad/issues/211) · [dualsense-ts](https://cdn.jsdelivr.net/npm/dualsense-ts@6.15.0/README.md) · [webhid-ds4](https://www.npmjs.com/package/webhid-ds4) · [Joy-Con WebHID](https://www.npmjs.com/package/joy-con-webhid)
- [MDN: MouseEvent.ctrlKey (pinch → wheel + ctrlKey)](https://developer.mozilla.org/en/dom/event.ctrlkey) · [W3C UI Events: trackpad vs. mouse wheel](https://lists.w3.org/Archives/Public/public-webapps-github/2022Dec/0534.html)
- [Kenney Input Prompts](https://kenney.nl/assets/input-prompts-pixel-16) · [OpenGameArt Input Prompts (CC0)](https://opengameart.org/node/159839)
- [The Free Firearm Sound Library (CC0)](https://opengameart.org/content/the-free-firearm-sound-library) · [Sonniss GDC 2026 bundle](https://rekkerd.org/sonniss-releases-gdc-2026-game-audio-bundle/) · [Sonniss license summary](https://licenseorg.com/guide/music-audio/sonniss)
- [Free game assets guide (Poly Haven, ambientCG, Quaternius, Kenney)](https://app.cinevva.com/guides/game-assets-guide.html) · [Low Poly FPS Rifle & Hands](https://opengameart.org/content/low-poly-fps-rifle-and-hands) · [Low Poly Firearms](https://chilly-durango.itch.io/low-poly-firearms) · [CC0 Flat Guns East](https://pichuliru.itch.io/cc0-flat-guns-east)
- [sbcode: Rapier + three.js](https://sbcode.net/threejs/physics-rapier/) · [Codrops: physics character controller](https://tympanus.net/codrops/2025/05/28/building-a-physics-based-character-controller-with-the-help-of-ai/)
- [GitHub Docs: Pages availability by plan](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 17. Glossary
**CQB:** close-quarters battle · **Shoot/kill house:** a modular building for live-fire room clearing · **AR500:** hardened steel target plate · **Popper:** steel target that falls when hit above its calibration line with enough momentum · **Plate rack / Texas star / dueling tree:** classic reactive steel setups · **Tac vs. speed reload:** keep vs. dump the partial mag · **Hit factor:** points ÷ time · **Mechanical offset:** sight-over-bore height · **LPVO:** low-power variable optic (1–6×) · **Offset dot:** a small red dot mounted at 45° · **RT60:** time for reverb to decay 60 dB · **Portal:** an opening (door or window) connecting rooms in the audio graph · **KCC:** kinematic character controller · **WebHID:** browser API for raw HID devices (gyro, adaptive triggers)
