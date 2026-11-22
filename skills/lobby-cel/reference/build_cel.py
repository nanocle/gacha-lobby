# 白雪 ルナ セルルック版（v3）の組み立て。source.blend（完成 Blend のコピー）から毎回掛け直す。
#   blender -b source.blend --python build_cel.py -- <作業フォルダ>
# 出力: luna_cel.blend
#
# 方針: 顔以外は細工をしない、普通のライティング。ぼかし・なだらかな変化・カメラの位置を使う計算は入れない。
#   基準の色 = テクスチャ × 環境色          … 主光が当たっていない所（影）は全部この色
#   主光      面がライトを向いていて、かつ遮られていない所だけ明るくする。影はモデル自身が落とす影そのまま
#   リム      後ろに置いた2本目のライト。同じ計算で、当たった面にリムの色を足す
#   顔        正面は主光と無関係にいつも明るい側。変化は「髪の落ち影」だけ（顔専用のライト）
# 法線はメッシュの元のまま（顔の正面だけ前向きにそろえる）。
# ライトは色のチャンネルで読み分ける（色は絵には出ない）:
#   赤 = 主光（LunaCel_Sun）   緑 = 顔用（受けるのは Head、影を落とすのは細い毛束を除いた髪）   青 = リム（LunaCel_RimSun）
import bpy, bmesh, sys, os, math, json, importlib.util
import numpy as np
from mathutils import Vector

WORK = sys.argv[sys.argv.index("--") + 1]

# ================= 調整する数値（パネルで触れるものの初期値） =================
IRIS_IMAGE = "eye/iris-3.png"
LIGHT = dict(az=-55.0, el=18.0)             # 主光。0° が正面、プラスで本人の左（画面の右）
RIM = dict(az=150.0, el=20.0)               # リム用のライト1本。180° が真後ろ。プラスで本人の左後ろ（画面の右）
FACE = dict(el=50.0, follow=0.35, limit=18.0, cut=0.5, edge=0.02, blur_mm=0.8, angle=0.05,
            min_strand_cm2=10.0,              # これより小さい髪の部品は、顔へ影を落とさない
            min_local_cm2=1.2)                # 半径 1cm 以内の髪の面積がこれより小さい所（細い毛束）も、顔へ影を落とさない
SUN_STRENGTH = 3.0
BACKGROUND = (0.004, 0.005, 0.010)

GLOBAL = dict(Ambient=(0.58, 0.64, 0.86), LightColor=(1.00, 0.96, 0.90), LightGain=1.60, ShadowColor=(1.0, 1.0, 1.0),
              RimColor=(0.55, 1.00, 0.92), RimStrength=0.9, Flatten=0.5)
# 部位ごと（詳細）。Threshold = 明るい側になり始める面の向き（0 で真横）、Flat = 描き込みを飛ばす効き具合
SKIN = dict(Threshold=0.05, RimThreshold=0.05, Flat=0.6, Rim=1.0)
HAIR = dict(Threshold=0.05, RimThreshold=0.05, Flat=1.0, Rim=1.0)
CLOTH = dict(Threshold=0.05, RimThreshold=0.05, Flat=0.0, Rim=1.0)
EYE = dict(ShadowTint=(0.86, 0.84, 0.95), Boost=1.04, AmbientAmount=0.4)
SCLERA = dict(ShadowTint=(0.80, 0.78, 0.92), Boost=1.0, AmbientAmount=0.6)
LABEL = dict(Threshold="主光の境目の位置", RimThreshold="リムの境目の位置", Flat="描き込みを飛ばす効き具合", Rim="リムの効き具合",
             ShadowTint="影の中の色", Boost="明るさ", AmbientAmount="環境色の効き具合")
EDGE = 0.008      # 境目の幅（アンチエイリアス用の最小限。ぼかしではない）

# 法線のスムージングは v3 では使わない（関数は残してある。使うなら main の呼び出しを戻す）
SMOOTH_HAIR = dict(cell=0.02, passes=2, outward=0.2, strength=0.9)
SMOOTH_BODY = dict(iterations=8, amount=0.6, strength=1.0)
OUTLINE = dict(thickness=0.0011, value=0.26, saturation=1.35, tint=(0.95, 0.85, 1.0), faceSkin=0.55, faceParts=0.0)
FACE_FLAT = dict(full=0.15, none=-0.35)
# ===========================================================================

TEX = {"Material_head": "head", "Material_accessories": "acc", "Material_hair": "hair",
       "Material_upper_body": "upper", "Material_lower_body": "lower"}
MASKED = {"head", "upper", "lower"}
MESHES = ["Head", "Body", "Skirt", "ArmStrap_L", "ArmStrap_R", "CuffRings", "Spring_01_hair"]
HAIR_OBJ = "Spring_01_hair"
L_EXPR = ["cos(rx)*sin(ry)*cos(rz)+sin(rx)*sin(rz)", "cos(rx)*sin(ry)*sin(rz)-sin(rx)*cos(rz)", "cos(rx)*cos(ry)"]
FULL = SUN_STRENGTH / math.pi            # 影のない所での Shader to RGB の値
report = {}


