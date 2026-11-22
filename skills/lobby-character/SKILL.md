---
name: lobby-character
description: Put the user's own VRM avatar into the bundled "rooftop lobby" — a finished, gacha-game-style lobby screen (cyberpunk rooftop at night, Tripo-made city, camera work, poses, wind, game UI, video recorder) that ships with Shirayuki Luna as the sample character. Use when the user wants their avatar in the lobby, wants to swap the lobby character, rename it, or record a lobby video.
---

# Swap the character in the rooftop lobby

This kit is a **finished product**. The stage, Tripo-made buildings and cars, camera work, four poses, idle motion,
wind on spring bones, blinking/eye contact, the game UI and the video recorder are all done. Your job is only to
**put the user's avatar in and make it feel at home**. Do not rebuild or redesign the lobby unless the user asks.

Paths are relative to the repository root (the folder with `serve.mjs`). You need a browser you can drive to look
at the page; agents without one are not supported.

## What "done" looks like

The user's avatar stands in the lobby, moves through the poses and camera cuts, blends with the night lighting,
and its name appears in the UI. **Getting it running matters more than perfection.** Small imperfections
(a hand slightly off, a strand of hair clipping) are fine — mention them, don't block on them. The user judges
the look; they can ask you for refinements afterwards.

## The reference: Luna

`app/characters/luna/` is a known-good setup. Open the lobby with Luna first to see how it should look, and compare
the user's avatar against her when something seems off. Luna uses the optional cel-shaded look (`"look": "cel"`)
and an effect made only for her (`"fx"`); a new avatar normally uses `"look": "mtoon"` and no `fx`.

## How the swap works

1. Make a folder `app/characters/<id>/` (short ASCII id) and copy the user's VRM there (VRM 0.x or 1.0),
   e.g. `avatar.vrm`. **Copy, never move or edit the original.**
2. Write `app/characters/<id>/character.json`:
   ```json
   {
     "vrm": "avatar.vrm",
     "look": "mtoon",
     "ui": {"name": "表示名", "nameEn": "DISPLAY NAME", "tag": "TAG", "short": "短い名前", "sign": "屋上の看板の文字"},
     "mtoon": {}
   }
   ```
   `ui` fills the name plate, the floating name tag, the news ticker and the in-world ads/signs. Every field is
   optional. Take names from the VRM meta (in the page, `__avatar.vrm.meta` once loaded) or ask the user.
   `ui.lines` / `ui.news` can replace the speech bubbles and the ticker (`{name}` is replaced by the name).
   `mtoon` overrides the lighting match in `app/lobby/mtoon-look.mjs` (key/fill light colour and strength, rim
   colour, shade tint, bloom threshold).
3. Choose it: write `app/lobby.local.json` with `{"character": "<id>"}`. This file is the user's own setting and is
   not tracked by git; `app/lobby.json` (Luna) stays as the default. For a quick look without switching, add
   `?chara=<id>` to the URL.
4. Start the server with `node serve.mjs` (or `ロビーを開く.bat` on Windows). It prints the URL it opened
   (normally `http://127.0.0.1:8777/`, or the next free port). Look at it in your browser.
   URL options: `?pose=lookback|lean|chest|behind`, `?ui=0`, `?look=mtoon|cel`, `?free=1` (orbit camera).
   Keys: P pose, C cut, H hide UI. Each pose starts with a wide shot (about 13 s) before the face close-up,
   so watch a little longer, or press C to cut.

## Making it feel at home

Look at a few camera cuts in each pose and adjust what is clearly off, in whatever way fits this avatar. Typical
things worth a glance: overall brightness and colour against the night scene (`mtoon` values), whether hands land
roughly where they should in the poses (`app/lobby/poses.mjs` places wrists by IK targets, which assume Luna's
proportions), and whether the name tag or bubble covers the face. If something can't be made right quickly,
leave it working and tell the user.

## Optional

- **Cel-shaded look**: see the `lobby-cel` skill.
- **Video**: `node tools/record.mjs <pose> <seconds> out/<name>.mp4 1920 1080` while the server runs (it finds the
  server's URL by itself). Needs Google Chrome and ffmpeg. `CHARA=<id>` records another character without switching.
  Frames are stepped one by one, so there are no dropped frames. Record 15 s or more to include a face close-up.
- **Ads on the big screen**: add `"ad": {"file": "<image or mp4/webm>", "gain": 1.5}` to `app/stage/assets.json`
  and put the file in `app/stage/` (portrait, about 1:2).

## Rules

- Never modify or redistribute the user's original avatar files; work on a copy inside `app/characters/`.
- Luna's model: modification OK, redistribution NO, commercial use NO, credit required. Don't extract her model for
  other use.
- Don't spend Tripo credits or other paid services without asking.

## Report at the end

Tell the user briefly: what you set up (folder, look, names), anything you adjusted, anything you noticed but left
as is, and what they could ask for next (e.g. the cel-shaded look, tuning a pose for their avatar, a video, their
own ad on the big screen).
