# CQB Browser: Product Requirements Document

**Working title:** CQB Browser (placeholder)
**Platform:** Desktop web browser (Chrome, Edge, Firefox, Safari 17+), Three.js / WebGL2
**Status:** Draft v0.1, 2026-10-19
**Scope of this PRD:** Single-player training content: shooting ranges, steel-plate courses, and shoot houses.

---

## 1. Vision

A browser-based, close-quarters shooter that borrows the *look and feel* of Reissad Studio's **Bodycam**: a chest-mounted, wide-angle, slightly ugly "real footage" camera, no HUD, heavy weapon handling. It is tuned to be **fun to replay**, not a punishing milsim.

The first release is a **training facility**: square ranges, steel-plate courses, and kill-house runs against a timer. That's the part of CQB that's fun on its own, it needs no AI or netcode, and it makes us get the core feel right (camera, movement, gunplay, sound) before we build anything else.

> **Feel target:** "That looks like real helmet-cam footage of a shoot-house run, and I want to beat my time."

### 1.1 Design pillars

1. **The camera sells it.** A bodycam lens, motion, and image pipeline are the identity of the game. Every visual decision serves "this looks like footage."
2. **Weight, not friction.** The gun and body feel heavy and physical: inertia, sway, real reload steps. Controls stay responsive. If something only adds tedium, cut it.
3. **Sound is information.** Gunshots, steel pings, and room reverb tell you what happened, since there's no HUD.
4. **Short, replayable runs.** 20–90 second drills with timers, scoring, and ghost replays. "One more run."
5. **Zero-cost, zero-friction assets.** Everything is CC0, generated, or procedural. No paid assets, accounts, or API keys.

### 1.2 Non-goals (for this phase)

- Multiplayer and netcode
- Hostile AI and enemy combat (only static and moving targets)
- Gore, civilians, or real-world police/violence scenarios. This phase is a training facility.
- Mobile/touch support
- Real-world brand names or trademarks on weapons (use generic names like "M4-pattern carbine")

---

## 2. Research summary: what Bodycam does

Bodycam (Reissad Studio, UE5, Steam Early Access since June 2024) is known for:

| Trait | What Bodycam does | What we take |
|---|---|---|
| Camera | Chest-mounted, fisheye/wide-angle view with barrel distortion, chromatic aberration, sharpening, and compression artifacts; the camera sways with the body | **Yes, core.** Rebuilt as a Three.js post-process stack (§5) |
| HUD | None: no crosshair, ammo counter, or minimap | **Yes, by default**, with an optional "Assist" mode for new players |
| Gunplay | Realistic ballistics, procedural recoil, one-shot headshots | Procedural recoil and hit zones on targets; simplified ballistics |
| Reloads | Multiple reload variations depending on the situation. Under stress, hands shake and you can fumble. Revolver reload time scales with rounds fired | **Yes.** Tactical, emergency, and partial reloads; stress affects speed and accuracy (§6.4) |
| Movement | Slow and deliberate, with leaning as a core technique | Lean, walk, low/high ready, crouch; sprint is short and costly |
| Modes | PvP-focused (TDM, Wingman, etc.) plus co-op zombies | Not in this phase; we focus on training |

The common criticism is that it's hard to read and hard to play. Our "fun" lever is that ranges and shoot houses give you **clear goals and instant feedback** (time, hits, ping sounds), so the realistic presentation never leaves you confused.

