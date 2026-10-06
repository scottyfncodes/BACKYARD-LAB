# Backyard Lab

A kid has a real problem. What ridiculous machine can they build from the junk in the backyard to solve it?

Backyard Lab is a first-person backyard engineering sandbox for the browser, built mobile-first and installable as a PWA. This repo holds the **vertical slice**: one backyard, 25 kinds of junk, four projects, Mom's old physics textbook, and a physics engine that judges only the outcome, never the method.

> **THE WAGON** — Junk everywhere. Carrying it to the lab one piece at a time is the worst. Build something to haul it.
>
> **THE BALL** — Your ball landed over the fence. Get it back without climbing the fence.

The opening arc is the real tutorial: **build the wagon → discover PHYSICS 101 → meet the ball problem → use the book to think → build → test → learn.** The kid should finish it knowing two things: "I can build things", and "when I don't know how something works, I can figure it out."

You can build an RC car that drives under the gap in the fence and drags the ball back on duct tape. You can point a shop vac through the gap. You can bounce on the trampoline until you clear the fence. Or you can do something nobody planned for. The game only checks one thing: is the ball back in your yard?

## The loop: easy to build, hard to make work

**Understand → imagine → build → test → learn → change one thing → test again.** The game stays out of the way of that loop:

- **Mission 0: build the wagon.** There is no wagon at the start; the bench reads what's on it and thinks out loud (*"Wheels spin on axles. A wheel's hub pressed onto the side of something becomes an axle."*, *"All the wheels are on one side. It'll tip right over."*, *"A handle gives me something to pull."*). No recipe: anything with a body, three or more wheels on horizontal axles spread front/back and side/side, the body riding on the wheels, and something long sticking out to pull by is a wagon (`src/sim/wagonbuild.ts`). **🛒 ROLL IT OUT** turns the blueprint into the real pull-along wagon (`Simulation.addWagon`): towed, loaded and tipped exactly like the stock one, drawn as the kid's own design with its wheels spinning. Haul three things into the lab and it's yours in every project from then on; older saves keep the little red wagon.
- **PHYSICS 101.** Mom's old college textbook sits on the shelf in the lab (*"Probably boring. Probably useful."*). Look at it to read it, or tap 📖 once found. Five chapters for now (Motion, Forces, Levers & Turning, Projectile Motion, Energy), each one page: the idea in plain words, a little experiment with sliders and a live sentence saying what just happened (*"8 m/s at 45°: lands 6.4 m away, tops out at 1.6 m. The fence is 9.1 m away: 2.7 m short."*), a note in Mom's handwriting, what to go change on the machine, and the math folded away for anyone who wants it. Later chapters are listed as pages stuck together. Data and calculations live in `src/data/physics101.ts`; the pages in `src/game/physicsbook.ts`.
- **Failures are clues.** Test results now carry the measurements (*Closest: 0.6 m from the ball · Still 1.5 m from home · Tilted 38°*) and, when a chapter explains what happened, a 📖 button straight to it: a launch that came up short opens Projectile Motion, a flat battery opens Energy, a tip-over opens Levers. Before the book has been found, the button says *"Maybe Mom's physics book knows?"* and that is how most kids will find it.
- **Understand.** Each project states the real problem, what the machine needs to do (never how), the one new idea it's about (REACH, AIM, PUSH…) and its **parts bin**: a curated handful of parts waiting at the bench. No blueprint, no single right answer. Tap the project card any time to see it again.
- **Build.** Placement is forgiving: generous snap radii, the part it will join glows, and a tag by your finger says how it connects (*sticks to*, *spins on*, *swings on*, *driven by*). A new part aims at your machine first, heavy parts near the middle and wheels on the sides. Parts that would poke below the bench lift the machine instead of being refused. Every snap clunks or ratchets, with a ring and a haptic tick.
- **Test.** No checklist: if it holds together, it runs. **🚀 GO FOR IT** on the bench sets the machine down at the problem by itself (in front of the gap, at the shed edge, under the kite), facing it, and starts it. No carrying. (📍 *Place it myself* is still there for picking your own spot.) While it runs: **■ STOP**, **↺ RETRY** (everything back to the start, run again) and **🔧 BUILD** (back to the bench).
- **Learn.** A probe watches every run and the **test results** card shows a few gauges (Reach, Grip, Push, Stability, Power) plus one plain observation generated from the physics: *"It didn't reach. The closest it got was 0.6 m from the ball."*, *"The shop vac was close enough, but it was pointing away from the ball."*, *"It was trying, but the battery couldn't keep up."*, *"The kite is free! Now it just has to come down."* Never a score, never "fail".
- **Change one thing.** ↻ **Turn** spins a machine on the spot (from the results card it turns it toward the target); 🔧 **Build** takes the machine back to the bench and remembers where it stood; **🚀 GO FOR IT** puts it straight back there and runs it.
- **Stuck?** 💡 opens optional help, never shown unasked: a few "what are you thinking?" nudges (Reach, Pull, Drive, Grab), then four hints that go from a broad clue to a specific suggestion. After the last one you can ask for a step-by-step build.

