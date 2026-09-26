# Backyard Lab

A kid has a real problem, a handful of junk, and an idea. Can they make it work?

Backyard Lab is a first-person backyard invention game for the browser, built mobile-first and installable as a PWA. It is not a construction sandbox. Every problem hands you a small **kit** of ordinary stuff, you unroll a **mat** wherever you are standing, click a few things together, hit **GO**, and watch. When it fails, the kid tells you why. Then you fix it.

> **BISCUIT'S BALL** — The dog's ball rolled under the shed. Get it out.
> Your kit: a shop vac and a car battery. Wait... they gave you a *vacuum*?

## The loop

```
DISCOVER  a problem appears (the ball, the kite, the lunchbox...)
BUILD     unroll the mat right where you stand, snap parts from the kit together
TEST      GO, right there on the mat
LEARN     "The vac is running, but it is not sucking anything. Closer?"
IMPROVISE STOP & FIX, turn it, add the thing you found by the shed
SOLVE     the physics judges only the outcome, never the method
```

There is no scavenger hunt and no workbench across the yard: the kit is always in the tray, and the mat is wherever you are. Building faces the way you are looking, so a vac built while looking at the shed points at the shed.

## The problems

| # | Problem | Kit | What you figure out |
|---|---|---|---|
| 1 | **BISCUIT'S BALL** — the dog's ball is under the shed | shop vac, car battery | suction grabs light things; nothing runs without a battery on it |
| 2 | **THE KITE** — stuck in the big tree | box fan, 2 crates, lantern battery (+ a tape wad under the tree to throw) | a fan pushes air, air pushes things; aim the wind |
| 3 | **TREEHOUSE LUNCH** — get the lunchbox up without climbing | bucket, 2 balloon bunches, rope, brick, tape (+ balloons on the deck) | balloons pull up, weight pulls down, a rope decides how far |
| 4 | **THE BALL** — over the fence, gate locked from her side | plank, 2 motors, 4 wheels, battery, RC brain, tape (+ trampoline) | motors spin what is on their shaft; the RC brain steers |
| 5 | **SPECIAL DELIVERY** — the neighbour's paper landed in our yard | plank, hinge, 2 crates, 2 bungees, brick, timer (+ rocket, tape, spring) | a hinge makes a lever; stretched rubber stores energy; height helps |

Each problem is solved by a 2 to 11 part machine, and every one has at least one other way through. Junk lying around the yard (crates, planks, bricks, a skateboard, whatever the problem leaves nearby) can be picked up and **added to the kit**: "wait, I could use THAT." Solving a problem writes a line in the Lab Notebook and unlocks the next one, whose kit shows what is **NEW**. The sandbox (everything you have ever used, unlimited) opens after the first solve. Every problem has one optional **Idea**: Lego-style step-by-step instructions for one known solution, offered only after you have failed a couple of times.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| | Desktop | Touch |
|---|---|---|
| Move / look | WASD + mouse (click to capture) | Left thumb moves (push far to run), right thumb looks |
| Use / build here / tinker / pick up | `E` | Context button |
| Pick up a machine / throw | `F` | Buttons |
| Drop | `Q` | Button |
| Run machines / reset | `G` / `R` | ▶ GO / ⟲ RESET |
| Camera, drive/walk, RC switch, replay | `C`, `Tab`, `X`, `V` | Buttons |
| On the mat | Tap a part in the kit, hover where it goes: it auto-fits onto the nearest lock point (wheels on axles, motors shaft-out). Click to place. `Q`/`E`/`Z`/`X`/`F` fine-tune (spin, tilt, mount side); arrows jump between lock points. Select a placed part and `M` to move it. ▶ GO runs it right there; ⟲ STOP & FIX brings it back | Tap a part, drag the ghost where it should click on and let go. Or tap a spot, then tap the ghost or ✔ PLACE. One finger elsewhere turns the view. 🎯 Fine tune adds a d-pad. Tap a placed part twice to move it. 💡 Idea walks you through one build on gold rings |

Add `?q=low` to the URL for low graphics (no shadows or grass).

## How it works

Everything is data. The engine never checks which part or solution you used.

- **Problems** (`src/data/projects.ts`) are a kit, some yard junk, a prop, and conditions over world state (`inZone`, `held`, `snagged`, `above`, ...), plus fail rules, bonuses, a lesson, idle hints and post-failure nudges.
- **Parts** (`src/data/parts.ts`) are collision shapes, mass, material, *sockets* (where the part mounts), *targets* (where other parts plug in: motor shafts, hinge leaves, winch drums) and generic **behaviours**: `motor`, `thrust`, `airflow`, `suction`, `buoyancy`, `battery`, `sticky`, `bounce`, `timer`, `pressure`, `receiver`, `winch`. Ropes, bungees and springs are **links** between two points.
- **Joints come from geometry.** A wheel hub pressed onto a surface becomes an axle along the surface normal. Anything on a motor shaft is driven. Anything on a hinge leaf swings. Everything else is welded. See `computeAttach` in `src/sim/blueprint.ts`.
- **Machines** (`src/sim/machine.ts`): parts welded together become one rigid body. Axles, hinges and shafts become Rapier revolute joints. Every step, each connection's load is estimated; when it beats the connection's strength, it breaks. Ropes are verlet chains that drape over fences and branches. Power is solved per connected group: a lantern battery running a shop vac browns out.
- **Ideas** (`src/data/ideas.ts`) are the guided builds. Every idea is also a test: `tests/solutions.test.ts` builds each one with the same placement code the touch UI uses, drops it in the real yard, and checks the problem gets solved using nothing beyond that problem's kit and yard.
- **The journal** (`src/game/journal.ts`) watches a run and explains failure in one line: wheels fell off, the balloons are too heavy, the vac is not close enough, the fan is blowing at nothing.

```
src/
  data/     parts, materials, world layout, problems, ideas (all data)
  sim/      headless deterministic simulation (Rapier, fixed 120 Hz)
  game/     modes, the mat, camera director, replay, run journal, save
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

The **solution tests** play every problem headless in the real yard, using its own kit: the Big Vac under the shed, the fan updraft under the kite (and the thrown tape wad), the balloon lift beside the treehouse (and the too-heavy two-bunch version that never lifts), the sticky RC car through the fence gap (plus the vacuum and the trampoline routes), and the two-crate catapult that clears the fence (plus the one-crate one that does not). Then targeted tests for structural failure, rope snapping and draping, balloons, fan thrust, rockets, timers, doormat chain reactions, duct tape, determinism, save/load and progression.

## Deploying (GitHub Pages)

`.github/workflows/pages.yml` builds, tests and deploys `dist/` on every push to `main`. In the repo settings, set **Pages → Source** to **GitHub Actions**. The build uses a relative base path, so it works at `https://<user>.github.io/<repo>/`. The service worker caches the game for offline play, and the manifest plus Apple meta tags make "Add to Home Screen" launch it standalone.

Icons are generated by `npm run icons`, with no image assets and no dependencies.