Sources: [80.lv – Bodycam update](https://80.lv/articles/an-update-on-bodycam-a-hyperrealistic-ue5-powered-shooter-game/), [80.lv – playtest](https://80.lv/articles/bodycam-a-ue5-powered-fps-with-hyperrealistic-graphics-is-inviting-playtesters/), [Superjump – Bodycam's perspective](https://www.superjumpmagazine.com/bodycams-unique-perspective-demands-your-attention/), [ExitLag beginner guide](https://www.exitlag.com/blog/how-to-play-bodycam/), [Steam discussion: no ammo UI](https://steamcommunity.com/app/2406770/discussions/0/4339861336970587914), [Fab bodycam PP pack (effect reference)](https://www.fab.com/listings/cc5f9ed8-de14-4a59-996a-68744a2df36e).

---

## 3. Target player and success metrics

**Players:** FPS fans who've seen Bodycam or helmet-cam clips, enjoy timed challenges (Ready or Not / Ground Branch / speedrun crowd), and want a no-install, click-and-play browser game.

**Success metrics (v1):**
- Time to first shot under 15 seconds from page load on a warm cache (under 30 seconds cold)
- At least 60% of players who finish one drill start a second one
- Median session of 10 minutes or more
- 60 FPS at 1080p on a mid-range laptop GPU (Intel Iris Xe or M1 class), 120 FPS or more on discrete GPUs
- First playable download under 40 MB; later content streamed

---

## 4. Core loop

```
Choose facility → choose drill → choose loadout → START buzzer
   → move, clear, engage targets → final target / exit line → timer stops
   → score screen (time, hits, penalties, rank) → replay (bodycam footage!) → retry
```

**Scoring** borrows from practical shooting (USPSA/IDPA-style, simplified):
- Paper: A/C/D zones (5/3/1 points), plus misses and no-shoot penalties
- Steel: must fall or ring; each one is a hit or a miss
- Time plus penalties gives the final time. Hit factor (points ÷ time) for the score-based modes
- Medal thresholds per drill (Bronze, Silver, Gold, "Instructor")
- Local leaderboard and personal bests stored in `localStorage`/IndexedDB

**The killer feature: footage replay.** Every run is recorded as an input/state log (not video) and replayed through the bodycam pipeline. Players can scrub, watch from a free camera, and export a WebM clip with the `MediaRecorder` API. That's the shareable "bodycam clip," and it costs nothing to host.

---

## 5. Camera and visual presentation (the core)

### 5.1 Camera rig
- The camera mounts at **chest height** (about 1.35 m), offset from the eye line (about 1.65 m). Aim comes from the eye/weapon line, but the view comes from the chest. That's the signature Bodycam look: the gun sits low and big in frame, and you see your hands.
- Wide vertical FOV (about 95–110°, adjustable), then fisheye remap in post
- **Body-coupled motion:** the camera is a spring-damper attached to the torso. It picks up footstep bob, turn lag, lean roll, and recoil impulse. Frequencies and amplitudes are tunable, and an accessibility "stable cam" slider scales them down.
- Optional **helmet-cam** mode (eye-line mount) for players who find chest cam disorienting

### 5.2 Post-processing stack (custom `EffectComposer`/`pmndrs/postprocessing` passes)
Applied in order:
1. **Barrel/fisheye distortion** (OpenCV-style k1/k2 radial model) with edge stretch
2. **Radial chromatic aberration**, stronger toward the edges
3. **Auto-exposure / eye adaptation** with lag, so you blow out briefly stepping into sunlight and crush blacks in dark rooms (the classic cheap-sensor look)
4. **Sensor noise and grain**, luminance-dependent (more in the dark)
5. **Sharpen / unsharp mask** for over-processed digital footage
6. **Compression artifacts:** subtle 8×8 block quantization and chroma subsampling, spiking briefly during fast motion (fake bitrate starvation)
7. **Rolling-shutter skew** during fast yaw (subtle; off by default on "Low")
8. **Lens dirt / smudge** texture lit by bright sources, plus vignette
9. **Muzzle-flash bloom** that briefly clips the sensor
10. **Overlay (optional):** a timestamp and "AXON-style" generic unit ID text burned into a corner. It's diegetic, so it doesn't break the no-HUD rule. Use a generic name only.

Each pass has a quality tier. "Footage intensity" is a single user-facing slider (0–100%).

### 5.3 Rendering
- Three.js (r17x+, WebGL2; a WebGPU renderer path is a stretch goal)
- PBR materials. Baked lightmaps for shoot houses (Blender → glTF, or generated in-engine at build time), plus a few dynamic lights for weapon lights and muzzle flash
- Real-time shadows from at most 1–2 lights; everything else baked
- HDRI sky for outdoor ranges (Poly Haven CC0)
- Decals: bullet holes in paper, drywall, wood, and concrete; paint scuffs on steel (pooled `DecalGeometry` or a projected decal atlas)
- Particles: muzzle flash (sprite flipbook plus light), ejected brass (instanced, physics-lite), drywall dust puffs, steel spark/spall, smoke wisps

### 5.4 Weapon light
- A toggleable spotlight with a cookie texture. Essential in dark shoot-house rooms, and it looks great through the fake sensor.

---

## 6. Gameplay systems

### 6.1 Movement
| Action | Default key | Notes |
|---|---|---|
| Walk | WASD | Default pace is a combat walk (about 1.6 m/s) |
| Slow walk | Hold Alt or C | About 0.8 m/s; steadier aim, quieter |
| Jog/sprint | Shift | About 4.5 m/s; weapon goes to low ready, aim unavailable, short ramp |
| Crouch | Ctrl (toggle/hold) | |
| Lean L/R | Q / E | Smooth, analog-feeling, about 25° roll plus lateral offset; works while moving |
| High/low ready | Mouse wheel or X | Weapon position affects sway and how quickly you can get to ADS |
| Aim (ADS) | RMB | Brings the weapon up to the eye line; the chest-cam view stays put but the gun rises into frame and the sight becomes usable |
| Fire | LMB | |
| Reload | R (tap or hold, see §6.4) | |
| Weapon light | T | |
| Switch primary/sidearm | 1 / 2 | Real holster/sling transition times |
| Mag check / chamber check | Hold R (when full) / hold F | Replaces the ammo counter (§6.5) |
| Open door / push | F | Doors are physics-hinged; you can kick-swing them |
| Restart drill | Backspace (hold) | Instant retry is critical to the fun |

- Kinematic capsule controller with step-up, slope limits, and crouch-height collision
- **Inertia:** acceleration and deceleration curves (about 150 ms to full speed) and turn-rate influence on weapon sway. Feels heavy but stays responsive.
- Stamina is light: sprinting raises "stress/heart rate" (§6.4) instead of draining a bar

### 6.2 Weapons (v1 roster: generic, real-world-inspired)
| Slot | Weapon | Notes |
|---|---|---|
| Primary | M4-pattern 5.56 carbine | Semi/auto, red dot or holographic sight, 30-round mags |
| Primary | 9 mm PCC / MP5-style SMG | Low recoil; good for new players |
| Primary | Pump 12 ga shotgun | Tube reload one shell at a time, can be interrupted; pellets vs. steel |
| Sidearm | Glock-pattern 9 mm pistol | 17-round mags; red dot optional |
| Sidearm | .357 revolver | Speedloader or single-round partial reloads (like Bodycam) |

**Attachments (v1, simple):** optic choice (iron, red dot, holo, low-power variable 1–6×), weapon light, foregrip (less recoil, slower ADS). Attachments mount on rails at `Object3D` sockets.

### 6.3 Gunplay
- **Hitscan with simple ballistics:** instant ray for under 100 m, which covers everything in CQB and ranges. Accounts for **sight-over-bore offset** (mechanical offset matters at 3 m; it's real, educational, and a fun "pro" detail).
- **Penetration:** wallbang through drywall and doors (damage and penetration scale by material); concrete, steel, and brick stop the round.
- **Procedural recoil:** a per-weapon impulse model (vertical climb, horizontal wander, roll, rearward kick) applied to a spring system on the weapon *and* the camera. Recovery springs back toward the original point of aim, so good recoil control means trigger discipline, not pulling the mouse.
- **Sway:** breathing, movement, and stress drive Perlin-noise sway. Lower in slow walk and crouch.
- **Malfunctions (toggle, off by default):** rare failure to feed. Clear with tap-rack (hold R + F).

### 6.4 Reloads and stress
Reloads are fully **procedural animation chains** (§7.3), so they can vary and be interrupted:

| Reload | Input | Behavior |
|---|---|---|
| **Tactical (retention)** | Tap R with rounds in the gun | Swap mag, keep the partial mag in your pouch. Slower |
| **Speed / emergency** | Tap R on empty, or double-tap R | Drop the mag on the floor (it stays there and is visible in replay). Fastest. On empty, it includes a bolt release or slide release |
| **Partial (revolver/shotgun)** | Tap R repeatedly | Load individual rounds; fire at any time to interrupt |

- **Mag inventory is real:** each magazine tracks its own round count. A tactical reload can bring a half-empty mag back later. You learn your round count by mag check (§6.5), not a number on screen.
- **Stress (0–1):** goes up from sprinting, a shot timer near par, and rapid fire. It goes down when you're still or slow-walking. High stress means faster reloads but more hand shake and sway, and at high stress there's a **small chance of fumbling** (the mag misses the well and you re-seat it, +0.4 s). Visible only through the camera (breathing audio, slight shake), never as a UI bar.
- **Fun guardrail:** a "Realism" setting (Arcade / Standard / Hardcore) toggles fumbles, HUD assist, and mag tracking strictness.

### 6.5 No-HUD information
- **Mag check:** the character tilts the mag or pulls it partway. The camera shows an approximate count ("feels about half," or a precise count with a translucent-mag model).
- **Chamber check:** press-check animation
- **Bolt locked back** on empty is visible on the model
- The shot timer beeps start and stop (diegetic, like a real shot timer). An optional wrist-mounted timer is visible when you raise your arm (hold V).
- **Assist mode** (accessibility/new players): minimal dot, ammo pips, and drill objective text

---

## 7. Content: facilities and targets

### 7.1 Targets
| Target | Behavior | Feedback |
|---|---|---|
| **Paper IPSC/IDPA-style** | A/C/D scoring zones; bullet holes persist | Paper flutter, holes visible, score on review |
| **AR500-style steel plates** | Static gongs (swing on chains), **poppers** (fall when hit hard enough above the calibration line), plate racks (6 plates, fall left/right), dueling tree (paddles swap sides), **Texas star** (spins as plates are shot off) | Strong *ping* plus ring-out decay that depends on plate size and distance; paint splash; physical swing via Rapier hinge joints |
| **No-shoot** | Paper with hands or a different color | Penalty |
| **Moving** | Rail-driven swingers, drop-turners, popup targets activated by stepping on a pressure pad or hitting a popper | |
| **Clay/bottle** | Fun secondary breakables at the range | |

Steel uses a **force threshold** model: popper knockdown requires momentum above a per-plate value, so 9 mm at a heavy popper may only ring it. That's realistic and makes caliber choice matter.

### 7.2 Facilities (v1 maps)
1. **Square range (outdoor, 7–50 m):** bays with paper and steel, adjustable target distance, and a free-practice drill menu (Bill Drill, El Presidente, Mozambique, failure-to-stop, reload drills, Dot Torture-lite)
2. **Steel challenge park:** 5 classic-style stages (plate rack, 5-to-go, Texas star, poppers, long-range gong at 100 m with the LPVO)
3. **Plywood shoot house ("Kill House A"):** modular, no roof (catwalk overhead view for replays). Corners, hallways, a T-intersection, center-fed and corner-fed rooms, a closed door, and a hard corner. Paper threats and no-shoots, randomized per run.
4. **Residential house:** a single-story suburban home (kitchen, living room, hallway, 3 bedrooms, garage). Furnished, dim interior, weapon light useful. Randomized target placement. This is where the bodycam aesthetic shines.
5. **Multi-floor "tire house":** concrete, two floors, stairs, mouse-holes. A stretch goal for v1.

### 7.3 Level generation and authoring
- Shoot houses use a **modular kit** (wall segments 1 m / 2 m, door frames, windows, corners) assembled from a JSON layout. That makes it easy to add a **procedural shoot-house generator** (rooms from a grid plus door graph) for infinite replay. **Daily seed** challenge with a shared seed and a local leaderboard.
- Hand-authored layouts are JSON plus an in-game **simple editor** (stretch goal): place walls and targets, then share them as a URL-encoded seed.

---

## 8. Audio (realism priority #1 after the camera)

### 8.1 Engine
- **Web Audio API** directly (or Howler.js for loading only) with a custom mixer graph:
  - **Layered gunshot:** *mechanical* (close, dry: bolt, hammer) + *body* (the crack/boom) + *tail* (environment-specific reflection layer chosen by space: outdoor, small room, hallway, large room) + *low-end thump*
  - **Convolution reverb** per acoustic zone, with impulse responses generated procedurally at build time (from room dimensions → exponential-decay noise IR) or from CC0 IR libraries
  - **Indoor vs. outdoor detection** from zone volumes, crossfaded on transition
  - Distance filtering (high-frequency rolloff), plus speed-of-sound delay for the far steel *ping* at long range (hearing the ping arrive late at 100 m is a great detail)
  - **Ear protection mode:** electronic hearing protection (a range-safe compressor with gating) vs. no protection (tinnitus whine plus low-pass after indoor shots). A toggle; this reads as very authentic.
  - Randomized pitch and volume per shot, and round-robin samples to avoid machine-gun repetition
- **Foley:** footsteps by surface material (concrete, wood, carpet, gravel, tile), gear rattle scaled to speed, breathing tied to stress, clothing rustle on lean and turn
- **Weapon foley:** mag out/in, bolt release, charging handle, slide rack, revolver cylinder, shotgun shell insert, mag hitting the floor (by surface), brass tinkle (by surface, delayed and randomized)
- **Steel:** ping and ring by plate size and steel thickness, popper fall clank, chain rattle on gongs
- **Paper:** soft *thup* plus impact on the backstop berm

### 8.2 Sound sourcing (all free, no accounts required for the end user)
Priority order:
1. **The Free Firearm Sound Library (CC0)**: real recorded rifle, pistol, shotgun, revolver, and automatic fire. [OpenGameArt listing](https://opengameart.org/content/the-free-firearm-sound-library). This is the gunshot backbone.
2. **Freesound.org, CC0-filtered only**: steel pings, casing drops, mag foley, footsteps, ambience. We'll keep a manifest (`assets/ATTRIBUTION.md`) with source URLs even though CC0 doesn't require it.
3. **Kenney / OpenGameArt CC0 packs** for UI and impact fillers
4. **Procedural synthesis (Web Audio)** for things where generated sound is as good or better: steel ring (modal synthesis with a few inharmonic partials plus exponential decay, parameterized by plate size, so infinite variation), tinnitus, shot-timer beeps, rattle and noise layers, brass tinkles (short modal "pings")
5. **Sonniss GDC bundles**: royalty-free, no attribution required, but the license doesn't permit redistributing raw files. Use them only if the repo stays private or the files are baked into the game build. **Default: avoid**, so the repo can be public.

Processing: all sources normalized, trimmed, and converted to **Opus in a WebM/OGG container** (AAC fallback for Safari) by a build script (ffmpeg). The audio budget is under 15 MB for v1.

---

## 9. Art and asset strategy (free, no sign-ups)

| Need | Source | Notes |
|---|---|---|
| PBR materials (plywood, concrete, drywall, carpet, dirt, steel) | [ambientCG](https://ambientcg.com) and [Poly Haven](https://polyhaven.com) (CC0, keyless APIs) | A build script fetches and downsizes them to 1K/2K and converts to KTX2 (Basis) |
| HDRI skies | Poly Haven (CC0) | |
| Furniture and props for the residential house | Poly Haven models (CC0), Kenney Furniture Kit (CC0), Quaternius (CC0) | Swap in higher-fidelity versions over time |
| Weapon models | **Procedurally built in code / authored in Blender with scripts** + CC0 starting points: [Low Poly FPS Rifle & Hands (CC0)](https://opengameart.org/content/low-poly-fps-rifle-and-hands), [chilly_durango Low Poly Firearms (CC0)](https://chilly-durango.itch.io/low-poly-firearms), [CC0 Flat Guns East (GLB)](https://pichuliru.itch.io/cc0-flat-guns-east) | Weapons need **separated parts** (mag, bolt, slide, trigger, cylinder) for procedural animation. Plan: a Blender Python script generates mid-poly, beveled, PBR-textured weapons from part specs, so they're sharp enough to read through the bodycam filter, which conveniently hides low detail |
| First-person arms and hands | CC0 hands from the rifle pack above, or a procedurally generated rigged arm mesh (gloved, sleeved, with simple cylinder skinning) | Gloves and sleeves hide the uncanny parts. Rigged for **IK** |
| Animations | **Procedural, no Mixamo** (Mixamo needs an Adobe login): two-bone IK hands attached to weapon grips, plus keyframed pose tracks written as data (mag-out → pouch → insert → bolt release) with easing and per-run noise | Procedural animation is also what makes stress variation and interrupts possible |
| Steel targets, paper targets, stands, barricades | Generated in code (simple geometry plus decals) | Trivial, and they look great |
| Decals and flipbooks (muzzle flash, impacts, holes) | Generated (offline canvas/shader bake) + Kenney particle pack (CC0) | |
| Fonts | Google Fonts / OFL (e.g., "Share Tech Mono" for the timestamp overlay) | |

**Licensing rule:** only CC0 or code-generated assets are committed. Every external file gets an entry in `assets/ATTRIBUTION.md` with its URL and license. A CI check fails the build if any file in `public/assets` is missing from the manifest.

---

## 10. Technical architecture

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | |
| Build | **Vite** | Fast HMR; handles WASM for Rapier |
| Renderer | **Three.js** (vanilla, no React Three Fiber for the game loop) | Full control over the frame loop and post-processing order |
| Post | `postprocessing` (pmndrs) + custom shader passes | Effect merging is cheaper than the built-in `EffectComposer` |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Character controller (`KinematicCharacterController`), joints for steel and doors, raycasts for hitscan |
| Audio | Web Audio API, custom mixer | §8 |
| Input | Pointer Lock API + raw mouse (`unadjustedMovement: true` where supported) | No mouse acceleration; crucial for aim feel |
| ECS | Lightweight custom or `bitecs` | Targets, decals, brass, doors |
| Assets | glTF/GLB + Draco/meshopt compression, KTX2 textures | |
| Persistence | IndexedDB (replays, PBs), `localStorage` (settings) | No backend |
| Hosting | Static: GitHub Pages / Cloudflare Pages (free) | |
| Replay | Fixed-timestep simulation (60 Hz) + deterministic input log → re-sim. `MediaRecorder` + `canvas.captureStream()` for WebM export | Replays become tiny JSON blobs that are shareable via URL hash |

**Performance budget (mid-range laptop, 1080p):**
- Under 300 draw calls (instancing for brass, decals, and modular walls)
- Under 1.5 M triangles on screen
- Post-processing under 3 ms total at "Medium"
- Fixed 60 Hz simulation with an interpolated render step. Render uncapped or synced to vsync.
- Quality presets: Low / Medium / High / Ultra, plus resolution scale (50–100%)

---

## 11. UX and menus
- **Main menu** styled as a range-office clipboard / tablet (diegetic-lite)
- Flow: Facility → Drill → Loadout → Settings shortcut → GO
- **Settings:** sensitivity (cm/360 shown), FOV, footage intensity, camera mount (chest/helmet), stable cam, realism preset, audio (master/SFX/ambient, ear-pro mode), keybind remapping, quality preset
- **Score screen:** time, hits breakdown, penalties, splits per target (the shot timer records every shot), medal, PB delta, buttons for [Retry] [Watch footage] [Export clip] [Next drill]
- **Onboarding:** a 90-second guided "range day" tutorial on the square range covering movement, lean, ready positions, reloads, and mag checks

---

## 12. Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0: Spike (1–2 wk)** | Vite + Three + Rapier scaffold, capsule controller, pointer lock, a grey-box range, one gun (carbine) with hitscan + procedural recoil, a placeholder shot sound | Can walk, shoot, and see holes |
| **M1: The Feel (2–3 wk)** | Chest-cam rig + full bodycam post stack, weapon sway/inertia, lean, ready positions, procedural reload chain (tac + speed), layered gunshot audio + room reverb, steel gong + popper with procedural ping | A 30-second clip of the range "looks like footage" and people want to play it |
| **M2: Range content (2 wk)** | Square range + drill menu, shot timer + scoring, paper zones, plate rack, Texas star, pistol + revolver + shotgun, magazine inventory, mag check | 6+ playable drills with medals |
| **M3: Shoot houses (3 wk)** | Modular kit, Kill House A, residential house, doors, weapon light, wallbang, no-shoots, randomized placement | Full house clear with timer and penalties |
| **M4: Replay & polish (2 wk)** | Deterministic replay, scrub + free cam, WebM export, settings, onboarding, quality presets, perf pass | Meets perf budget; replay export works in Chrome/Firefox |
| **M5: Replayability (stretch)** | Procedural shoot-house generator + daily seed, simple layout editor, tire house | |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free CC0 gun audio quality and variety are limited | Layer CC0 recordings with procedural synthesis plus convolution reverb. Most realism comes from the *tail/reflections*, not the dry shot |
| CC0 weapon models are too low-poly | The bodycam filter hides detail. Use script-generated beveled models, and make the hands and gloves the hero detail |
| Procedural reload animation looks robotic | IK + eased keyframes + per-run noise + secondary motion (springs on the camera and hands); iterate early in M1 |
| Fisheye and camera sway cause motion sickness | Stable-cam slider, helmet-cam mode, FOV slider, intensity slider. Defaults tuned conservatively |
| Browser performance across GPUs | Quality tiers, baked lighting, instancing, KTX2, profile early, resolution scaling |
| Pointer-lock and audio-autoplay quirks | A "click to start" gate unlocks the AudioContext and pointer lock together |
| Safari WebGL/Opus quirks | AAC fallback, test Safari at each milestone |
| Sensitive subject matter (police bodycam framing) | The framing is a **training facility** with paper and steel only; no real agencies, branding, or human victims |

---

## 14. Open questions (please answer; defaults assumed in brackets)

1. **Realism vs. arcade default:** should the default preset be "Standard" (some assists, fumbles off) or "Hardcore" (true Bodycam: no HUD at all)? *[Standard]*
2. **Theme / framing:** private tactical training facility, police academy, or military? It affects the art direction of maps and the overlay text. *[Neutral private training facility]*
3. **Future direction:** is hostile AI (Ready or Not–style room clearing) or multiplayer the next phase after training? That changes how early we invest in netcode-friendly determinism vs. AI navmeshes. *[AI first; keep sim deterministic anyway]*
4. **Weapons:** is the 5-weapon roster above right? Any must-haves (AK-pattern, suppressors, LPVO, rifle-caliber shoot houses vs. pistol-only)? *[Roster as listed, suppressors as stretch]*
5. **Camera:** chest cam only, or chest + helmet toggle? *[Both; chest default]*
6. **Public repo?** If yes, we strictly avoid Sonniss and other non-redistributable sources. *[Yes, public, CC0-only]*
7. **Gamepad support** in v1? *[No; keyboard/mouse only]*
8. **Name:** keep "CQB Browser" or pick a title? *[Placeholder]*
9. **Hosting:** GitHub Pages from this repo OK? *[Yes]*

---

## 15. Glossary
- **CQB:** close-quarters battle
- **Shoot house / kill house:** a modular building for live-fire room-clearing practice
- **AR500 steel:** hardened steel plate used for reactive targets
- **Popper:** steel target that falls when hit with enough momentum above its calibration zone
- **Plate rack / Texas star / dueling tree:** classic reactive steel target arrangements
- **Tac reload vs. speed reload:** keep the partial mag vs. drop it for speed
- **Hit factor:** points ÷ time (practical shooting scoring)
- **Mechanical offset:** the height difference between the sight and the bore, which matters at close range
