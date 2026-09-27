# Backyard Lab

A kid has a real problem. What ridiculous machine can they build from the junk in the backyard to solve it?

Backyard Lab is a first-person backyard engineering sandbox for the browser, built mobile-first and installable as a PWA. This repo holds the **vertical slice**: one backyard, 24 pieces of junk, four projects, a dog next door, and a physics engine that judges only the outcome, never the method.

> **THE BALL** — Your ball went over the fence. Get it back.

You can point a shop vac through the gap under the fence (the first guided build; the lantern battery on the shelf browns it out, and the car battery it needs is round the back of the shed). You can build an RC car that drives under the gap and tows the ball back on duct tape (the second project, **THE BALL. AGAIN.**, puts the ball too far away for anything that just reaches). You can bounce on the trampoline until you clear the fence and throw it back. Or you can do something nobody planned for. The game only checks one thing: is the ball back in your yard?

Machines that solve a project stay parked in the yard under a tape label (lined up along the fences, out of the way of the next project), every solved project leaves one new piece of junk lying around, each project has one deliberately odd bonus star, the treehouse has a ladder, and Biscuit chases anything that moves in his yard.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| | Desktop | Touch |
|---|---|---|
| Move / look | WASD + mouse (click to capture) | Left thumb moves (push far to run), right thumb looks |
| Use / build / pick up | `E` (`F` picks up junk lying on the bench) | Context buttons |
| Drop / throw | `Q` / `F` | Buttons |
| Run machines / reset | `G` / `R` | ▶ GO / ⟲ RESET |
| Camera, drive/walk, RC switch, replay | `C`, `Tab`, `X` (only when the remote has a fan, vac or winch to switch), `V` | Buttons |
| Place a machine | It faces the way you are looking; the tape arrow on the ground shows where its nose will point. `R` turns it | Same, ↻ button |
| Climb | Walk into the treehouse ladder | Same |
| Workbench | Pick a part and hover where you want it: it auto-fits onto the nearest lock point in its most natural pose (wheels on axles, motors shaft-out). Click to place. `Q`/`E`/`Z`/`X`/`F` switch to fine tune (spin, tilt, mount side); arrows jump between lock points. Select a placed part and press `M` to move it. 💡 Idea walks you through a starter build | Tap a part in the tray to pick it up (swiping the tray just scrolls). Drag the ghost, or swipe a part straight up out of the tray, to where it should connect and let go: it clicks on in the most natural pose. Or tap a spot to move the ghost there, then tap the ghost or ✔ PLACE. One finger anywhere else turns the view. 🎯 Fine tune adds a d-pad, spin and tilt. Tap a placed part twice (or ✥ Move) to pick it back up. 💡 Idea gives a step-by-step build: each part waits on a gold ring, just tap ✔ PLACE |

Add `?q=low` to the URL for low graphics (no shadows or grass).

## How it works

Everything is data. The engine never checks which part or solution you used.

- **Parts** (`src/data/parts.ts`) are collision shapes, mass, material, *sockets* (where the part mounts), *targets* (where other parts plug in: motor shafts, hinge leaves, winch drums) and a list of generic **behaviours**: `motor`, `thrust`, `airflow`, `suction`, `buoyancy`, `battery`, `sticky`, `bounce`, `timer`, `pressure`, `receiver`, `winch`. Ropes, bungees and springs are **links** between two points.
- **Joints come from geometry.** A wheel hub pressed onto a surface becomes an axle along the surface normal. Anything on a motor shaft is driven. Anything on a hinge leaf swings. Everything else is welded. See `computeAttach` in `src/sim/blueprint.ts`.
- **Machines** (`src/sim/machine.ts`): parts welded together become one rigid body, with its centre of mass and inertia taken from the real part masses. Axles, hinges and shafts become Rapier revolute joints. Every step, each part's load is estimated from contacts, rope and thrust forces and its own acceleration. When the load beats a connection's strength, the connection breaks: wheels fall off, counterweights rip loose.
- **Ropes** are verlet particle chains that drape over fences and branches, so a rope over the fence works like a pulley. Bungees and springs are one- or two-sided force elements whose stiffness is capped for stability.
- **Power** is solved per connected group: batteries have a watt limit and an energy store, and too much demand browns out every motor, fan and vacuum on that group together.
- **Control**: machines stay frozen until GO. Egg timers and doormat switches gate their group, so one machine landing on another's doormat starts a chain reaction. An RC brain maps throttle and steer onto whichever motors and fans happen to be on the machine, worked out from their geometry.
- **Projects** (`src/data/projects.ts`) are conditions over world state (`inZone`, `held`, `snagged`, `touchedByPlayer`, and so on), plus fail rules and bonus conditions.

```
src/
  data/     parts, materials, world layout, projects (all data)
  sim/      headless deterministic simulation (Rapier, fixed 120 Hz)
  game/     modes, workbench, camera director, replay, run journal, save
  render/   procedural meshes, backyard, particles, thumbnails
  audio/    fully synthesised physical audio (no samples)
  ui/       DOM HUD, cards, touch-friendly buttons
tests/      vitest: physics, blueprints, power, objectives, save, full solutions
```

## Tests

```bash
npm test
npm run typecheck
```

The suite includes **solution tests** that play the real levels headless:

- THE BALL solved by the guided Suck-o-Matic once the car battery is swapped in (and not before: on the lantern battery it browns out and the ball stays put), by an RC car, and by a trampoline plus a throw.
- THE BALL. AGAIN. is out of a vacuum's reach and is fetched by the guided sticky RC car, towed home in reverse.
- THE KITE knocked loose by a throw, and blown off the branch by a fan updraft.
- BISCUIT'S BALL sucked out from under the shed.

There are also targeted tests for structural failure, rope snapping, rope draping, balloons, fan thrust direction, catapults, rockets, timers, doormat chain reactions, duct tape, determinism, save/load (including corrupted data) and progression, plus regression tests for the spawn facing, placement facing, bench TEST grounding, the bench-over-junk action priority, the thought bubble CSS, parked machines (their parking spots, and that nothing can be set down on top of one), reward junk, the "weird" bonus stars, the ladder, and Biscuit (including that he cannot stop the RC car towing the ball home).

## Deploying (GitHub Pages)

`.github/workflows/pages.yml` builds, tests and deploys `dist/` on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/`. The service worker caches the game for offline play, and the manifest plus Apple meta tags make "Add to Home Screen" launch it standalone.

Icons are generated by `npm run icons`, with no image assets and no dependencies.

## Roadmap

The slice proves stage 1 (JUNK). The Lab Notebook shows what comes next: Contraptions → Machines → Vehicles → Flight → High Altitude → Space. All of it uses the same component system. The joke is that the kid never started a space program. They just kept asking, "Could I make this thing go a little farther?"
