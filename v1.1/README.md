# Snack Pack

Co-op for 1–4 players in the browser. Everyone sculpts a creature in a shared garage, hits Ready, and (from v2) staffs a physics-driven food truck together.

**v1 — the creator.** Six deformable bodies, 43 attachable parts, any number of legs and arms with procedural IK walking, freehand painting on the model, a recorded voice, cloud save slots and a live shared garage.

## Run locally

```bash
python3 serve.py 8177
```

Open <http://localhost:8177>. Add `?net=local` to force same-browser rooms (BroadcastChannel) instead of Firebase.

## Layout

- `src/creature/` — spec format, body deformation, part library, creature builder + IK gait
- `src/editor/` — placing/dragging parts, painting, voice recording
- `src/net/` — room transport (Firebase RTDB or BroadcastChannel behind one contract)
- `src/render/stage.js` — renderer, post-processing, garage set
- `tools/build_parts.py` — regenerates `assets/parts.glb` and `assets/garage.glb` with headless Blender:
  `Blender -b -P tools/build_parts.py`
- `database.rules.snackpack.json` — the `snackPack` block for the shared RTDB rules (merge, never deploy alone)

## Controls

Build: pick a part, click the body; drag parts to slide them; Shift keeps placing; Delete removes; Cmd/Ctrl+Z undoes.
Walk: WASD / arrows, Shift to run, Q to talk.