The **sandbox** unlocks after the first project: every part, unlimited, no rules.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| | Desktop | Touch |
|---|---|---|
| Move / look | WASD + mouse (click to capture) | Left thumb moves (push far to run), right thumb looks |
| Use / pick up / build | `E` | Context button |
| Drop / throw | `Q` / `F` | Buttons |
| Test machines / stop | `G` / `R` | 🚀 GO FOR IT or ▶ TEST / ■ STOP |
| Wagon: pull / let go, load | `P`, `L` | 🛒 PULL / ✋ LET GO, 🛒 IN WAGON |
| Camera, drive/walk, RC switch, replay | `C`, `Tab`, `X`, `V` | Buttons |
| PHYSICS 101 (once found) | `K` | 📖 |
| Bench, test / retry, back to build, turn, hints | `B`, `G`, `T`, `Y`, `H` | 🔧 BENCH, ▶ TEST / ↺ RETRY, 🔧 BUILD, ↻ TURN, 💡 |
| Workbench | Pick a part and hover where you want it: it auto-fits onto the nearest lock point in its most natural pose (wheels on axles, motors shaft-out). Click to place. `Q`/`E`/`Z`/`X`/`F` switch to fine tune (spin, tilt, mount side); arrows jump between lock points. Select a placed part and press `M` to move it | Tap a part in the parts bin to pick it up (swiping the bin just scrolls). It starts on your machine; drag the ghost, or swipe a part straight up out of the bin, to where it should connect and let go: it clicks on in the most natural pose. Or tap a spot to move the ghost there, then tap the ghost or ✔ PLACE. One finger anywhere else turns the view. 🎯 Fine tune adds a d-pad, spin and tilt. Tap a placed part twice (or ✥ Move) to pick it back up |

**The wagon** is parked outside the lab. Grab its handle and it rolls along behind you. Load junk into it (up to 8 parts, 60 kg) instead of carrying one thing at a time; hauling is much easier on the legs than lugging. Look at it to take the last thing out or tip the lot onto the ground. Walk to the bench with it and everything in it goes into the parts bin.

Add `?q=low` to the URL for low graphics (no shadows or grass).

## How it works

Everything is data. The engine never checks which part or solution you used.

