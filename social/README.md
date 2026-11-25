# Instagram posts

One folder per post, `posts/<date>-<post>/`, made by `node scripts/social.mjs <post>` (see [`docs/social.md`](../docs/social.md)).

- The pictures and the reel are rendered into the folder and not kept in git: they can be made again, and the data they show is that of the day.
- `caption.md` is kept. It holds the caption, the alt text, the location tag, when to post and what was posted, so the folders are the log of the account.
