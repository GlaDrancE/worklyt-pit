# Gameplay guide

## Menu modes

The start menu has three tabs. Each has the same circuit, time of day, weather, engine sound, tyre and graphics options.

| Tab | What it does |
| --- | --- |
| **Battle** | Race 1, 3 or 5 rivals at easy, medium or hard. Damage, safety car and pit stops all count. |
| **Solo drive** | Just you, either timed laps or free roam with no timing. Race or drift handling, and damage options, are here. |
| **1 vs 1** | Opens the online lobby, see [multiplayer.md](multiplayer.md). Time of day and weather are shared by both drivers. Online always uses race handling and no crash damage. |

## Circuits, weather and time of day

Four full-length circuits (about 2.6 to 4.2 km a lap): Apex Park, Harbour Loop, Neon Street (a tight city circuit at dusk) and Midnight Wet (night and rain by default). Time (day, dusk, night) and weather (clear, rain) can follow the circuit's default or be forced.

Rain cuts grip by about 22%, draws streaks, plays a rain loop and makes the road look wet. Night switches on headlights and track lamps. Best laps and ghosts are stored per set of conditions, so a wet lap never replaces a dry one, and leaderboards only take laps in a circuit's standard conditions. Online races always use day and clear.

## Lap timing

Races start with a 3-2-1 countdown. Checkpoints must be crossed in order, and each lap has three sectors. Skipping part of the track or resetting the car makes the lap invalid. Your personal best is saved on the device, and the HUD has a live minimap with sector colours.

## Rivals, ghost and replay

Races can run with 0, 3 or 5 computer-driven rivals. You start at the back, see your position live, and the results show the finishing order with points. Rivals can spin off now and then (more in the rain), get damaged, and service in their own pit box 14 m before yours.

Your best valid lap on each circuit is saved and replays as a see-through cyan ghost. The time gap to it shows on screen. The ghost fades out when within about 5 m of your car and hides while you're in the pits.

After a race, **Watch best lap** replays that saved lap from four cameras (Chase, TV, Top, Helicopter). **Lap image** draws your racing line coloured by speed as a PNG. Everything is generated on your device.

## Tyres and pit stops

Pick Soft, Medium or Hard, or turn tyre wear off. Tyres wear with speed, slip, braking and rain, and lose up to about a third of their grip. The HUD shows the compound and remaining life.

To stop, drive into the blue PIT box on the right of the main straight, about 100 m after the line, and hold still for 3 seconds. Sitting in the box doesn't fit tyres again, so leave and come back. The pit crew's wheel guns sound while you're stopped.

## Crashes and damage

The Damage option has three settings: Realistic (crashes hurt), Looks only, and Off.

- **Contact:** rivals steer around you. If you do touch, both cars are pushed apart and both take damage. Hitting the back of a car ahead earns a 5 second penalty.
- **Zones:** ten in total (front wing, rear wing, sidepods, floor, engine, four wheels). A damaged front wing or floor costs downforce, a damaged engine costs power, a damaged wheel costs grip and pulls the car to that side.
- **Looks:** bodywork dents, wings and wheels can come off, parts stay on the track as debris (driving over it can cut a tyre a little) and a hurt engine smokes. The HUD shows a small car with each zone coloured.
- **Pit repairs:** stand still in the pit box. The stop lasts as long as the repairs need (roughly 5 s for a front wing, 8 s for an engine, up to 25 s), plus tyres if wear is on.

Penalties are only applied when racing against rivals, and damage is off in online 1v1.

## Race control

Incidents get a response that matches how bad they are:

| Situation | Response |
| --- | --- |
| Small incident, stopped car | Yellow flag |
| Medium incident | Virtual safety car: everyone holds a slow pace, 100 km/h limit for you, no car on track |
| Heavy incident, or a stopped car in the way | Safety car leads the field at about 108 km/h. Stay under 150 km/h and don't pass it |
| Two bad incidents together, or three open at once | Red flag: every car stops where it is while trucks clear the track, then a short countdown restarts the race |

Ignoring the limits earns a 5 second penalty. Lap times set across a red flag don't count.