# ---------- ノードの小道具 ----------
def setin(nt, sock, v):
    if isinstance(v, bpy.types.NodeSocket):
        nt.links.new(v, sock)
    elif isinstance(v, (tuple, list)) and len(v) == 3 and sock.type == "RGBA":
        sock.default_value = (*v, 1.0)
    else:
        sock.default_value = v


def math_(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath"); n.operation = op; n.use_clamp = clamp
    setin(nt, n.inputs[0], a)
    if b is not None:
        setin(nt, n.inputs[1], b)
    return n.outputs[0]


def vmath(nt, op, a, b=None):
    n = nt.nodes.new("ShaderNodeVectorMath"); n.operation = op
    setin(nt, n.inputs[0], a)
    if b is not None:
        setin(nt, n.inputs[1], b)
    return n.outputs["Value"] if op == "DOT_PRODUCT" else n.outputs[0]


def smooth(nt, v, lo, hi):
    n = nt.nodes.new("ShaderNodeMapRange"); n.interpolation_type = "SMOOTHSTEP"
    setin(nt, n.inputs[0], v); setin(nt, n.inputs[1], lo); setin(nt, n.inputs[2], hi)
    return n.outputs[0]


def mixc(nt, fac, a, b, blend="MIX"):
    n = nt.nodes.new("ShaderNodeMix"); n.data_type = "RGBA"; n.blend_type = blend; n.clamp_factor = True
    setin(nt, n.inputs[0], fac); setin(nt, n.inputs[6], a); setin(nt, n.inputs[7], b)
    return n.outputs[2]


def mixf(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix"); n.data_type = "FLOAT"; n.clamp_factor = True
    setin(nt, n.inputs[0], fac); setin(nt, n.inputs[2], a); setin(nt, n.inputs[3], b)
    return n.outputs[0]


_py = [0]


def param(nt, name, value, label=None):
    """パネルから触る値。ノードそのものが値を持つ"""
    if isinstance(value, tuple):
        n = nt.nodes.new("ShaderNodeRGB"); n.outputs[0].default_value = (*value, 1.0)
    else:
        n = nt.nodes.new("ShaderNodeValue"); n.outputs[0].default_value = value
    n.name = name; n.label = label or name
    _py[0] -= 120; n.location = (-900, _py[0])
    return n.outputs[0]


def new_group(name, ins, outs):
    old = bpy.data.node_groups.get(name)
    if old:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    for nm, t in ins:
        ng.interface.new_socket(name=nm, in_out="INPUT", socket_type=t)
    for nm, t in outs:
        ng.interface.new_socket(name=nm, in_out="OUTPUT", socket_type=t)
    return ng, ng.nodes.new("NodeGroupInput"), ng.nodes.new("NodeGroupOutput")


def gnode(nt, name):
    n = nt.nodes.new("ShaderNodeGroup"); n.node_tree = bpy.data.node_groups[name]
    return n


def light_dir(ng, node_name, obj):
    c = ng.nodes.new("ShaderNodeCombineXYZ"); c.name = node_name
    for i, ex in enumerate(L_EXPR):
        d = ng.driver_add('nodes["%s"].inputs[%d].default_value' % (node_name, i)).driver
        d.type = "SCRIPTED"; d.expression = ex
        for nm, tt in (("rx", "ROT_X"), ("ry", "ROT_Y"), ("rz", "ROT_Z")):
            v = d.variables.new(); v.name = nm; v.type = "TRANSFORMS"
            t = v.targets[0]; t.id = obj; t.transform_type = tt; t.rotation_mode = "XYZ"; t.transform_space = "WORLD_SPACE"
    return vmath(ng, "NORMALIZE", c.outputs[0])


def to_rgb(ng, normal=None):
    dif = ng.nodes.new("ShaderNodeBsdfDiffuse"); dif.inputs["Color"].default_value = (1, 1, 1, 1)
    if normal is not None:
        ng.links.new(normal, dif.inputs["Normal"])
    s = ng.nodes.new("ShaderNodeShaderToRGB"); ng.links.new(dif.outputs[0], s.inputs[0])
    sep = ng.nodes.new("ShaderNodeSeparateColor"); ng.links.new(s.outputs[0], sep.inputs[0])
    return sep.outputs


# ---------- ライト ----------
def make_sun(name, color, az, el, angle_deg):
    o = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
    bpy.context.scene.collection.objects.link(o)
    d = o.data; d.energy = SUN_STRENGTH; d.color = color; d.angle = math.radians(angle_deg); d.use_shadow = True
    for k, v in (("shadow_filter_radius", 1.5), ("shadow_maximum_resolution", 0.0003), ("use_shadow_jitter", True),
                 ("shadow_jitter_overblur", 5.0)):
        try:
            setattr(d, k, v)
        except Exception as ex:
            report.setdefault("light_notes", []).append("%s.%s: %r" % (name, k, ex))
    az, el = math.radians(az), math.radians(el)
    D = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    o.rotation_mode = "XYZ"; o.rotation_euler = D.to_track_quat("Z", "Y").to_euler("XYZ")
    o.location = D * 3.0 + Vector((0, 0, 1.3))
    return o


def collection(name, names):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    for nm in names:
        o = bpy.data.objects.get(nm)
        if o and o.name not in c.objects:
            c.objects.link(o)
    return c


def make_lights():
    old = bpy.data.objects.get("Light")
    if old:
        old.hide_render = True; old.hide_viewport = True
    sun = make_sun("LunaCel_Sun", (1, 0, 0), LIGHT["az"], LIGHT["el"], 0.8)
    rim = make_sun("LunaCel_RimSun", (0, 0, 1), RIM["az"], RIM["el"], 0.8)
    face = make_sun("LunaCel_FaceSun", (0, 1, 0), 0.0, FACE["el"], FACE["angle"])     # 顔が受ける落ち影（髪だけが落とす）
    try:
        face.data.shadow_filter_radius = 4.0; face.data.shadow_maximum_resolution = FACE["blur_mm"] / 1000.0 / 4.0
        face.data.use_shadow_jitter = False
    except Exception:
        pass
    face["lc_el"] = math.radians(FACE["el"]); face["lc_follow"] = FACE["follow"]; face["lc_limit"] = math.radians(FACE["limit"])
    face.light_linking.receiver_collection = collection("LunaCel_HeadOnly", ["Head"])
    face.light_linking.blocker_collection = collection("LunaCel_FaceCasters", [])       # 中身は make_face_caster が入れる
    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE" and "head" in o.pose.bones), None)
    if rig:
        face.parent = rig; face.parent_type = "BONE"; face.parent_bone = "head"
    return sun, rim, face


# ---------- 共通のノードグループ ----------
def build_global():
    ng, gi, go = new_group("LunaCel_Global", [], [("Ambient", "NodeSocketColor"), ("Light", "NodeSocketColor"),
                           ("ShadowColor", "NodeSocketColor"), ("RimColor", "NodeSocketColor"),
                           ("RimStrength", "NodeSocketFloat"), ("Flatten", "NodeSocketFloat")])
    P = lambda k, lab: param(ng, "G_" + k, GLOBAL[k], lab)
    ng.links.new(P("Ambient", "環境色"), go.inputs["Ambient"])
    lc = P("LightColor", "主光の色"); lg = P("LightGain", "主光の強さ")
    sc = ng.nodes.new("ShaderNodeVectorMath"); sc.operation = "SCALE"; ng.links.new(lc, sc.inputs[0]); ng.links.new(lg, sc.inputs["Scale"])
    ng.links.new(sc.outputs[0], go.inputs["Light"])
    ng.links.new(P("ShadowColor", "影の色"), go.inputs["ShadowColor"])
    ng.links.new(P("RimColor", "リムの色"), go.inputs["RimColor"]); ng.links.new(P("RimStrength", "リムの強さ"), go.inputs["RimStrength"])
    ng.links.new(P("Flatten", "描き込みを飛ばす"), go.inputs["Flatten"])


def build_light(sun):
    ng, gi, go = new_group("LunaCel_Light", [], [("L", "NodeSocketVector"), ("Cast", "NodeSocketFloat"),
                           ("CastAlt", "NodeSocketFloat"), ("Rim", "NodeSocketFloat")])
    L = light_dir(ng, "Ldir", sun)
    a = to_rgb(ng, L)          # 法線を光へ向けた Diffuse: 陰（N·L）を含まない「遮られているか」だけの項
    ng.links.new(L, go.inputs["L"])
    ng.links.new(smooth(ng, a[0], 0.46 * FULL, 0.54 * FULL), go.inputs["Cast"])
    ng.links.new(smooth(ng, a[1], 0.46 * FULL, 0.54 * FULL), go.inputs["CastAlt"])
    # 本来の法線の Diffuse: 青 = リム用ライトの当たり具合（面の向き × 遮られていないか。普通のライトの計算そのまま）
    b = to_rgb(ng)
    ng.links.new(math_(ng, "DIVIDE", b[2], FULL), go.inputs["Rim"])


def build_face_light(face):
    ng, gi, go = new_group("LunaCel_FaceLight", [], [("HairShadow", "NodeSocketFloat")])
    g = to_rgb(ng, light_dir(ng, "L2dir", face))[1]
    cut = param(ng, "LC_HS_Cut", FACE["cut"], "影の量"); edge = param(ng, "LC_HS_Edge", FACE["edge"], "縁のぼかし")
    st = param(ng, "LC_HS_Strength", 1.0, "顔に落ちる髪の影")
    lo = math_(ng, "MULTIPLY", cut, FULL); hi = math_(ng, "MULTIPLY", math_(ng, "ADD", cut, edge), FULL)
    s = smooth(ng, g, lo, hi)
    ng.links.new(math_(ng, "SUBTRACT", 1.0, math_(ng, "MULTIPLY", st, math_(ng, "SUBTRACT", 1.0, s))), go.inputs["HairShadow"])


def build_surface(name, P, kind, flat_color):
    _py[0] = 0
    ng, gi, go = new_group(name, [("Base", "NodeSocketColor")], [("Color", "NodeSocketColor")])
    p = {k: param(ng, "P_" + k, v, LABEL[k]) for k, v in P.items()}
    G = gnode(ng, "LunaCel_Global").outputs; Lg = gnode(ng, "LunaCel_Light").outputs
    face = gnode(ng, "LunaCel_FaceLight").outputs["HairShadow"]
    geo = ng.nodes.new("ShaderNodeNewGeometry"); N = geo.outputs["Normal"]
    att = ng.nodes.new("ShaderNodeAttribute"); att.attribute_name = "lc_flat"; flat = att.outputs["Fac"]
    L = Lg["L"]

    # 基準の色（主光が当たっていない所の色）
    base = mixc(ng, math_(ng, "MULTIPLY", G["Flatten"], p["Flat"]), gi.outputs["Base"], flat_color)
    base = mixc(ng, 1.0, base, G["Ambient"], "MULTIPLY")

    # 主光: 面がライトを向いている × 遮られていない。どちらもくっきり切る
    ndl = vmath(ng, "DOT_PRODUCT", N, L)
    facing = smooth(ng, ndl, math_(ng, "SUBTRACT", p["Threshold"], EDGE), math_(ng, "ADD", p["Threshold"], EDGE))
    lit = math_(ng, "MULTIPLY", facing, Lg["Cast"])
    lit = mixf(ng, flat, lit, face)                  # 顔の正面だけ特別: 主光と無関係に明るい側。変化は髪の落ち影だけ

    shadow = mixc(ng, 1.0, base, G["ShadowColor"], "MULTIPLY")
    col = mixc(ng, lit, shadow, mixc(ng, 1.0, base, G["Light"], "MULTIPLY"))

    # リム: 後ろのライトが当たった面（面の向き × 遮られていないか。主光と同じ計算）にリムの色を足す
    rim = smooth(ng, Lg["Rim"], math_(ng, "SUBTRACT", p["RimThreshold"], EDGE), math_(ng, "ADD", p["RimThreshold"], EDGE))
    rim = math_(ng, "MULTIPLY", math_(ng, "MULTIPLY", rim, p["Rim"]), G["RimStrength"])
    add = ng.nodes.new("ShaderNodeVectorMath"); add.operation = "SCALE"
    ng.links.new(G["RimColor"], add.inputs[0]); ng.links.new(rim, add.inputs["Scale"])
    out = vmath(ng, "ADD", col, add.outputs[0])
    ng.links.new(out, go.inputs["Color"])


def build_unlit(name, P):
    _py[0] = 0
    ng, gi, go = new_group(name, [("Base", "NodeSocketColor")], [("Color", "NodeSocketColor")])
    p = {k: param(ng, "P_" + k, v, LABEL[k]) for k, v in P.items()}
    G = gnode(ng, "LunaCel_Global").outputs; Lg = gnode(ng, "LunaCel_Light").outputs
    face = gnode(ng, "LunaCel_FaceLight").outputs["HairShadow"]
    att = ng.nodes.new("ShaderNodeAttribute"); att.attribute_name = "lc_flat"
    C = mixf(ng, att.outputs["Fac"], Lg["Cast"], face)
    base = mixc(ng, 1.0, gi.outputs["Base"], mixc(ng, p["AmbientAmount"], (1.0, 1.0, 1.0), G["Ambient"]), "MULTIPLY")
    col = mixc(ng, C, mixc(ng, 1.0, base, p["ShadowTint"], "MULTIPLY"), base)
    n = ng.nodes.new("ShaderNodeVectorMath"); n.operation = "SCALE"
    ng.links.new(col, n.inputs[0]); ng.links.new(p["Boost"], n.inputs["Scale"])
    ng.links.new(n.outputs[0], go.inputs["Color"])


# ---------- 画像 ----------
def load_image(rel, name):
    img = bpy.data.images.load(os.path.join(WORK, rel)); img.name = name; img.pack()
    return img


def pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def make_skin_mask(img, name):
    px = pixels(img); r, g, b = px[..., 0], px[..., 1], px[..., 2]
    mx = px[..., :3].max(-1); mn = px[..., :3].min(-1); d = mx - mn + 1e-6
    h6 = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4))
    deg = h6 * 60.0; s = (mx - mn) / np.maximum(mx, 1e-6)
    skin = ((deg < 42) | (deg > 335)) & (s > 0.07) & (s < 0.5) & (mx > 0.62)
    h, w = skin.shape
    m = skin.astype(np.float32).reshape(h // 2, 2, w // 2, 2).mean((1, 3))
    out = bpy.data.images.new(name, w // 2, h // 2, alpha=False); out.colorspace_settings.name = "Non-Color"
    buf = np.ones((h // 2, w // 2, 4), dtype=np.float32); buf[..., :3] = m[..., None]
    out.pixels.foreach_set(buf.ravel())
    out.filepath_raw = os.path.join(WORK, "masks", name + ".png"); out.file_format = "PNG"
    os.makedirs(os.path.dirname(out.filepath_raw), exist_ok=True); out.save(); out.pack()
    return out, px[..., :3][skin].mean(0) ** 2.2, px[..., :3].reshape(-1, 3).mean(0) ** 2.2


def prep_iris():
    src = bpy.data.images.load(os.path.join(WORK, IRIS_IMAGE))
    px = pixels(src).copy(); h, w = px.shape[:2]; rects = []
    yy, xx = np.mgrid[0:h, 0:w]
    for x0, x1 in ((0, w // 2), (w // 2, w)):
        nonwhite = px[:, x0:x1, :3].min(-1) < 0.88
        ys = np.where(nonwhite.any(1))[0]; xs = np.where(nonwhite.any(0))[0] + x0
        ya, yb, xa, xb = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        cx, cy, a, b = (xa + xb) / 2, (ya + yb) / 2, (xb - xa) / 2, (yb - ya) / 2
        e = ((xx - cx) / a) ** 2 + ((yy - cy) / b) ** 2
        ringc = px[(e > 0.90 ** 2) & (e < 0.96 ** 2)][:, :3].mean(0)
        px[(xx >= x0) & (xx < x1) & (e > 0.975 ** 2), :3] = ringc
        rects.append((xa / w, ya / h, xb / w, yb / h))
    out = bpy.data.images.new("LunaCel_iris", w, h, alpha=False); out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(WORK, "eye", "iris_used.png"); out.file_format = "PNG"; out.save(); out.pack()
    bpy.data.images.remove(src)
    return out, rects


# ---------- メッシュ ----------
def components(me):
    parent = list(range(len(me.vertices)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    comps = {}
    for i in range(len(me.vertices)):
        comps.setdefault(find(i), []).append(i)
    return list(comps.values())


def eye_parts(head, side):
    me = head.data; g = head.vertex_groups["eye." + side].index
    vs = set(v.index for v in me.vertices if any(x.group == g and x.weight > 0.5 for x in v.groups))
    return sorted([c for c in components(me) if c[0] in vs], key=len, reverse=True)


def _arr(me, attr, size, dtype=np.float32, coll="vertices"):
    a = np.empty(len(getattr(me, coll)) * size, dtype=dtype); getattr(me, coll).foreach_get(attr, a)
    return a.reshape(-1, size) if size > 1 else a


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def _set_normals(me, vn):
    vi = _arr(me, "vertex_index", 1, np.int32, "loops")
    me.normals_split_custom_set(vn[vi].astype(np.float64).tolist())


def smooth_connected(ob, P):
    """つながった面の中で法線をならす（同じ位置の頂点は1つとして扱い、継ぎ目で割れないようにする）"""
    me = ob.data
    co = _arr(me, "co", 3); nr = _arr(me, "normal", 3)
    _, gid = np.unique(np.round(co / 1e-5).astype(np.int64), axis=0, return_inverse=True); gid = gid.ravel()
    ng = gid.max() + 1
    gn = np.zeros((ng, 3), dtype=np.float64); np.add.at(gn, gid, nr); gn = _unit(gn); g0 = gn.copy()
    ed = gid[_arr(me, "vertices", 2, np.int32, "edges")]
    deg = np.zeros(ng); np.add.at(deg, ed[:, 0], 1); np.add.at(deg, ed[:, 1], 1); deg = np.maximum(deg, 1)[:, None]
    for _ in range(P["iterations"]):
        s = np.zeros_like(gn); np.add.at(s, ed[:, 0], gn[ed[:, 1]]); np.add.at(s, ed[:, 1], gn[ed[:, 0]])
        gn = _unit(gn * (1 - P["amount"]) + (s / deg) * P["amount"])
    gn = _unit(g0 * (1 - P["strength"]) + gn * P["strength"])
    _set_normals(me, gn[gid])
    report.setdefault("smooth_connected", {})[ob.name] = round(float(np.degrees(np.arccos(np.clip((gn * g0).sum(1), -1, 1))).mean()), 2)


def smooth_hair(ob, center, P):
    """近くにある帯どうしで法線を平均する（つながっていなくてもよい）。先に外向きへそろえる"""
    me = ob.data; R = np.array(ob.matrix_world.to_3x3()); T = np.array(ob.matrix_world.translation)
    co = _arr(me, "co", 3) @ R.T + T; nr = _unit(_arr(me, "normal", 3) @ R.T)
    axis = np.stack([np.full(len(co), center[0]), np.full(len(co), center[1]), np.minimum(co[:, 2], center[2])], 1)
    out = _unit(co - axis)
    flip = (nr * out).sum(1) < 0; nr[flip] *= -1
    cell = P["cell"]; mn = co.min(0) - cell * 2
    g = (co - mn) / cell; idx = np.floor(g).astype(np.int64); dims = idx.max(0) + 3
    acc = np.zeros((*dims, 3), dtype=np.float64); np.add.at(acc, (idx[:, 0], idx[:, 1], idx[:, 2]), nr)
    for _ in range(P["passes"]):
        for ax in range(3):
            acc = (np.roll(acc, 1, ax) + 2 * acc + np.roll(acc, -1, ax)) / 4
    f = g - 0.5; i0 = np.floor(f).astype(np.int64); t = f - i0
    sm = np.zeros_like(nr, dtype=np.float64)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wgt = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                sm += acc[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz] * wgt[:, None]
    sm = _unit(_unit(sm) * (1 - P["outward"]) + out * P["outward"])
    fin = _unit(nr * (1 - P["strength"]) + sm * P["strength"])
    _set_normals(me, fin @ R)        # R は回転だけの想定（逆行列＝転置）
    report["smooth_hair"] = dict(flipped=int(flip.sum()), verts=len(co),
                                 mean_change_deg=round(float(np.degrees(np.arccos(np.clip((fin * nr).sum(1), -1, 1))).mean()), 2))


def make_face_caster(hair, min_area_cm2):
    """顔へ影を落とす役の髪。髪の複製から、細い毛束（小さい部品）を除いたもの。カメラには映らない"""
    ob = hair.copy(); ob.data = hair.data.copy(); ob.name = "LunaCel_FaceCaster"
    for c in hair.users_collection:
        c.objects.link(ob)
    me = ob.data; comps = components(me)
    root = {}
    for i, c in enumerate(comps):
        for v in c:
            root[v] = i
    area = [0.0] * len(comps)
    for p in me.polygons:
        area[root[p.vertices[0]]] += p.area
    kill = [v for i, c in enumerate(comps) if area[i] * 1e4 < min_area_cm2 for v in c]
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context="VERTS")
    # 大きな塊につながった細い毛束も除く: 面のまわり半径 1cm にある髪の面積が小さい所は「細い」とみなす
    from mathutils import kdtree
    bm.faces.ensure_lookup_table()
    kd = kdtree.KDTree(len(bm.faces)); cen = [f.calc_center_median() for f in bm.faces]; ar = [f.calc_area() for f in bm.faces]
    for i, c in enumerate(cen):
        kd.insert(c, i)
    kd.balance()
    thin = [bm.faces[i] for i, c in enumerate(cen) if sum(ar[j] for _, j, _ in kd.find_range(c, 0.01)) * 1e4 < FACE["min_local_cm2"]]
    n_thin = len(thin)
    bmesh.ops.delete(bm, geom=thin, context="FACES"); bm.to_mesh(me); bm.free()
    # カメラには映らず、影だけ落とす（EEVEE はカメラ非表示にすると影も落ちないので、透明マテリアル＋不透明な影にする）
    m = new_mat("LunaCel_shadowonly"); nt = m.node_tree
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tr.outputs[0], out.inputs["Surface"]); m.use_transparent_shadow = False
    for i in range(len(me.materials)):
        me.materials[i] = m
    for c in list(ob.users_collection):
        if c.name == "LunaCel_HairOnly":
            c.objects.unlink(ob)
    bpy.data.collections["LunaCel_FaceCasters"].objects.link(ob)
    report["face_caster_thin_faces_removed"] = n_thin
    report["face_caster"] = dict(parts_removed=sum(1 for a in area if a * 1e4 < min_area_cm2), parts_kept=sum(1 for a in area if a * 1e4 >= min_area_cm2),
                                 verts_removed=len(kill))


def edit_head(head, iris_rects):
    me = head.data; mw = head.matrix_world
    kill = set()
    for s in "LR":
        for c in eye_parts(head, s)[1:]:
            kill.update(c)
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context="VERTS")
    bm.to_mesh(me); bm.free(); me.update()

    eye_slot = len(me.materials); me.materials.append(None)
    uv = me.uv_layers.active.data; iris_verts = set()
    for s, rect in (("R", iris_rects[0]), ("L", iris_rects[1])):
        c = eye_parts(head, s)[0]; cs = set(c); iris_verts |= cs
        P = {i: mw @ me.vertices[i].co for i in c}
        xs = [p.x for p in P.values()]; zs = [p.z for p in P.values()]
        x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs); u0, v0, u1, v1 = rect
        for p in me.polygons:
            if p.vertices[0] in cs:
                p.material_index = eye_slot
                for li, vi in zip(p.loop_indices, p.vertices):
                    q = P[vi]
                    uv[li].uv = (u0 + (q.x - x0) / (x1 - x0) * (u1 - u0), v0 + (q.z - z0) / (z1 - z0) * (v1 - v0))

    comps = components(me)
    head_slot = [i for i, m in enumerate(me.materials) if m and m.name == "Material_head"][0]
    vmat = {}
    for p in me.polygons:
        for v in p.vertices:
            vmat[v] = p.material_index
    skin = max((c for c in comps if vmat.get(c[0]) in (head_slot, 2)), key=len)
    ps = [mw @ me.vertices[i].co for i in skin]
    zmin, zmax, ymin = min(p.z for p in ps), max(p.z for p in ps), min(p.y for p in ps); H = zmax - zmin
    center = (sum(p.x for p in ps) / len(ps), sum(p.y for p in ps) / len(ps), sum(p.z for p in ps) / len(ps))
    parts = set()
    for c in comps:
        if c is skin or vmat.get(c[0]) not in (head_slot, eye_slot):
            continue
        q = [mw @ me.vertices[i].co for i in c]; ctr = sum(q, Vector()) / len(q)
        size = max(max(p[k] for p in q) - min(p[k] for p in q) for k in range(3))
        if abs(ctr.x) < 0.09 and zmin + 0.30 * H < ctr.z < zmin + 0.66 * H and ctr.y < ymin + 0.055 and size < 0.08:
            parts.update(c)
    parts |= iris_verts
    fwd = (mw.inverted().to_3x3() @ Vector((0, -1, 0))).normalized()
    w = np.zeros(len(me.vertices), dtype=np.float32)
    for i in skin:
        d = me.vertices[i].normal.dot(fwd)
        t = min(max((d - FACE_FLAT["none"]) / (FACE_FLAT["full"] - FACE_FLAT["none"]), 0.0), 1.0); w[i] = t * t * (3 - 2 * t)
    for i in parts:
        w[i] = 1.0
    me.attributes.new("lc_flat", "FLOAT", "POINT").data.foreach_set("value", w)
    cn = [Vector(n.vector) for n in me.corner_normals]
    for l in me.loops:
        t = w[l.vertex_index]
        if t > 0:
            cn[l.index] = cn[l.index].lerp(fwd, float(t)).normalized()
    me.normals_split_custom_set([tuple(n) for n in cn])
    g = head.vertex_groups.new(name="LC_OutlineW")
    g.add(list(range(len(me.vertices))), 1.0, "REPLACE"); g.add(list(skin), OUTLINE["faceSkin"], "REPLACE")
    g.add(list(parts), OUTLINE["faceParts"], "REPLACE")
    report["head"] = dict(highlight_verts_removed=len(kill), face_parts=len(parts), face_skin=len(skin))
    return center


# ---------- マテリアル ----------
def tex_node(nt, img):
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = img
    return n


def finish(mat, color):
    nt = mat.node_tree
    em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(color, em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(em.outputs[0], out.inputs["Surface"])


def new_mat(name):
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    m = bpy.data.materials.new(name); m.use_nodes = True; m.node_tree.nodes.clear(); m.use_backface_culling = False
    return m


def group_color(nt, gname, base):
    n = gnode(nt, gname); nt.links.new(base, n.inputs["Base"])
    return n.outputs["Color"]


def main():
    sc = bpy.context.scene
    sun, rim, facesun = make_lights()

    imgs, masks, tone, mean = {}, {}, {}, {}
    for k in sorted(set(TEX.values())):
        imgs[k] = load_image("returns/%s/cel-%s.fbm/cel-%s_basecolor.jpg" % (k, k, k), "LunaCel_tex_" + k)
        if k in MASKED:
            masks[k], tone[k], mean[k] = make_skin_mask(imgs[k], "LunaCel_skinmask_" + k)
    hp = pixels(imgs["hair"])[..., :3].reshape(-1, 3)
    hair_flat = tuple(float(x) for x in (hp[hp.min(1) > 0.35].mean(0) ** 2.2))
    # 作業フォルダの master/textures/ にテクスチャがあれば、そちらを使う（手で直したテクスチャを置く場所）。
    mdir = os.path.join(WORK, "master", "textures"); used = []
    for store, prefix in ((imgs, "LunaCel_tex_"), (masks, "LunaCel_skinmask_")):
        for k in list(store):
            p = os.path.join(mdir, prefix + k + ".png")
            if os.path.exists(p):
                old = store[k]; nm = old.name
                new = bpy.data.images.load(p); new.colorspace_settings.name = old.colorspace_settings.name
                bpy.data.images.remove(old); new.name = nm; new.pack(); store[k] = new; used.append(nm)
    if used:
        imgs["upper"]["lc_darkfix"] = 1          # 手で直してあるので、自動の肌色消しは掛けない
    report["master_textures"] = used
    skin_flat = tuple(float(x) for x in tone["head"])
    report["flat_colors"] = dict(hair=[round(x, 3) for x in hair_flat], skin=[round(x, 3) for x in skin_flat])
    iris_img, iris_rects = prep_iris()

    build_global(); build_light(sun); build_face_light(facesun)
    build_surface("LunaCel_Skin", SKIN, "skin", skin_flat)
    build_surface("LunaCel_Hair", HAIR, "hair", hair_flat)
    build_surface("LunaCel_Cloth", CLOTH, "cloth", (0.5, 0.5, 0.5))
    build_unlit("LunaCel_Eye", EYE); build_unlit("LunaCel_Sclera", SCLERA)

    newmat, outmat = {}, {}
    for old_name, k in TEX.items():
        m = new_mat("LunaCel_" + k); nt = m.node_tree; t = tex_node(nt, imgs[k])
        if k == "hair":
            col = group_color(nt, "LunaCel_Hair", t.outputs["Color"])
        elif k in MASKED:
            mk = tex_node(nt, masks[k])
            fix = tuple(float(min(max(a / b, 0.7), 1.4)) for a, b in zip(tone["head"], tone[k]))
            report["skin_tone_fix_" + k] = [round(x, 3) for x in fix]
            col = mixc(nt, mk.outputs["Color"], group_color(nt, "LunaCel_Cloth", t.outputs["Color"]),
                       group_color(nt, "LunaCel_Skin", mixc(nt, 1.0, t.outputs["Color"], fix, "MULTIPLY")))
        else:
            col = group_color(nt, "LunaCel_Cloth", t.outputs["Color"])
        finish(m, col); newmat[old_name] = m
        o = new_mat("LunaCel_outline_" + k); nt = o.node_tree; o.use_backface_culling = True
        t = tex_node(nt, imgs[k]); hsv = nt.nodes.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = OUTLINE["saturation"]; hsv.inputs["Value"].default_value = OUTLINE["value"]
        nt.links.new(t.outputs["Color"], hsv.inputs["Color"])
        amb = gnode(nt, "LunaCel_Global").outputs["Ambient"]
        finish(o, mixc(nt, 1.0, mixc(nt, 1.0, hsv.outputs["Color"], OUTLINE["tint"], "MULTIPLY"), amb, "MULTIPLY")); outmat[old_name] = o
    m = new_mat("LunaCel_eye"); t = tex_node(m.node_tree, iris_img)
    finish(m, group_color(m.node_tree, "LunaCel_Eye", t.outputs["Color"])); eye_mat = m
    m = new_mat("LunaCel_sclera"); t = tex_node(m.node_tree, bpy.data.images["tex_sclera"])
    finish(m, group_color(m.node_tree, "LunaCel_Sclera", t.outputs["Color"])); newmat["Material_sclera"] = m
    inv = new_mat("LunaCel_invisible"); nt = inv.node_tree
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tr.outputs[0], out.inputs["Surface"]); outmat["Material_sclera"] = inv

    head = bpy.data.objects["Head"]
    center = edit_head(head, iris_rects)
    make_face_caster(bpy.data.objects[HAIR_OBJ], FACE["min_strand_cm2"])      # 法線は元のまま（スムージングなし）

    for name in MESHES:
        ob = bpy.data.objects[name]; me = ob.data
        if "LC_OutlineW" not in ob.vertex_groups:
            ob.vertex_groups.new(name="LC_OutlineW").add(list(range(len(me.vertices))), 1.0, "REPLACE")
        olds = [m.name if m else None for m in me.materials]; n = len(olds)
        for i, nm in enumerate(olds):
            me.materials[i] = eye_mat if nm is None else newmat[nm]
        for nm in olds:
            me.materials.append(inv if nm is None else outmat[nm])
        ol = ob.copy(); ol.name = name + "_Outline"
        for c in ob.users_collection:
            c.objects.link(ol)
        for i in range(n):
            ol.material_slots[i].link = "OBJECT"; ol.material_slots[i].material = inv
        md = ol.modifiers.new("LC_Outline", "SOLIDIFY")
        md.thickness = OUTLINE["thickness"]; md.offset = 1.0; md.use_flip_normals = True; md.use_rim = False
        md.material_offset = n; md.vertex_group = "LC_OutlineW"; md.thickness_vertex_group = 0.0
        ol.visible_shadow = False
    for nm in ("Cube", "EA_MaskSkin"):
        o = bpy.data.objects.get(nm)
        if o:
            o.hide_render = True

    w = sc.world or bpy.data.worlds.new("World"); sc.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    lp = nt.nodes.new("ShaderNodeLightPath"); bg = nt.nodes.new("ShaderNodeBackground")
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.name = "LC_Background"
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    mix.inputs[6].default_value = (0, 0, 0, 1); mix.inputs[7].default_value = (*BACKGROUND, 1)
    nt.links.new(mix.outputs[2], bg.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputWorld"); nt.links.new(bg.outputs[0], out.inputs["Surface"])

    sc.render.engine = "BLENDER_EEVEE"; sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
    for k, v in (("use_shadows", True), ("taa_render_samples", 64), ("taa_samples", 32), ("shadow_ray_count", 2),
                 ("shadow_step_count", 8), ("shadow_resolution_scale", 1.0)):
        try:
            setattr(sc.eevee, k, v)
        except Exception as ex:
            report.setdefault("eevee_notes", []).append("%s: %r" % (k, ex))

    spec = importlib.util.spec_from_file_location("luna_cel_panel", os.path.join(WORK, "luna_cel_panel.py"))
    pan = importlib.util.module_from_spec(spec); spec.loader.exec_module(pan)
    bpy.context.view_layer.update(); pan.face_sun_apply()
    notes = pan.crisp_shadows()            # 影はくっきり（設定はパネルのボタンと同じコード）
    if notes:
        report["crisp_notes"] = notes

    # 黒い部品の肌色の修正・コンポジター（にじみ）・FX は、既存のシーンへ後から足すのと同じコードで入れる
    spec = importlib.util.spec_from_file_location("luna_cel_fx", os.path.join(WORK, "luna_cel_fx.py"))
    fxm = importlib.util.module_from_spec(spec); spec.loader.exec_module(fxm)
    report["fx"] = fxm.apply_all()

    # master/state.json（パネルで調整して書き出した値）があれば、最後に掛ける
    mstate = os.path.join(WORK, "master", "state.json")
    if os.path.exists(mstate):
        report["master_state_applied"] = pan.apply_state(json.load(open(mstate, encoding="utf-8")))

    json.dump(report, open(os.path.join(WORK, "build_report.json"), "w"), indent=1, default=str)
    print("REPORT", json.dumps(report))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "luna_cel.blend"), copy=False)


main()
