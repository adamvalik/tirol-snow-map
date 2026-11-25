# Instagram

How the [@cimamap](https://www.instagram.com/cimamap/) account works: what it posts and why, how a post is made, and how posting moves from by hand to automatic. Started Nov 24, 2026, with no followers. The posts themselves are in [`social/`](../social/).

## The idea

Every post answers the question the app answers: **where is the snow in South Tyrol, and where will it be?** It does so with the app's own data on the real terrain, never with stock photos or generated landscapes. That is the account's edge. Most snow content on Instagram is either a photo from one slope or a dramatic model map picked from many. A map of what the satellite saw, what about 350 stations measured and what the forecast blend says, with its date on it, is rarer and more useful.

Being right matters more than being loud. A viral snow map that turns out wrong costs the trust the app lives on, and weather accounts that hype forecasts are called out for it. So the posts say "forecast", give the time it is for, and use "up to" only for the most anywhere in the area.

## Who it is for

- Ski tourers, freeriders, hikers and snowshoers in South Tyrol, North Tyrol and Trentino, who plan the weekend from the snow.
- People who live there and want to know if their valley got snow.
- Visitors planning a trip, often from Germany, Austria, Italy and the Czech Republic.

## What works for a new account in 2026

From Instagram's own statements (Adam Mosseri) and the larger studies of 2026. The exact weights are not public, and blogs often add precise numbers they cannot know:

- **Reels reach people who do not follow you yet.** For accounts under 1,000 followers they get clearly more reach than pictures or carousels. Watch time decides: short reels that are watched to the end win.
- **Sends are the strongest signal for new people.** A post someone sends to a friend in a DM ("look, snow on Saturday") is worth more than a like. Posts should be worth sending: about a day, a place or a plan.
- **Carousels get saved.** They do best for engagement and saves among people who already follow, and Instagram says they are growing.
- **Hashtags matter less.** Instagram is capping them at five per post (rolling out since December 2025). Keywords in the caption and the name field do more: Instagram search reads them.
- **Original content is ranked higher.** Reposts and watermarked videos from other apps are pushed down.
- **Trial reels** (shown to non-followers first) need 1,000 followers. Use them once there.

## What we post

| Format | For | Examples |
| --- | --- | --- |
| **Reel**, 9:16, 8–15 s | Reach | The forecast snow building up over the terrain; before and after from space; sun and shade over a valley from sunrise to sunset |
| **Carousel**, 4:5, 3–7 slides | Saves and sends | What the map shows; where the most new snow fell, by station; one valley or summit up close |
| **Picture**, 4:5 | The grid | South Tyrol as a block with today's snow; a summit in the first snow |
| **Story**, 9:16 | Followers, the link | The day's snow with a link sticker; a poll ("ski or wait?") |

Feed pictures are 1080 × 1350 (4:5). The profile grid shows 3:4, which cuts 34 px from each side, so the frame keeps text away from the sides. The API also takes no picture narrower than 4:5.

**Anything the app shows is material**, not only the snow of the day:

- **Every layer**: the depth estimate, snow from space, stations, the forecast, sun and shade, lifts and slopes in 3D, via ferratas, bivouacs, the true-colour satellite photo.
- **Tracks**: a GPX tour on the terrain, with its distance, climb, highest point, the snow along it and the elevation profile, as the share picture design draws it (`docs/design/share-snapshot.md`). The owner's own tours, example routes, and tours others send in (see the rules).
- **Comparisons**: the same valley at noon on 21 June and 21 December, where the shade lies in each; the snow line now and two weeks ago (the timeline keeps 14 days); a north face against the south face across the valley. A snow comparison of summer and winter needs a summer satellite day, which the app does not keep: it takes a one-off fetch of an archived Sentinel-2 scene.
- **Facts**: the highest station, the deepest snow measured, how far the shadow of a ridge reaches in December.

**The weather sets the rhythm.** A storm is three posts: the forecast reel a day or two before, the stations' new snow once it has fallen, and the satellite's before and after on the first clear day. In calm weeks, two posts: a place, a feature, sun and shade. In winter about three posts a week plus stories, never a post for the sake of posting.

**When.** Thursday and Friday evening for the weekend; the morning after a snowfall; a forecast reel as soon as the storm is in the 3-day forecast.

## How it sounds

- Plain, short, calm English. A first line that says what the picture shows ("Up to 65 cm of new snow by Friday").
- The place names people search: South Tyrol, Südtirol, Alto Adige, and the valley or group (Vinschgau, Dolomites, Ötztal Alps).
- One line in German and one in Italian at the end, for the people who live there.
- At most one emoji, three to five hashtags.
- An en dash (–), never an em dash. No middle dots.
- Ask for a send only when the post is useful to send ("Send it to the one you tour with").

## The rules

The app's rules hold on Instagram too (`CLAUDE.md`, Rules for the app):

- **Avalanches: link, never assess.** Snow posts end with "Not for avalanche decisions: avalanche.report". No danger levels, no "safe", "good to go" or "perfect conditions". Lots of new snow is news, not an invitation.
- **Nothing personal.** No one's track, location or face without their consent; followers' GPX files never.
- **Credit every source on the picture**: OpenStreetMap, Mapterhorn, Copernicus Sentinel-2, Open-Meteo, the station operators, for the layers shown.
- **Only our own pictures**, or others' with their written consent and their name on the post (a collab post is best).
- **Tracks.** A track someone sends is posted only with their written consent, with their name only if they want it, and with the first and last few hundred metres cut when it starts at a home. An example route is labelled as one ("an example line"), never shown as a tour someone did. In winter a track is what someone did on a given day, with that day on it, never a recommendation to go: the snow and the slope change, the bulletin decides.

## Growing from zero

The algorithm does not know the account yet, so the first followers come from people:

- **Collab posts.** A mountain guide, a hut, a ski touring school or a photographer posts with us: their photo of the day, our map of the snow around it. The post shows on both profiles.
- **Comments with substance** on posts of local accounts (tourism boards, huts, guides, ski areas), from the @cimamap account, about the snow on their mountain. Ten minutes a day, by hand: this is the part that cannot be automated.
- **The testers.** The first people who use the app are the first followers; the link in the app's About tab and in the WhatsApp groups brings them.
- **Location tags** on every post (the valley or the summit) and keywords in the caption, so search finds the posts.
- **Every link is counted by its channel**: the bio link is `cimamap.com/ig`, a page that opens the map with `?ref=ig-bio` (`web/public/ig/index.html`), so the bio shows a clean address; story stickers `?ref=ig-story` (README, Feedback and visit counts). GoatCounter then shows which posts bring visits.

## Measuring

Once a week, from Instagram's Insights (and later from the API): reach from non-followers, sends per reach, saves, profile visits, and visits with `ref=ig-*` in GoatCounter. Followers count last: a post with many sends and few likes is a good post.

## Making a post

`scripts/social.mjs` renders a post from the live map:

```sh
npm ci
node scripts/social.mjs storm     # forecast reel (9:16 MP4), cover (4:5) and story (9:16)
node scripts/social.mjs intro     # the carousel that says what the map shows
node scripts/social.mjs island    # South Tyrol with the snow the satellite saw last
node scripts/social.mjs fallen    # after a storm: the stations with the most new snow in 72 h
```

It opens cimamap.com in Chromium, captures the bare map canvas as the share picture mock-ups do (`docs/design/share-snapshot.md`) and frames it in the app's font. Numbers and times come from the site's data files, so a post shows the data of the moment it was made. The pictures land in `social/posts/<date>-<post>/`; they are not kept in git. The caption, alt text and the time to post go next to them in `caption.md`, which is kept, so the folder is the log of what was posted.

The reel needs `ffmpeg`. It is silent: music is added in the Instagram app, because licensed music cannot be added through the API.

### What goes with a post

`caption.md` holds everything that is set in the app besides the pictures, so posting from the phone is copying, not deciding. Everything that is pasted (the caption, each alt text, a sticker's text) sits in its own code block, so it copies with one tap on a phone; the rest is a short list. What it covers:

| Setting | For | What to put |
| --- | --- | --- |
| **Caption** | All | The text, ready to paste: first line what it shows, the German and Italian lines, the avalanche line on snow posts, at most five hashtags |
| **Alt text** | Pictures, carousels | One line per picture, what it shows (Advanced settings, Write alt text) |
| **Location** | All | The valley, the group or South Tyrol (Südtirol) |
| **Music** | Reels, optionally carousels | A mood and search words for the app's library (calm, instrumental, no lyrics over text), at low volume so the map is the point. Instagram's suggestions change daily, so the name of a track is picked in the app: one marked trending (an arrow) helps reach. Not on posts with sad or tense news |
| **Cover** | Reels | Which frame, usually the last one with the number and the address; checked in the 3:4 grid crop |
| **Topics** | Reels | Up to three in Advanced settings, for example Skiing, Weather, Travel |
| **Share to feed** | Reels | On, so the reel is on the grid |
| **Pin** | When it matters | The intro carousel always; a storm post until the storm is over |
| **Story** | When it brings the link | Which picture, the link sticker (`cimamap.com/?ref=ig-story`), its text, and a poll or quiz if one fits |
| **After posting** | All | Answer comments the same day; note under Posted in `caption.md` when it went out |

## From by hand to automatic

The account moves in three steps. Each needs the one before to have run without surprises for a few weeks.

1. **By hand.** Posts are rendered and written in a session, sent to the owner and posted from the phone, with music added there. This is where the look, the captions and the rhythm are found.
2. **Approved, then automatic.** A workflow renders a post and opens a pull request with it; merging it approves it, and the workflow publishes it at the planned time.
3. **Automatic.** The workflow posts on its own when the data says so, for example when the forecast has more than 30 cm in 72 hours, and only when `status.json` reports every step healthy. A wrong map in public costs more than a missed post.

Steps 2 and 3 use the Instagram API with Instagram Login (Meta's [content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/)):

- The account must be a professional account (Creator or Business).
- A Meta developer app with the Instagram product, @cimamap added to it, gives an access token. It lasts 60 days and is refreshed by a scheduled job. It is a repository secret, never in the code.
- Instagram fetches each picture or video from a public address, so the workflow puts the files on the site first. Pictures must be JPEG, at most 8 MB, between 4:5 and 1.91:1.
- Reels, carousels and stories can be published, and the account's daily limit is read from the API (`content_publishing_limit`) rather than assumed.

## Setting up the account

Done once, by the owner, in the Instagram app:

- **Professional account, type Creator.** Creator accounts get the full music library for reels; Business accounts only the commercial one. Both work with the API. Category: *App page* or *Science, technology & engineering*.
- **Name** (searchable, unlike the bio): `Cima Map – South Tyrol snow map`.
- **Bio** (150 characters at most):

  ```
  Where is the snow in South Tyrol?
  3D map: snow from space, 350 stations, forecast.
  Free, no account.
  Not for avalanche decisions.
  ```

- **Link**: `https://cimamap.com/ig` (opens the map, counted as from the bio).
- **Picture**: [`docs/design/logo/cima-avatar-1080.png`](design/logo/cima-avatar-1080.png).
- **Contact e-mail**: hello@cimamap.com.
- **Two-factor login** on, with the backup codes kept outside the phone.
- **Before the account is shared**, it has the intro carousel and one current post, both pinned.