A red recovery truck leaves a marshal post, drives to the stopped car, loads it and takes it away. If your own car is wrecked and has stopped, the truck takes it to the pit box, the crew repairs it and you rejoin. The safety car comes in once the track is clear.

## Daily challenge, season and unlocks

Open "Daily challenge · Season · Unlocks" on the menu.

- **Daily challenge:** one race a day, the same for everyone, because the circuit, time of day, weather, rival count and difficulty all come from the date. Finish for one star, podium for two, win for three. Your best result per day and your streak are saved on the device.
- **Championship:** a season of up to four races on different circuits against the same five rivals, with F1-style points (25-18-15-12-10-8). The table carries across races and is saved, so you can quit and carry on later. A round counts only when you finish it.
- **Car colours:** eight paint schemes unlocked by total points (10 per clean lap, more for finishing high). Pick one under "Your car". The results screen tells you when something unlocks.

## Driver names, history and achievements

On first launch the game gives you a driver name such as "Swift Falcon 42" and a driver ID. You can rename yourself on the menu. Every Circuit Racing session is saved on your device with the circuit, date, every lap and sector, top speed and barrier hits, marked as finished or left early. **Race history** shows your races, the fastest laps per circuit and, if you like, everyone who has raced on the same device.

Thirteen achievements unlock as you play. After a race, **Share result card** makes a 1200×630 picture (circuit, conditions, best lap, top speed, drift, hits). It uses the system share sheet where there is one, otherwise press and hold the picture or use Download PNG. Nothing is uploaded.

A short "how to drive" card appears before your first race, and **How to play** on the menu shows it again.

## Telemetry

Sessions record speed, throttle, brake, steering, position, lap, sector, off-track state and collisions at 10 samples a second, exportable as CSV or JSON from the results screen. It's always labelled as simulated game data and never mixed with real motorsport data.

## Sound

Pick V10, V8 or V6 hybrid on the menu. Sound is synthesised in the browser from a firing-pulse and exhaust-resonance model, rendered at several engine speeds and cross-faded by rpm. It adds shift cuts, overrun pops, turbo and gearbox whine, wind, tyre squeal and barrier thumps, a camera-aware mix, and other cars' engines placed in space with Doppler. The crowd cheers after valid laps and the finish. These are synthesised, not recordings of a real car. Press M to mute.

## Performance

Phones and low-core or low-memory machines start on Low graphics, and the game lowers quality by itself if the frame rate stays poor. Turn on "Show frame rate" in Settings to watch it. The menu appears first while the physics engine and car model load in the background.

## Circuit lengths

| Circuit | Lap length | Laps |
| --- | --- | --- |
| Apex Park | about 4.0 km | 3 |
| Harbour Loop | about 2.6 km | 4 |
| Neon Street | about 3.4 km | 5 |
| Midnight Wet | about 4.2 km | 3 |

The circuits were lengthened in a later update. Races saved before that stay in your history but are left out of the fastest-lap tables, and old ghosts and personal bests are not reused, because those times were set on the shorter layouts.

## Training grounds

Three short practice circuits, each drilling one skill. Every lap is under 2 km, and they sit in their own "Training grounds" group in the circuit list. They run in clear daylight and work in every mode (Battle, Solo and free drive). They are left out of the daily challenge and championship.

| Training ground | Lap | What it teaches |
| --- | --- | --- |
| Straights Training | about 1.7 km | Two long straights joined by wide turns: flat-out speed, braking points and launches |
| Turns Training | about 1.7 km | Flowing sweepers and S-bends: smooth lines, turn-in and keeping speed |
| Corners Training | about 1.7 km | Tight 90° corners, a chicane and a hairpin: late braking, rotation and getting back on the power |

## Night lighting

At dusk and night the street lamps give real light. The lamps nearest your car light the road and barriers around you, with fewer lights on Low graphics (4), more on Medium (6) and High (8). Headlights come on as well.

For a darker, harder race, untick **Street lights** under Conditions on the menu, or press **L** during a race to switch them off and on (a toast confirms it). With them off the lamps stay dark and only your headlights and the moon light the road. Switching them has no effect in daylight.
