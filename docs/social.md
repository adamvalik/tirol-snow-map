# Instagram

The strategy of the [@cimamap](https://www.instagram.com/cimamap/) account, and the source of truth for it: what it posts, how often, why, and how a post is made. Started Nov 24, 2026, with no followers.

## Where things live

| What | Where |
| --- | --- |
| Strategy, series, rules, how a post is made | This file |
| Calendar, ideas, what was posted and how it did | The [tracker](https://claude.ai/artifact/46gg9eDGJTzrsT65PXFsCp), a private dashboard. Sessions read and write it |
| A post's pictures, caption, alt text and settings | `social/posts/<date>-<post>/`, made by `scripts/social.mjs` |
| Work on the post scripts | GitHub issues in the `Growth` milestone |

A post idea goes into the tracker, not into this file. A new kind of post that works goes into this file.

## The idea

The account does two jobs at once:

- **It answers the question the app answers**: where is the snow in South Tyrol, and where will it be? With the app's own data on the real terrain, never stock photos or generated landscapes. A dated map of what the satellite saw, what about 350 stations measured and what the forecast says is rarer and more useful than a photo from one slope.
- **It shows the app.** Reels of what the map can do (sun and shade, lifts in 3D, a tour on the terrain, the timeline) make people want to try it themselves. These posts are for views and curiosity, and every one ends on cimamap.com.

Being right matters more than being loud. A viral snow map that turns out wrong costs the trust the app lives on. Posts say "forecast" and give the time it is for, and use "up to" only for the most anywhere in the area.

## Until Christmas: try everything

From the launch to Thu 24 Dec 2026 the account tries every series and every kind of post below, at a high pace, and the tracker keeps the numbers. After Christmas the numbers decide which kinds stay, which get more and which go. No follower target: it is an experiment.

| Period | Feed posts | Stories |
| --- | --- | --- |
| To Sun 6 Dec | Every day or every other day, when there is something worth posting | Every day |
| 7 to 24 Dec | 4 to 5 a week | Most days |

- **Reels wherever something moves**: snow building up, the shade going round, the camera along a track or around a summit. Most posts are reels.
- **A carousel** when there is something to read and save (a list of stations, a how-to, a comparison).
- **A picture** for one clear number or one striking view.
- **Never two feed posts on the same day.** A storm or a release takes the slot; the planned post moves to the next free day.
- **No post for the sake of the pace.** A missed day costs less than a wrong map.

## Series

Recurring posts with the same look each time, so people recognise them and come back.

| Series | When | Format | What | Script |
| --- | --- | --- | --- | --- |
| **Weekend snow** | Every Friday, about 17:00 | Reel | Snow now, the forecast to Sunday, the snow line; three numbers that matter | `weekend` |
| **Storm** | When the 3-day forecast has 20 cm or more somewhere | Reel, picture, reel | 1. The forecast building up, as soon as the storm is in the forecast. 2. What fell at the stations, the evening or morning after. 3. Before and after from space, on the first clear day | `storm`, `fallen`, `fromspace` |
| **Map trick** | Once a week | Reel | One thing the map does, shown in use. Ends on "Try it: cimamap.com" | `sun`, `lifts`, `timeline`, phone recording |
| **Tour** | Every two weeks | Reel or carousel | One of our own GPX tracks on the terrain, with its numbers and the snow along it (see Tours) | `track` |
| **Place** | Once a week | Reel | One mountain group or valley with today's snow, its name in German, Italian and English, location tag on | `orbit` |

The rest of the week is filled with one-off posts.

## One-off posts

Ideas that do not belong to a series. Each is tried at least once before Christmas.

| Kind | Format | Examples |
| --- | --- | --- |
| **Facts** | Carousel | The 350 stations and where they stand; the highest station; the deepest snow today; what a brown dot means |
| **Comparisons** | Reel or carousel | Noon on 21 June and 21 December in the same valley; a north face and the south face across from it; the snow line now and two weeks ago |
| **How to** | Reel, phone recording | Check your mountain in 10 seconds; load a GPX file; share the view |
| **From space** | Picture or carousel | The true-colour satellite photo; what "60 m from space" means and why clouds hide the snow |
| **Releases** | Reel or carousel | Every version people can see: the feature shown in use, with the release notes in plain words. The share picture (`v1.1.0`) is made with the feature itself |
| **Days** | Reel | The shortest day (21 Dec): where the sun does not reach |

A phone screen recording of the app is a quick reel when a script does not exist yet: open the map, do the thing, end on the address. Instagram ranks it as original content.

**Anything the app shows is material**: the depth estimate, snow from space, stations, the forecast, sun and shade, lifts and slopes in 3D, via ferratas, bivouacs, the true-colour satellite photo, tracks, the timeline of 14 days back and 3 ahead. A snow comparison of summer and winter needs a summer satellite day, which the app does not keep: it takes a one-off fetch of an archived Sentinel-2 scene.

## Tours

Tours are the posts people send to the one they tour with, and the case the share picture is built for. Our own GPX tracks only, until people send theirs.

- **Then and now**: a tour from summer or autumn, shown with today's snow. A comparison, not advice; it works in any weather.
- **What we did**: a winter tour, posted after it is done, with its date: the snow on that day. Never "go there now", and the avalanche line at the end.
- **For later**: a via ferrata or summer route with the snow on it now ("when will it melt?").
- The start and the end near a home or a car park are cut. The GPX file itself is never published.
- After `v1.1.0`, people make their own track pictures. Theirs are posted only with their written consent, best as a collab post with their name.

## Who it is for

- Ski tourers, freeriders, hikers and snowshoers in South Tyrol, North Tyrol and Trentino, who plan the weekend from the snow.
- People who live there and want to know if their valley got snow.
- Visitors planning a trip, often from Germany, Austria, Italy and the Czech Republic.

## What works for a new account in 2026

From Instagram's own statements (Adam Mosseri) and the larger studies of 2026. The exact weights are not public:

- **Reels reach people who do not follow you yet.** Under 1,000 followers they get clearly more reach than pictures or carousels. Watch time decides: short reels watched to the end win.
- **Sends are the strongest signal for new people.** A post sent in a DM ("look, snow on Saturday") is worth more than a like.
- **Carousels get saved.** They do best with people who already follow.
- **Hashtags matter less.** At most five per post. Keywords in the caption and the name field do more: Instagram search reads them.
- **Original content is ranked higher.** Reposts and watermarked videos from other apps are pushed down.
- **Trial reels** (shown to non-followers first) need 1,000 followers. Use them once there.

## Formats

| Format | Size | Rules |
| --- | --- | --- |
| **Reel** | 9:16, 1080 × 1920, 8–15 s | The map already moving and the headline on screen in the first second, no logo intro. One idea per reel. The last frame has the number, the logo and cimamap.com, and is the cover. Silent; music is added in the app |
| **Carousel** | 4:5, 3–7 slides | The first slide says what the rest shows |
| **Picture** | 4:5, 1080 × 1350 | The profile grid shows 3:4, which cuts 34 px from each side, so text stays away from the sides. The API takes no picture narrower than 4:5 |
| **Story** | 9:16 | Each feed post shared to the story the same day, with the link sticker. Polls and quizzes on quiet days |

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
- **Tracks** follow the rules under Tours. An example route is labelled as one ("an example line"), never shown as a tour someone did.

## Growing from zero

The algorithm does not know the account yet, so the first followers come from people:

- **Comments with substance** on posts of local accounts (tourism boards, huts, guides, ski areas), from the @cimamap account, about the snow on their mountain. Ten minutes a day, by hand: this is the part that cannot be automated.
- **Collab posts.** A mountain guide, a hut, a ski touring school or a photographer posts with us: their photo of the day, our map of the snow around it. The post shows on both profiles.
- **The testers.** The first people who use the app are the first followers; the link in the app's About tab and in the WhatsApp groups brings them.
- **Location tags** on every post (the valley or the summit) and keywords in the caption, so search finds the posts.
- **Every link is counted by its channel**: the bio link is `cimamap.com/ig`, a page that opens the map with `?ref=ig-bio` (`web/public/ig/index.html`), so the bio shows a clean address; the WhatsApp groups get `cimamap.com/wa` (`?ref=wa-erasmus`, `web/public/wa/index.html`); story stickers `?ref=ig-story` (README, Feedback and visit counts). GoatCounter then shows which posts bring visits.

## Measuring

Every Monday, about 15 minutes: the numbers of last week's posts go into the tracker from Instagram's Insights (and later from the API). Per post: views, reach, the share of non-followers, sends, saves and likes. Per week: visits with `ref=ig-*` in GoatCounter and the follower count.

The tracker compares the kinds of posts by sends and saves per 1,000 reach, so a reel with many views and a carousel with few can be weighed fairly. Followers count last: a post with many sends and few likes is a good post. At Christmas this comparison decides what the account posts next.

## Making a post

`scripts/social.mjs` renders a post from the live map:

```sh
npm ci
node scripts/social.mjs storm     # forecast reel (9:16 MP4), cover (4:5) and story (9:16)
node scripts/social.mjs intro     # the carousel that says what the map shows
node scripts/social.mjs island    # South Tyrol with the snow the satellite saw last
node scripts/social.mjs fallen    # after a storm: the stations with the most new snow in 72 h
node scripts/social.mjs weekend   # Friday: snow on the ground by height, new snow to Sunday (reel and story)
node scripts/social.mjs track --gpx ~/tour.gpx --kind Hike   # Tour: a flight along our own GPX track (reel)
```

It opens cimamap.com in Chromium, captures the bare map canvas as the share picture mock-ups do (`docs/design/share-snapshot.md`) and frames it in the app's font. Numbers and times come from the site's data files, so a post shows the data of the moment it was made. The pictures land in `social/posts/<date>-<post>/`; they are not kept in git. The caption, alt text and the time to post go next to them in `caption.md`, which is kept, so the folder is the log of what was posted.

`--quick` renders a few frames only, to check the camera and the text. On a Mac, point `CHROMIUM_PATH` at Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`); a flight renders about 2 s a frame, so an 11 s reel at 30 frames a second takes about 12 minutes. Start a long render with `caffeinate -is` in front, or a Mac that goes to sleep stalls it.

A flight renders every frame of the video at fixed zoom and tilt (only turning and drifting), so the terrain does not pop between detail levels; blended in-between frames read as stutter. It shows the mountain groups, the valleys in German and Italian and the towns over about 13,000 people, larger than on screen. The weekend reel gives the snow on the ground as the median depth of the stations within 250 m of 1,500, 2,000 and 2,500 m (at least four each), and the new snow as the most anywhere in the forecast to the end of Sunday. The track reel flies along a GPX track on the snow the satellite saw on the day of the tour (the day slider), over the land cover, so forest, meadows and snow read as a real place. The line draws itself behind a dot while the height and the distance count up over an elevation profile coloured by what the satellite saw along the way (snow, bare, not seen); the last three seconds hold on the tour's distance, climb, highest point and the share of the way on snow. The camera looks along the way the track goes over a long stretch, so switchbacks do not swing it. The first and the last 400 m are cut (`--trim`), and only the line, the heights and the day are read from the file: no times of day, no heart rate. The file stays outside the post folder, and `.gitignore` keeps every `*.gpx` but the test fixtures out of git. `--title`, `--kind` and `--date` override what the file says; `--seconds` sets the length (14 s). The reel needs `ffmpeg`. It is silent: music is added in the Instagram app, because licensed music cannot be added through the API.

### What goes with a post

`caption.md` holds everything that is set in the app besides the pictures, so posting from the phone is copying, not deciding. Everything that is pasted (the caption, each alt text, a sticker's text) sits in its own code block, so it copies with one tap on a phone; the rest is a short list. What it covers:

| Setting | For | What to put |
| --- | --- | --- |
| **Caption** | All | The text, ready to paste: first line what it shows, the German and Italian lines, the avalanche line on snow posts, at most five hashtags |
| **Alt text** | Pictures, carousels; reels where the app offers it | One line per picture, what it shows (Advanced settings, Write alt text). The app does not offer it for reels everywhere |
| **Location** | All | The valley, the group or South Tyrol (Südtirol) |
| **Music** | Reels, optionally carousels | A mood and search words for the app's library (calm, instrumental, no lyrics over text), at low volume so the map is the point, where the editor has a volume slider. Instagram's suggestions change daily, so the name of a track is picked in the app: one marked trending (an arrow) helps reach. Not on posts with sad or tense news |
| **Cover** | Reels | Which frame, usually the last one with the number and the address; checked in the 3:4 grid crop |
| **Topics** | Reels, where the app offers it | Up to three in Advanced settings, for example Skiing, Weather, Travel; not in every app version or region |
| **Share to feed** | Reels | On, so the reel is on the grid |
| **Pin** | When it matters | The intro carousel always; a storm post until the storm is over |
| **Story** | When it brings the link | Which picture, the link sticker (`cimamap.com/?ref=ig-story`) with its own text set in the app ("Customize sticker text"; without it the sticker shows the bare address), and a poll or quiz if one fits. Where they go: the poll or quiz over the map in the middle, never in the top band where Instagram shows the account and the progress bar; the link sticker under the credits, above the reply bar |
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
