# Trust, affection and gifts

Your crow keeps an **affection** value from 0 to 2500. Settings → Friendship shows
it as *trust points*, together with the **friendship level** (1–50) and the **trust
tier** (the five stages below). Every number on this page comes straight from
`src/core/affection.js` and `src/core/items.js`, and `test/affection.test.js`
fails if this page and the code ever disagree.

## Trust tiers

| Tier | Affection | Behaviour |
|------|-----------|-----------|
| Wary | 0–99 | Hops away from a fast-moving pointer within 130 crow-units; flies off if it gets very close. Never brings gifts. |
| Curious | 100–249 | Flinch distance shrinks to 80 crow-units. Watches you. Never brings gifts. |
| Friendly | 250–449 | No longer shies away. Sometimes hops over to a resting pointer and chirps. **Gifts start.** |
| Trusting | 450–699 | As Friendly, gifts twice as likely and rarer ones appear. |
| Bonded | 700–2500 | As Trusting, the best gift odds. |

(A crow-unit is one screen pixel at 100 % crow size, the default size.)

## Friendship levels

The points are also split into 50 friendship levels, so there is always a next
step in sight. Levels 1 to 20 are four in each tier and end at 1000 points, as
they did before 1.4; levels 21 to 50 come after them, inside Bonded, from 1000 to
2450 points (35 to 65 points apart). Levels change nothing by themselves (the
tier decides how the crow behaves), but each new level pops up a short message
over the crow, a new tier names it, and level 50 gets a message of its own.

| Tier | Levels | Each level starts at (affection) |
|------|--------|----------------------------------|
| Wary | 1–4 | 0, 20, 45, 70 |
| Curious | 5–8 | 100, 135, 170, 210 |
| Friendly | 9–12 | 250, 295, 345, 395 |
| Trusting | 13–16 | 450, 510, 570, 635 |
| Bonded | 17–50 | 700, 775, 850, 930, 1000, 1035, 1070, 1105, 1145, 1185, 1225, 1265, 1310, 1355, 1400, 1445, 1490, 1540, 1590, 1640, 1690, 1740, 1795, 1850, 1905, 1960, 2015, 2075, 2135, 2195, 2255, 2320, 2385, 2450 |

## Milestones

Settings → Friendship also lists seventeen milestones, worked out from the saved
statistics and treasures: a first snack, a first hand-feeding, 25 hand-feedings,
a first gift, 10 gifts, every kind of treasure, a legendary treasure, 7 and 30
days together, 100 flights, 10 petting sessions, 5 dances to your music, 25
droppings cleaned up, reaching Bonded, and reaching levels 20, 35 and 50
(`src/core/milestones.js`).

## Affection gains

| Event | Base points | Notes |
|-------|-------------|-------|
| The crow eats a snack it found (`eatSpawned`) | +1 | The first 15 points a day count in full, then a quarter. |
| You use **Feed** in the tray menu and it eats the treat (`feedTray`) | +6 | Manual feeding rules below. |
| You drag food onto the crow and it eats it (`feedHand`) | +10 | Manual feeding rules below; also triggers a bonus gift check. |
| You pick up a gift it brought (`giftCollected`) | +4 | Shiny things you pick up yourself go to your treasures but earn no trust. |
| First time the app runs on a new calendar day (`dailyVisit`) | +5 | |
| You pet it: stroke the pointer back and forth over it without clicking (`pet`) | +2 | Once per petting session (at most every 12 s). The first 20 points a day count in full, then half. |
| Clicking the crow 3 times within 4 s (`annoyed`) | −4 | Then 10 s cool-down; it also flies away from you. |

**Diminishing returns (the curve).** Every positive gain is scaled by how much the
crow already trusts you:

```
gain = base × (1 − min(A, 1000) / 1400)      A = current affection
```

So a hand-feeding is worth 10 points at the start, 8 at 250, 5 at 700 and 3 at 1000.
From 1000 points on the curve stops shrinking, so levels 21 to 50 stay within reach.
Fractions of a point are not lost: they are carried over (and saved) until they
add up to whole points.

**Manual feeding rules.** Each extra Feed or hand-feed within 15 minutes of an
earlier one is worth 70 % of the previous one (never less than 1 point).

**Daily amounts, never a wall.** Each calendar day the first 120 points from
feeding, 15 from snacks the crow finds and 20 from petting count in full. After
that, feeding and petting count half and found snacks a quarter, so trust keeps
growing however much you play. Settings → Friendship shows today's amounts.
(Up to 1.3.0 these were hard daily limits: once all three were used up, a crow
too shy to bring gifts could not gain a single point until the next day.)

**Neglect.** Once per day the app checks when the crow was last fed (by you or by
itself). After a 2-day grace period it loses 5 points per extra day, at most 60
points in one check, never below 0.

## How long it takes

Produced by `node scripts/affection-timeline.js` with the real functions (40 or
30 snacks a day found by the crow itself, counted as above; gifts and petting
not counted, so real play is a little faster):

| Play style | Curious | Friendly | Trusting | Bonded | Level 21 | Level 35 | Level 50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Leaves it running (never feeds) | day 4 | day 11 | day 19 | day 32 | day 50 | day 96 | day 163 |
| Casual (1 hand-feed, 1 Feed a day) | day 3 | day 7 | day 13 | day 22 | day 38 | day 78 | day 137 |
| Attentive (3 hand-feeds, 2 Feeds a day) | day 2 | day 5 | day 9 | day 15 | day 26 | day 54 | day 95 |

