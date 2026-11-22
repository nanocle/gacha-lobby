---
name: lobby-cel
description: Optional. Give an avatar in the rooftop lobby the same crisp cel-shaded look as the sample character Shirayuki Luna (one hard shadow step, a face that stays clean with only hair shadows on it, rim light, bloom), instead of the default MToon look. Use when the user asks for the cel / anime / toon look in the lobby.
---

# Cel-shaded look for a lobby character (optional)

The default look (`"look": "mtoon"`) already works for any avatar. This skill is the optional upgrade to the look
Luna has (`app/characters/luna/`, `"look": "cel"`). Read the `lobby-character` skill first; the character should
already run in the lobby.

## The goal

Make the avatar look like it belongs next to Luna: flat colours, **one crisp shadow step** from the key light,
a face that is always on the lit side and only receives hair shadows, a rim light from behind, glow only on
genuinely bright parts. Use your judgement on how to get there for this particular avatar. A good first version
the user can look at beats a perfect one; they can ask for refinements afterwards.

## The reference implementation (Luna)

- `app/lobby/cel-look.mjs` — the browser shader (three.js, replaces the VRM's MToon materials at load). It reads
  `characters/<id>/<cel>/cel-data.json` and the PNGs beside it. It was built for Luna's data; adapt it as you see
  fit (`app/lobby.html` calls `setupCelLook(vrm, dir, fx)` when `"look": "cel"` and `"cel"` are set in
  `character.json`).
- `app/characters/luna/cel/` — Luna's data: `cel-data.json` (shader values in `state`, light directions in
  `lights`, per-material info, per-vertex head data used for the iris and face, and the face shadow caster) and the
  textures (`LunaCel_tex_<part>.png`, skin masks `LunaCel_skinmask_<part>.png`, iris, sclera).
- Luna's renderer maps her materials by name (`Material_head`, `Material_hair`, `Material_upper_body`,
  `Material_lower_body`, `Material_accessories`, `Material_sclera` — see `KEY` in `cel-look.mjs`). The user's avatar
  will usually have different materials; map them to the closest role (skin, hair, clothes, eyes) as you see fit.
- `reference/` — how Luna's data was produced in Blender: `build_cel.py` (node setup, skin masks, iris, face shadow
  caster), `luna_cel_fx.py`, `luna_cel_panel.py` (the tuning panel), `export_web.py` (Blend → `cel-data.json` and
  PNGs) and `luna-cel-notes.md` (how the look is put together, and Luna's values). They assume Luna's working
  files; read them for the method, not as scripts to run unchanged. Building the data directly from the VRM without Blender is equally fine.

## Notes

- **Use the avatar's existing textures.** Luna's were re-textured in Tripo with lighting removed, but that is not
  needed; ordinary textures look nearly the same under the cel shader. Don't spend Tripo credits unless the
  user asks for it.
- Avatars differ: eyes may not be separate parts or may have no weights, hair may be merged with the head, and so
  on. Do what makes sense for the avatar in front of you, and tell the user what you did differently from Luna.
- Keep the user's original files untouched; write everything into `app/characters/<id>/` (and new code files if
  you need them).
- When done, set `"look": "cel"` and `"cel": "<folder>/"` in the character's `character.json`. `?look=mtoon` in the
  URL still shows the default look for comparison.

## Report at the end

What you made, where it differs from Luna and why, what you noticed but left as is, and what the user could ask
for next (e.g. tune shadow colour or strength, separate the eyes so the iris can glow, re-texture with lighting
removed in Tripo for an even flatter look).