- **Parts** (`src/data/parts.ts`) are collision shapes, mass, material, *sockets* (where the part mounts), *targets* (where other parts plug in: motor shafts, hinge leaves, winch drums) and a list of generic **behaviours**: `motor`, `thrust`, `airflow`, `suction`, `buoyancy`, `battery`, `sticky`, `bounce`, `timer`, `pressure`, `receiver`, `winch`. Ropes, bungees and springs are **links** between two points.
- **Joints come from geometry.** A wheel hub pressed onto a surface becomes an axle along the surface normal. Anything on a motor shaft is driven. Anything on a hinge leaf swings. Everything else is welded. See `computeAttach` in `src/sim/blueprint.ts`.
- **Machines** (`src/sim/machine.ts`): parts welded together become one rigid body, with its centre of mass and inertia taken from the real part masses. Axles, hinges and shafts become Rapier revolute joints. Every step, each part's load is estimated from contacts, rope and thrust forces and its own acceleration. When the load beats a connection's strength, the connection breaks: wheels fall off, counterweights rip loose.
- **Ropes** are verlet particle chains that drape over fences and branches, so a rope over the fence works like a pulley. Bungees and springs are one- or two-sided force elements whose stiffness is capped for stability.
- **Power** is solved per connected group: batteries have a watt limit and an energy store, and too much demand browns out every motor, fan and vacuum on that group together.
- **Control**: machines stay frozen until GO. Egg timers and doormat switches gate their group, so one machine landing on another's doormat starts a chain reaction. An RC brain maps throttle and steer onto whichever motors and fans happen to be on the machine, worked out from their geometry.
- **Projects** (`src/data/projects.ts`) are conditions over world state (`inZone`, `held`, `snagged`, `touchedByPlayer`, `wagonLoad`, and so on), plus fail rules and bonus conditions. A project may carry `musings`, the kid thinking out loud after the briefing, and the wagon project declares `deliverable: 'wagon'`. They also carry the briefing (problem, goals, concept), the curated parts bin, the hints and nudges, which gauges the results card shows and where to stand to work on the problem.
- **Test results** (`src/game/diagnostics.ts`): `TestProbe` samples a run (closest approach, including how far a vacuum or fan's air reaches; grabs; snag tugs; flight; tilt; breaks; battery power) into plain numbers, and `analyze()` turns those into gauges, one observation, a few measured facts and the PHYSICS 101 chapter that explains it. It is pure logic, so it is tested on its own and against real runs.

```
src/
  data/     parts, materials, world layout, projects (all data)
  sim/      headless deterministic simulation (Rapier, fixed 120 Hz)
  game/     modes, workbench, camera director, replay, run journal, save
  render/   procedural meshes, backyard, particles, thumbnails
  audio/    fully synthesised physical audio (no samples)
  ui/       DOM HUD, cards, touch-friendly buttons
tests/      vitest: physics, blueprints, power, objectives, save, wagon building, Physics 101, full solutions
```

## Tests

```bash
npm test
npm run typecheck
```

The suite includes **solution tests** that play the real levels headless:

- THE BALL solved by an RC car, by a vacuum, and by a trampoline plus a throw. A second vacuum test shows that on a lantern battery it browns out.
- THE KITE staying stuck when nobody touches it, knocked loose by a thrown brick, and blown off the branch by a fan updraft.
- BISCUIT'S BALL sucked out from under the shed.

**Test results** are checked against real runs: a vacuum that works reads full reach; the same vacuum on a lantern battery shows the power gauge struggling; too far back it reports how far short it fell; close but aimed sideways it says it was pointing away; aimed through the solid fence it says something was in the way; motors without a battery say so; a fan knocking the kite loose fills the push gauge. Every observation is also checked for judgmental words ("fail", "wrong"…). **Project data** tests keep bins curated and buildable, hints progressive, sites standable, and every known solution buildable from that project's bin.

**Mission 0** tests read wagons off the bench (the obvious plank-and-wheels wagon passes; a wheel lying flat, wheels all on one side, a crate dragging on the ground and a cart with no handle each get their own note), tow the built wagon at its own handle length, and haul three things into the lab for a real success. **PHYSICS 101** tests pin the chapter list, keep homework words out of it, check every experiment's calculation (45° goes farthest, stretching twice as far stores four times the energy, a push has to beat friction…) and the links from test results to chapters.

There are also targeted tests for structural failure, rope snapping, rope draping, balloons, fan thrust direction, catapults, rockets, timers, doormat chain reactions, duct tape, determinism, save/load (including corrupted data) and progression.

## Deploying (GitHub Pages)

`.github/workflows/pages.yml` builds, tests and deploys `dist/` on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/`. The service worker caches the game for offline play, and the manifest plus Apple meta tags make "Add to Home Screen" launch it standalone.

Icons are generated by `npm run icons`, with no image assets and no dependencies: a homemade machine reaching over the backyard fence with the ball in its bucket. A test pins the manifest, icon sizes, iOS web-app tags and the service worker's precache list.

## Roadmap

The slice proves stage 1 (JUNK). The Lab Notebook shows what comes next: Contraptions → Machines → Vehicles → Flight → High Altitude → Space. All of it uses the same component system. The joke is that the kid never started a space program. They just kept asking, "Could I make this thing go a little farther?"