The first five columns are the same as in 1.3.1: adding levels 21 to 50 made no
stage slower to reach.

## Gift checks

A **gift check** happens after every 8 minutes of *awake* time (the crow is
visible, not paused and not asleep), and once more right after every
hand-feeding. A check only succeeds if all of these hold:

- at least 20 minutes since the last gift,
- fewer than 4 gifts so far today,
- fewer than 2 uncollected gifts on screen.

When a check succeeds the crow flies off-screen, comes back a few seconds later
carrying the gift, lands near your pointer, sets it down (the *gift-drop*
animation), steps back and chirps. (Pick it up on the way and it drops the gift
right there.) You get a notification — *“<name> brought you something!”* — and
the gift sparkles until you click it. Uncollected gifts are saved and are still
there next time.

## Gift chance per check

| Tier | Every 8 min awake | After a hand-feed |
|------|-------------------|-------------------|
| Wary | 0% | 0% |
| Curious | 0% | 0% |
| Friendly | 6% | 3% |
| Trusting | 12% | 6% |
| Bonded | 20% | 10% |

Expected gifts per awake hour (before the 20-minute cool-down and the daily cap):
Friendly ≈ 0.45, Trusting ≈ 0.9, Bonded ≈ 1.5. The cool-down limits it to at most 3
an hour and the daily cap to 4 a day.

## Gift rarity

When a gift is given, its rarity is drawn with these weights for the crow's current
tier, then the item is picked uniformly within that rarity.

| Rarity | Friendly | Trusting | Bonded | Items |
|--------|---------:|---------:|-------:|-------|
| Common | 80 | 65 | 50 | bottle cap, foil ball, paperclip, smooth pebble, glossy black feather |
| Uncommon | 18 | 28 | 35 | glass marble, shiny coin, little brass key |
| Rare | 2 | 6 | 12 | pearl earring, gold ring |
| Legendary | 0 | 1 | 3 | sparkling gem |

## World item spawn table

Things occasionally drop from above onto a random spot of your desktop (anywhere
on it, top to bottom). Weights add up to 100. How often: *Rarely* every 8–15 min,
*Sometimes* (default) every 3–8 min, *Often* every 1–3 min, or *Never*. At most 5
world items exist at once; unclaimed ones fade away after 15 minutes.

| Item | Kind | Weight | Bites |
|------|------|-------:|------:|
| bread crust | food | 22 | 3 |
| peanut | food | 20 | 1 |
| apple | food | 14 | 4 |
| french fry | food | 10 | 2 |
| pair of cherries | food | 9 | 2 |
| cube of cheese | food | 7 | 2 |
| bottle cap | shiny | 8 | – |
| foil ball | shiny | 6 | – |
| glass marble | shiny | 4 | – |

Food makes the crow react (the *react-to-food-spawn* animation) and go and eat it.
Shiny things get inspected with a few pecks; about half the time the crow picks the
shiny up and flies off to stash it somewhere.

## Treasures

Every shiny thing ends up in your treasures (Settings → Treasures), whichever way
it comes:

* **Gifts** the crow brings you: click them to collect them (+4 trust, above).
* **Shiny things that drop onto your desktop:** click one before the crow gets it
  and it goes straight into your treasures. If the crow is on its way to it, it
  stops and looks puzzled.
* **Shiny things the crow stashes:** when it flies off with one, it is added to
  your treasures too; its hoard is yours.

Gifts that are still on their way (the crow has flown off to fetch one, or is
carrying one back) are saved as well, so quitting or hiding the crow at that
moment no longer loses them: they turn up on the desktop the next time the crow
is there.

## Droppings and health

Every number here comes from `src/core/care.js`.

**When it poops.** Each snack the crow eats fills its gut by 0.6 × the snack's
nutrition (0.15 to 0.45), and the gut also fills by 0.75 an hour while the crow
is awake on screen. When it passes a random mark between 0.9 and 1.3, and at
least 8 minutes after the last time, the crow lifts its tail and a white
dropping falls from under it onto the floor (or the window edge or taskbar it
stands on). It never does this while hidden, paused or still in its box, and
never with 5 droppings already on the screen. Settings → Behaviour → Droppings
turns it off, which also clears the screen. Droppings are saved, so they are
still there after a restart.

**Cleaning up.** Press on a dropping and rub back and forth: about 230 pixels of
rubbing over it (at 100 % size) cleans it, with soap bubbles, a sparkle and a
little chime. A click wipes a third of it. Each one cleaned gives the crow +6 %
happiness and +3 % health.

**What a mess does.** A dropping becomes a mess 2.5 minutes after it lands. While
messes are on the screen, each one takes 2.5 % happiness a minute and 30 % health
an hour, and the crow complains (*Messy*) and looks at it. Health shows in
Settings → Crow. Below 50 % the crow is unwell: it fluffs up and droops, coughs
now and then, walks more slowly, flies and dances less, tires faster and gets
sadder. At 40 % or less its mood is *Sick*. Health never drops below 8 %: the
crow cannot die.

**Getting better.** With the screen clean it recovers 36 % health an hour while
awake and 72 % an hour while asleep, plus 2 % for every snack, 3 % for every
dropping you clean and 20 % for every hour the app is closed.

**Fever kit.** While there is a mess on the screen, or while its health is below
50 %, the crow wears a blue ice bag on its head and holds a thermometer in its
beak (it puts the thermometer away to eat, peck, carry or cough).
