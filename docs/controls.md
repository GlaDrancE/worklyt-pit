# Controls and handling

## Keyboard

| Action | Keys |
| --- | --- |
| Throttle | W or ↑ |
| Brake, then reverse | S or ↓ |
| Steer | A / D or ← / → |
| Handbrake (kicks the rear out) | Space |
| Reset to the track | R |
| Change camera | C |
| Street lights on or off (dusk and night) | L |
| Mute or unmute engine sound | M |
| Pause | P or Esc |

There are five camera views, including a low showcase view.

## Gamepad

Any standard gamepad the browser can see works. Left stick or D-pad steers, RT and LT are throttle and brake, A or B is the handbrake, Start pauses, Y changes camera, X resets and Back mutes. Rumble plays on hits and rumble strips where the browser supports it. Stick dead zone and response are adjustable in Settings.

## Touch

On phones and tablets the game shows on-screen controls. In Settings you can choose:

- **Steering style:** two buttons, or a drag wheel that springs back to centre.
- **Tilt steering:** turn the phone like a wheel. Tap Calibrate to set "straight" (it also calibrates at the start of each race). iPhones ask for motion access when you turn it on. A sensitivity slider and a reverse switch cover phones that read the other way.
- **Easy drive:** gas is held for you, steering is gentler and stability control is on. Brake still works.
- **Size, opacity and height** of the controls, stored separately for portrait and landscape, plus a "swap hands" option that moves the pedals to the left.

Long-pressing a control never selects text, a thumb that slides off a button keeps holding it, and several buttons can be held at once.

### Screen layouts

The game works upright or sideways. Settings offers Automatic (follows how you hold the phone), Portrait or Landscape. If you pin a layout the phone isn't held in, the game turns itself on screen, because most browsers only allow a real orientation lock in full screen (it still asks for one first). Rotating only refits the screen. The race, your car, your lap and the timer carry on.

Portrait puts speed and gear at the top with a slim lap and position strip, a small minimap, and the controls low where your thumbs are. The camera sits higher and further back with a wider field of view. Landscape shows the full race strip along the top, speed with gear and a rev bar low in the middle, steering under the left thumb and pedals under the right. Both respect notch and home-bar safe areas.

Things to know: gyro steering needs a motion sensor and, in most browsers, a secure page (https or localhost). The real orientation lock works only in full screen on most Android browsers and not at all in iOS Safari. The gear and rev bar are calculated from speed, because the car physics has no gearbox.

## Settings

The Settings screen is saved on the device and covers steering speed and sensitivity, high-speed steering feel, driving assist, volume, gamepad dead zone, stick response, rumble, tyre wear, damage level, tyre compound, time of day, weather, screen layout, touch layout, and an optional on-screen FPS counter. Graphics quality has its own selector on the menu.

## How steering works

Steering is gradual rather than snapping. Holding a key, button or the wheel builds lock smoothly, letting go returns to centre in a fraction of a second, and light inputs give small corrections. The car turns less sharply the faster it goes, so full lock at 250 km/h is a gentle correction while at parking speed it's a proper turn. Hands off, the car settles instead of carrying on turning, and there is a touch of understeer at speed.

The front wheels visibly steer (up to 28° on the model, easing off at speed) from the same value the physics uses, so what you see is what the car is doing. The rear wheels stay straight.

### Steering at speed

Racing games cut steering lock as speed rises, but too much of a cut makes the car feel dead. TrackRush keeps the lock matched to what the tyres can hold, never lets it fall below 11% of full lock, and adds a little rear grip at speed (like aero balance) so the tail stays planted. In the physics, full steering at 200 km/h gives a radius of about 71 m (around 4.5 g) with under one degree of slip.

Settings → **High-speed steering feel** changes this at speed only:

| Feel | Character |
| --- | --- |
| Calm | Planted, hard to spin |
| Standard | Default balance |
| Sharp | Quick turn-in, needs care |

Online 1v1 always uses Standard so both drivers are equal. Every number lives in `src/vehicle/steeringConfig.ts`.

## Drift handling

Choose Handling → Drift on the menu (the default is Race). Drift handling loosens the rear tyres, adds some power oversteer and gives you a counter-steer assist so a slide can be held on a keyboard. In any mode you can flick Space mid-corner to kick the tail out. Online 1v1 always uses Race handling.

A drift counts when slip angle is above about 10° at 30 km/h or more. Points build while you slide, faster and more sideways is worth more, and the multiplier climbs the longer you hold it (up to ×5). Straighten up for about 0.8 s and the combo is banked. Hitting a wall, spinning out or resetting loses it. The results screen shows your total and best combo, and your best total per track is remembered on the device. Tyre smoke is drawn while you slide, and skid marks stay on the tarmac until the race ends or restarts (none are laid on grass).
