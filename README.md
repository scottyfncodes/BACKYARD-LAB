# Backyard Lab

A kid has a real problem. What ridiculous machine can they build from the junk in the backyard to solve it?

Backyard Lab is a first-person backyard engineering sandbox for the browser, built mobile-first and installable as a PWA. This repo holds the **vertical slice**: one backyard, 24 pieces of junk, three projects, and a physics engine that judges only the outcome, never the method.

> **THE BALL** — Your ball went over the fence. Get it back.

You can build an RC car that drives under the gap in the fence and drags the ball back on duct tape. You can point a shop vac through the gap. You can bounce on the trampoline until you clear the fence. Or you can do something nobody planned for. The game only checks one thing: is the ball back in your yard?

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
| Run machines / reset | `G` / `R` | ▶ GO / ⟲ RESET |
| Camera, drive/walk, RC switch, replay | `C`, `Tab`, `X`, `V` | Buttons |
| Workbench | Pick a part: its ghost hovers over the bench. Arrow keys / mouse aim it, `Q`/`E` spin, `Z`/`X` tilt, `F` mount side, `Enter` or click to place. Select a placed part and press `M` to move it | Tap a part in the tray: its ghost hovers over the bench. D-pad aims it, ↺ ↻ spin it flat, ⤵ ⤴ tilt it up (ramps!), ✔ PLACE locks it in. Tap a placed part twice (or ✥ Move) to pick it back up, along with everything attached to it |

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

- THE BALL solved by an RC car, by a vacuum, and by a trampoline plus a throw. A second vacuum test shows that on a lantern battery it browns out.
- THE KITE knocked loose by a throw, and blown off the branch by a fan updraft.
- BISCUIT'S BALL sucked out from under the shed.

There are also targeted tests for structural failure, rope snapping, rope draping, balloons, fan thrust direction, catapults, rockets, timers, doormat chain reactions, duct tape, determinism, save/load (including corrupted data) and progression.

## Deploying (GitHub Pages)

`.github/workflows/pages.yml` builds, tests and deploys `dist/` on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/`. The service worker caches the game for offline play, and the manifest plus Apple meta tags make "Add to Home Screen" launch it standalone.

Icons are generated by `npm run icons`, with no image assets and no dependencies.

## Roadmap

The slice proves stage 1 (JUNK). The Lab Notebook shows what comes next: Contraptions → Machines → Vehicles → Flight → High Altitude → Space. All of it uses the same component system. The joke is that the kid never started a space program. They just kept asking, "Could I make this thing go a little farther?"
