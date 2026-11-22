# 読み取り専用: セルルックの Blend から、ロビーのセルルック（app/lobby/cel-look.mjs）用のデータを書き出す。Blend は保存しない。
#   blender -b <セルルックの Blend> --python export_web.py -- <build_cel.py のあるフォルダ> <出力フォルダ>
# 出力: cel-data.json（数値・ライトの向き・頂点ごとの値）と、Blend に入っているテクスチャの PNG
# 座標は three.js 向け (x, z, -y)。
import bpy, sys, os, json, importlib.util
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
WORK, OUT = a[0], a[1]
os.makedirs(OUT, exist_ok=True)
T = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]

spec = importlib.util.spec_from_file_location("luna_cel_panel", os.path.join(WORK, "luna_cel_panel.py"))
pan = importlib.util.module_from_spec(spec); spec.loader.exec_module(pan)
data = {"source": os.path.basename(bpy.data.filepath), "state": pan.collect()}

# ---- ライト（光へ向かう向き） ----
lights = {}
for nm in ("LunaCel_Sun", "LunaCel_RimSun", "LunaCel_FaceSun"):
    o = bpy.data.objects[nm]
    lights[nm] = T((o.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized())
data["lights"] = lights

# ---- マテリアル: 使っている画像と、肌の色合わせ ----
mats, images = {}, {}
for m in bpy.data.materials:
    if not m.name.startswith("LunaCel_") or m.name.startswith("LunaCel_outline") or not m.node_tree:
        continue
    info = {"images": [], "groups": []}
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image:
            info["images"].append(n.image.name); images[n.image.name] = n.image
        if n.type == "GROUP" and n.node_tree:
            info["groups"].append(n.node_tree.name)
            if n.node_tree.name == "LunaCel_Grade":      # 全体の色味（v1 のパネルが足したもの。値はグループの入力にある）
                info["grade"] = dict(tint=[round(x, 4) for x in n.inputs["Tint"].default_value[:3]],
                                     brightness=round(n.inputs["Brightness"].default_value, 4),
                                     saturation=round(n.inputs["Saturation"].default_value, 4))
            if n.node_tree.name == "LunaCel_Skin" and n.inputs["Base"].links:
                src = n.inputs["Base"].links[0].from_node
                if src.type == "MIX":
                    info["skinFix"] = [round(x, 4) for x in src.inputs[7].default_value[:3]]
    mats[m.name] = info
data["materials"] = mats

for name, img in images.items():
    w, h = img.size
    if "--noimg" in a:            # 数値だけ取り直すとき
        data.setdefault("images", {})[name] = dict(size=[w, h], colorspace=img.colorspace_settings.name)
        continue
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    out = bpy.data.images.new("__export_" + name, w, h, alpha=False)
    out.colorspace_settings.name = img.colorspace_settings.name
    px.reshape(-1, 4)[:, 3] = 1.0
    out.pixels.foreach_set(px)
    out.filepath_raw = os.path.join(OUT, name + ".png"); out.file_format = "PNG"; out.save()
    data.setdefault("images", {})[name] = dict(size=[w, h], colorspace=img.colorspace_settings.name)
    bpy.data.images.remove(out); del px
    print("IMAGE", name, w, h)

# ---- 頭: 頂点ごとの「顔の正面」の度合い、瞳かどうか、瞳の UV ----
head = bpy.data.objects["Head"]; me = head.data
flat = me.attributes["lc_flat"].data if "lc_flat" in me.attributes else None
uv = me.uv_layers.active.data
iris = {}
for p in me.polygons:
    mt = me.materials[p.material_index]
    if mt and mt.name == "LunaCel_eye":
        for li, vi in zip(p.loop_indices, p.vertices):
            iris[vi] = (round(uv[li].uv.x, 5), round(1.0 - uv[li].uv.y, 5))       # glTF の向き（上下逆）
FXN = ("fx_gain", "fx_solid", "fx_halo", "fx_hc", "fx_hs", "fx_phase")
FXA = {n: (me.attributes[n].data if n in me.attributes else None) for n in FXN}
rows = []
for v in me.vertices:
    u = iris.get(v.index)
    rows.append(T(head.matrix_world @ v.co) + [round(flat[v.index].value, 4) if flat else 0.0, 1 if u else 0, u[0] if u else 0, u[1] if u else 0]
                + [round(FXA[n][v.index].value, 4) if FXA[n] else 0.0 for n in FXN])       # 発光の強さ, 全体発光, 輪, 輪の角度 cos, sin, 明滅のずれ
data["head"] = rows

# ---- 顔へ影を落とす髪（細い毛束を除いたもの）の頂点 ----
fc = bpy.data.objects.get("LunaCel_FaceCaster")
data["faceCaster"] = [T(fc.matrix_world @ v.co) for v in fc.data.vertices] if fc else []

json.dump(data, open(os.path.join(OUT, "cel-data.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("EXPORTED head", len(rows), "iris", len(iris), "caster", len(data["faceCaster"]))
print("MATS", json.dumps(mats, ensure_ascii=False))
print("LIGHTS", json.dumps(lights))
print("STATE", json.dumps(data["state"], ensure_ascii=False))
