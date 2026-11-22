# セルルック版へ後から足すもの（開いているシーンの値を変えずに足せるよう、どれも「無ければ作る」）。
#   1. 黒い部品（ハーネスなど）のテクスチャに乗った肌色を消す
#   2. コンポジター（にじみ）
#   3. FX（ポイント発光・天使の輪・星の周回・毛先・腰のブースター）。MToon 用のエフェクトと同じ式を、セルルックのマテリアルへ組み直したもの
# 使い方: build_cel.py の最後から apply_all() を呼ぶ。
import bpy, math, random, json
from collections import defaultdict
from mathutils import Vector
import numpy as np

FPS = 24
LOOP = 240                      # 星が1周するフレーム数
GLOW_STRENGTH = 2.0
HALO_STRENGTH = 1.6
BOOST_STRENGTH = 3.0
HAIR_STRENGTH = 0.9
HAIR_GLOW_Z = (1.36, 1.56)
SHELL_TOP_Z = 0.72
PLUME_RISE = 0.33
PLUME_LEN = 0.14
PLUME_SPREAD = 1.8
TAIL_MAX_Z = 0.47
BLOOM = dict(threshold=1.05, strength=0.8, size=0.5)     # しきい値は 1 より上: 白い髪や服そのものはにじませず、リムと発光だけ

HEAD_PARTS = [
    ("halo",        (0.000, 0.052, 1.663), 0.0, 0.0, 1.0),
    ("star",        (0.074, 0.049, 1.691), 2.2, 1.0, 0.0),
    ("earring_L",   (0.080, -0.033, 1.421), 1.6, 0.8, 0.0),
    ("earring_R",   (-0.079, -0.033, 1.421), 1.6, 0.8, 0.0),
    ("earTop_L",    (0.078, -0.030, 1.466), 1.2, 0.5, 0.0),
    ("earTop_R",    (-0.079, -0.030, 1.466), 1.2, 0.5, 0.0),
    ("earChain_L",  (0.078, -0.032, 1.446), 1.0, 0.4, 0.0),
    ("earChain_R",  (-0.078, -0.032, 1.446), 1.0, 0.4, 0.0),
    ("ribbonGem_L", (0.116, -0.009, 1.614), 1.6, 0.6, 0.0),
    ("ribbonGem_R", (-0.116, -0.009, 1.614), 1.6, 0.6, 0.0),
    ("mic",         (-0.030, -0.123, 1.446), 2.5, 0.0, 0.0),
    ("hairclip",    (0.082, -0.110, 1.559), 1.5, 0.4, 0.0),
]
DEFAULT_GAIN = {("Head", "LunaCel_acc"): 1.0, ("Head", "LunaCel_head"): 0.0, ("Body", None): 1.0, ("ArmStrap_L", None): 1.0,
                ("ArmStrap_R", None): 1.0, ("CuffRings", None): 1.0, ("Skirt", None): 0.45}
GLOW_MATERIALS = ["LunaCel_acc", "LunaCel_head", "LunaCel_upper", "LunaCel_lower"]
report = {}


def _rig():
    return next(o for o in bpy.data.objects if o.type == "ARMATURE" and "head" in o.pose.bones)


def components(mesh):
    parent = list(range(len(mesh.vertices)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in mesh.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    comp = defaultdict(list)
    for v in mesh.vertices:
        comp[find(v.index)].append(v.index)
    return list(comp.values())


def float_attr(mesh, name, vals):
    a = mesh.attributes.get(name)
    if a is not None:
        mesh.attributes.remove(a)
    a = mesh.attributes.new(name, "FLOAT", "POINT")
    a.data.foreach_set("value", vals)


# =====================================================================
# 1. 黒い部品に乗った肌色
# =====================================================================
DARK = dict(max_value=0.30, min_dark=0.55, max_area=0.04, max_skin=0.40)


def _px(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _store(img, a):
    img.pixels.foreach_set(a.ravel()); img.update(); img.pack()


def fix_dark_parts():
    if bpy.data.images.get("LunaCel_tex_upper") is None or bpy.data.images["LunaCel_tex_upper"].get("lc_darkfix"):
        return
    res = {}
    for key in ("upper", "lower"):
        tex = bpy.data.images.get("LunaCel_tex_" + key); msk = bpy.data.images.get("LunaCel_skinmask_" + key)
        if tex is None or msk is None:
            continue
        T = _px(tex); M = _px(msk); H, W = T.shape[:2]; mh, mw = M.shape[:2]
        fixed_px = 0; parts = 0
        region_all = np.zeros((H, W), dtype=bool)
        for oname in ("Body", "ArmStrap_L", "ArmStrap_R", "CuffRings"):
            ob = bpy.data.objects.get(oname)
            if ob is None:
                continue
            me = ob.data; uv = me.uv_layers.active.data
            slot = next((i for i, m in enumerate(me.materials) if m and m.name == "LunaCel_" + key), None)
            if slot is None:
                continue
            comps = components(me); root = {}
            for ci, c in enumerate(comps):
                for v in c:
                    root[v] = ci
            polys = defaultdict(list)
            for p in me.polygons:
                if p.material_index == slot:
                    polys[root[p.vertices[0]]].append(p)
            me.calc_loop_triangles()
            tris = defaultdict(list)
            for t in me.loop_triangles:
                tris[t.polygon_index].append(t.loops)
            for ci, pl in polys.items():
                area = sum(p.area for p in pl)
                if area > DARK["max_area"]:
                    continue
                cu = np.array([[sum(uv[li].uv[k] for li in p.loop_indices) / p.loop_total for k in (0, 1)] for p in pl])
                x = np.clip((cu[:, 0] * W).astype(int), 0, W - 1); y = np.clip((cu[:, 1] * H).astype(int), 0, H - 1)
                col = T[y, x, :3]; dark = col.max(1) < DARK["max_value"]
                skin = M[np.clip(y * mh // H, 0, mh - 1), np.clip(x * mw // W, 0, mw - 1), 0] > 0.5
                if dark.mean() < DARK["min_dark"] or not skin.any() or skin.mean() > DARK["max_skin"]:
                    continue
                region = np.zeros((H, W), dtype=bool)
                for p in pl:
                    for lp in tris[p.index]:
                        pts = np.array([[uv[l].uv[0] * W, uv[l].uv[1] * H] for l in lp])
                        x0, y0 = np.floor(pts.min(0)).astype(int) - 1; x1, y1 = np.ceil(pts.max(0)).astype(int) + 2
                        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, W), min(y1, H)
                        if x1 <= x0 or y1 <= y0:
                            continue
                        gy, gx = np.mgrid[y0:y1, x0:x1]; gx = gx + 0.5; gy = gy + 0.5
                        (ax, ay), (bx, by), (cx, cy) = pts
                        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                        if abs(d) < 1e-9:
                            continue
                        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
                        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
                        region[y0:y1, x0:x1] |= (l1 >= -0.02) & (l2 >= -0.02) & (l1 + l2 <= 1.02)
                # 島の縁はテクスチャのにじみで肌色が残るので、2px 外まで広げて拾う
                grown = region.copy()
                for _ in range(2):
                    g2 = grown.copy()
                    g2[1:, :] |= grown[:-1, :]; g2[:-1, :] |= grown[1:, :]; g2[:, 1:] |= grown[:, :-1]; g2[:, :-1] |= grown[:, 1:]
                    grown = g2
                skin_px = grown & (np.repeat(np.repeat(M[..., 0], H // mh, 0), W // mw, 1) > 0.15)
                ok = region & ~skin_px & (T[..., :3].max(-1) < DARK["max_value"])
                if not skin_px.any() or not ok.any():
                    continue
                T[skin_px, :3] = np.median(T[ok][:, :3], axis=0)
                fixed_px += int(skin_px.sum()); parts += 1; region_all |= grown
        if parts:
            ds = region_all.reshape(mh, H // mh, mw, W // mw).any((1, 3))
            M[ds, :3] = 0.0
            _store(tex, T); _store(msk, M)
        tex["lc_darkfix"] = 1
        res[key] = dict(parts=parts, pixels=fixed_px)
    report["dark_parts"] = res


# =====================================================================
# 2. コンポジター
# =====================================================================
def setup_compositor():
    sc = bpy.context.scene
    if bpy.data.node_groups.get("LunaCel_Composite") is None:
        ng = bpy.data.node_groups.new("LunaCel_Composite", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers"); rl.location = (-400, 0)
        gl = ng.nodes.new("CompositorNodeGlare"); gl.location = (-100, 0); gl.name = "LC_Bloom"
        go = ng.nodes.new("NodeGroupOutput"); go.location = (200, 0)
        if hasattr(gl, "glare_type"):
            gl.glare_type = "BLOOM"
        notes = []
        for nm, val in (("Type", "Bloom"), ("Threshold", BLOOM["threshold"]), ("Strength", BLOOM["strength"]), ("Size", BLOOM["size"])):
            if nm in gl.inputs:
                try:
                    gl.inputs[nm].default_value = val
                except Exception as e:
                    notes.append("%s: %r" % (nm, e))
        ng.links.new(rl.outputs[0], gl.inputs[0]); ng.links.new(gl.outputs[0], go.inputs[0])
        report["bloom"] = dict(inputs=[i.name for i in gl.inputs], notes=notes)
    sc.compositing_node_group = bpy.data.node_groups["LunaCel_Composite"]
    sc.render.use_compositing = True
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                for sp in area.spaces:
                    if sp.type == "VIEW_3D":
                        try:
                            sp.shading.use_compositor = "ALWAYS"
                        except Exception:
                            pass


# =====================================================================
# 3. FX
# =====================================================================
class G:
    def __init__(self, tree, x=-2600, y=-900):
        self.t = tree; self.x, self.y = x, y

    def node(self, typ, **kw):
        n = self.t.nodes.new(typ); n.location = (self.x, self.y); self.x += 170
        if self.x > -200:
            self.x = -2600; self.y -= 220
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def _set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.t.links.new(v, sock)
        else:
            sock.default_value = v

    def m(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op); n.use_clamp = clamp
        self._set(n.inputs[0], a)
        if b is not None:
            self._set(n.inputs[1], b)
        if c is not None:
            self._set(n.inputs[2], c)
        return n.outputs[0]

    def smooth(self, x, lo, hi):
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self._set(n.inputs[0], x); n.inputs[1].default_value = lo; n.inputs[2].default_value = hi
        return n.outputs[0]

    def attr(self, name):
        return self.node("ShaderNodeAttribute", attribute_name=name).outputs["Fac"]

    def combine(self, x, y, z=0.0):
        n = self.node("ShaderNodeCombineXYZ")
        self._set(n.inputs[0], x); self._set(n.inputs[1], y); self._set(n.inputs[2], z)
        return n.outputs[0]

    def noise2(self, vec):
        n = self.node("ShaderNodeTexWhiteNoise", noise_dimensions="2D"); self.t.links.new(vec, n.inputs["Vector"])
        return n.outputs["Value"]

    def mixcol(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self._set(n.inputs[0], fac)
        self._set(n.inputs[6], a if isinstance(a, bpy.types.NodeSocket) else (*a, 1.0))
        self._set(n.inputs[7], b if isinstance(b, bpy.types.NodeSocket) else (*b, 1.0))
        return n.outputs[2]

    def time(self):
        n = self.node("ShaderNodeValue"); n.name = "FX_Time"; n.label = "FX_Time (秒)"
        fc = self.t.driver_add('nodes["%s"].outputs[0].default_value' % n.name)
        fc.driver.type = "SCRIPTED"; fc.driver.expression = "frame/%d" % FPS
        return n.outputs[0]

    def value(self, v, name, label):
        n = self.node("ShaderNodeValue"); n.name = name; n.label = label; n.outputs[0].default_value = v
        return n.outputs[0]

    def scale(self, col, s):
        n = self.node("ShaderNodeVectorMath", operation="SCALE")
        self._set(n.inputs[0], col); self._set(n.inputs["Scale"], s)
        return n.outputs[0]

    def add(self, a, b):
        n = self.node("ShaderNodeVectorMath", operation="ADD")
        self._set(n.inputs[0], a); self._set(n.inputs[1], b)
        return n.outputs[0]

    def emission(self, color, strength):
        n = self.node("ShaderNodeEmission"); self._set(n.inputs["Color"], color); self._set(n.inputs["Strength"], strength)
        return n.outputs[0]


def _new_group(name):
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    for nm in ("Color", "Tex"):
        ng.interface.new_socket(name=nm, in_out="INPUT", socket_type="NodeSocketColor")
    ng.interface.new_socket(name="Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    gi = ng.nodes.new("NodeGroupInput"); gi.location = (-2900, 0)
    go = ng.nodes.new("NodeGroupOutput"); go.location = (200, 0)
    return ng, gi, go


def setup_attributes(st):
    random.seed(7)
    for oname in ("Head", "Body", "ArmStrap_L", "ArmStrap_R", "CuffRings", "Skirt"):
        o = bpy.data.objects.get(oname)
        if o is None:
            continue
        me = o.data; n = len(me.vertices)
        gain = [0.0] * n; solid = [0.0] * n; halo = [0.0] * n; hc = [0.0] * n; hs = [0.0] * n; phase = [0.0] * n
        vmat = {}
        for p in me.polygons:
            for vi in p.vertices:
                vmat[vi] = p.material_index
        for vi, mi in vmat.items():
            mname = me.materials[mi].name if me.materials[mi] else None
            gain[vi] = DEFAULT_GAIN.get((oname, mname), DEFAULT_GAIN.get((oname, None), 0.0)) if oname != "Head" else DEFAULT_GAIN.get((oname, mname), 0.0)
        comps = components(me)
        for c in comps:
            ph = random.random()
            for vi in c:
                phase[vi] = ph
        if oname == "Head":
            info = []
            for c in comps:
                ws = [o.matrix_world @ me.vertices[i].co for i in c]
                mn = Vector([min(w[k] for w in ws) for k in range(3)]); mx = Vector([max(w[k] for w in ws) for k in range(3)])
                info.append((c, (mn + mx) / 2, ws))
            found = {}
            for name, ctr, g, s, h in HEAD_PARTS:
                c, cc, ws = min(info, key=lambda it: (it[1] - Vector(ctr)).length)
                d = (cc - Vector(ctr)).length; found[name] = (len(c), round(d, 4))
                if d > 0.012:
                    continue
                for vi in c:
                    gain[vi], solid[vi], halo[vi] = g, s, h
                if name == "halo":
                    cen = sum(ws, Vector()) / len(ws); nrm = Vector(); cset = set(c)
                    for e in me.edges:
                        if e.vertices[0] in cset:
                            a = o.matrix_world @ me.vertices[e.vertices[0]].co - cen
                            b = o.matrix_world @ me.vertices[e.vertices[1]].co - cen
                            x = a.cross(b)
                            if x.dot(nrm) < 0:
                                x = -x
                            nrm += x
                    nrm.normalize()
                    if nrm.z < 0:
                        nrm = -nrm
                    ax = (Vector((1, 0, 0)) - nrm * nrm.x).normalized(); ay = nrm.cross(ax)
                    st["halo"] = (cen, nrm)
                    NB = 72; bins = [[] for _ in range(NB)]
                    for w in ws:
                        r = w - cen; hh = r.dot(nrm); rr = (r - nrm * hh).length
                        if abs(hh) < 0.012 and 0.06 < rr < 0.14:
                            bins[int((math.atan2(r.dot(ay), r.dot(ax)) / (2 * math.pi) % 1.0) * NB) % NB].append((rr, hh))
                    med = lambda xs: sorted(xs)[len(xs) // 2]
                    path = [(med([b[0] for b in bn]), med([b[1] for b in bn])) if bn else None for bn in bins]
                    for i in range(NB):
                        if path[i] is None:
                            j = next(k for k in range(1, NB) if path[(i + k) % NB] or path[(i - k) % NB])
                            path[i] = path[(i + j) % NB] or path[(i - j) % NB]
                    for _ in range(3):
                        path = [tuple((path[i - 1][k] + path[i][k] * 2 + path[(i + 1) % NB][k]) / 4 for k in (0, 1)) for i in range(NB)]
                    st["ring"] = dict(ax=ax, ay=ay, path=path)
                    for vi, w in zip(c, ws):
                        r = w - cen; ang = math.atan2(r.dot(ay), r.dot(ax)); hc[vi], hs[vi] = math.cos(ang), math.sin(ang)
                if name == "star":
                    st["star"] = (c, cc)
            report["head_parts"] = found
        for nm, vals in (("fx_gain", gain), ("fx_solid", solid), ("fx_halo", halo), ("fx_hc", hc), ("fx_hs", hs), ("fx_phase", phase)):
            float_attr(me, nm, vals)


def setup_star(st):
    rig = _rig()
    if "FX_Star" in rig.data.bones or "star" not in st or "halo" not in st:
        return
    verts, ctr = st["star"]; hcen, hnrm = st["halo"]
    head = bpy.data.objects["Head"]
    vl = bpy.context.view_layer
    was_hidden = rig.hide_get(); rig.hide_set(False)
    for o in vl.objects:
        o.select_set(False)
    vl.objects.active = rig; rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    inv = rig.matrix_world.inverted()
    ob = rig.data.edit_bones.new("FX_StarOrbit")
    ob.head = inv @ hcen; ob.tail = inv @ (hcen + hnrm * 0.03); ob.parent = rig.data.edit_bones["head"]; ob.use_deform = False
    eb = rig.data.edit_bones.new("FX_Star")
    eb.head = inv @ (ctr - hnrm * 0.012); eb.tail = inv @ (ctr + hnrm * 0.022); eb.parent = ob; eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.hide_set(was_hidden)
    opb = rig.pose.bones["FX_StarOrbit"]; opb.rotation_mode = "XYZ"
    opb.driver_add("rotation_euler", 1).driver.expression = "2*pi*frame/%d" % LOOP
    for g in head.vertex_groups:
        g.remove(verts)
    head.vertex_groups.new(name="FX_Star").add(verts, 1.0, "REPLACE")
    for o in bpy.data.objects:          # メッシュを共有する複製（アウトライン用）にも同じ名前の頂点グループを作る
        if o is not head and o.type == "MESH" and o.data is head.data and "FX_Star" not in o.vertex_groups:
            o.vertex_groups.new(name="FX_Star")
    pb = rig.pose.bones["FX_Star"]; pb.rotation_mode = "XYZ"
    pb.driver_add("rotation_euler", 1).driver.expression = "4*pi*frame/%d" % LOOP
    ring = st["ring"]; ax, ay, path = ring["ax"], ring["ay"], ring["path"]; NB = len(path)
    rel = ctr - hcen; h0 = rel.dot(hnrm); flat = rel - hnrm * h0; radial = flat.normalized()
    th0 = math.atan2(rel.dot(ay), rel.dot(ax))
    def ring_at(th):
        f = (th / (2 * math.pi) % 1.0) * NB; i, t = int(f) % NB, f - int(f)
        a, b = path[i], path[(i + 1) % NB]
        return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
    rs, hs = ring_at(th0)
    to_local = (rig.matrix_world.to_3x3() @ rig.data.bones["FX_Star"].matrix_local.to_3x3()).inverted()
    lr, ln = to_local @ radial, to_local @ hnrm
    for f in range(1, LOOP + 2):
        r, h = ring_at(th0 + 2 * math.pi * f / LOOP)
        pb.location = lr * (r - rs) + ln * (h - hs); pb.keyframe_insert("location", frame=f)
    report["star"] = dict(verts=len(verts))


def build_glow_group():
    if bpy.data.node_groups.get("LunaCel_FXGlow"):
        return
    ng, gi, go = _new_group("LunaCel_FXGlow"); g = G(ng)
    tex = gi.outputs["Tex"]; time = g.time()
    strength = g.value(GLOW_STRENGTH, "FX_GlowStrength", "ポイント発光の強さ")
    gain, solid, phase = g.attr("fx_gain"), g.attr("fx_solid"), g.attr("fx_phase")
    sep = g.node("ShaderNodeSeparateColor", mode="HSV"); ng.links.new(tex, sep.inputs[0])
    h, s, v = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    hue = g.m("SUBTRACT", 1.0, g.smooth(g.m("ABSOLUTE", g.m("SUBTRACT", h, 0.57)), 0.07, 0.11))
    mask = g.m("MAXIMUM", g.m("MULTIPLY", g.m("MULTIPLY", hue, g.smooth(s, 0.45, 0.75)), g.smooth(v, 0.25, 0.6)), solid)
    pulse = g.m("ADD", 0.78, g.m("MULTIPLY", 0.22, g.m("SINE", g.m("ADD", g.m("MULTIPLY", time, 2.2), g.m("MULTIPLY", phase, 6.283)))))
    st = g.m("MULTIPLY", g.m("MULTIPLY", mask, gain), g.m("MULTIPLY", pulse, strength))
    hsv = g.node("ShaderNodeHueSaturation"); hsv.inputs["Saturation"].default_value = 1.35; hsv.inputs["Value"].default_value = 1.2
    ng.links.new(tex, hsv.inputs["Color"])
    res = g.add(gi.outputs["Color"], g.scale(hsv.outputs[0], st))
    # 天使の輪: 輪に沿って流れるグラデーションと、走る明るい点。足すと白く飛ぶので、輪の部分は発光色で置き換える
    halo = g.attr("fx_halo")
    ang = g.m("DIVIDE", g.m("ARCTAN2", g.attr("fx_hs"), g.attr("fx_hc")), 6.2832)
    hstr = g.value(HALO_STRENGTH, "FX_HaloStrength", "輪の強さ")
    ramp = g.node("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = "B_SPLINE"
    cols = [(0.0, (0.05, 0.75, 1.0)), (0.25, (0.25, 0.35, 1.0)), (0.5, (0.75, 0.3, 1.0)), (0.75, (1.0, 0.45, 0.85)), (1.0, (0.05, 0.75, 1.0))]
    cr.elements[0].position, cr.elements[0].color = cols[0][0], (*cols[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = cols[-1][0], (*cols[-1][1], 1)
    for p, c in cols[1:-1]:
        cr.elements.new(p).color = (*c, 1)
    ng.links.new(g.m("FRACT", g.m("ADD", ang, g.m("MULTIPLY", time, 0.12))), ramp.inputs[0])
    run = g.m("POWER", g.m("MAXIMUM", 0.0, g.m("SINE", g.m("SUBTRACT", g.m("MULTIPLY", ang, 12.566), g.m("MULTIPLY", time, 1.6)))), 10.0)
    breathe = g.m("ADD", 0.85, g.m("MULTIPLY", 0.15, g.m("SINE", g.m("MULTIPLY", time, 1.3))))
    hcol = g.scale(ramp.outputs[0], g.m("MULTIPLY", hstr, g.m("ADD", breathe, g.m("MULTIPLY", run, 1.5))))
    ng.links.new(g.mixcol(halo, res, hcol), go.inputs["Color"])


def build_hair_group():
    if bpy.data.node_groups.get("LunaCel_FXHair"):
        return
    ng, gi, go = _new_group("LunaCel_FXHair"); g = G(ng)
    tex = gi.outputs["Tex"]; time = g.time()
    strength = g.value(HAIR_STRENGTH, "FX_HairStrength", "毛先の発光の強さ")
    hgt = g.attr("fx_h")
    sep = g.node("ShaderNodeSeparateColor", mode="HSV"); ng.links.new(tex, sep.inputs[0])
    mask = g.m("MULTIPLY", g.smooth(sep.outputs[1], 0.5, 0.72), g.smooth(sep.outputs[2], 0.2, 0.5))
    mask = g.m("MULTIPLY", mask, g.m("SUBTRACT", 1.0, g.smooth(hgt, HAIR_GLOW_Z[0], HAIR_GLOW_Z[1])))
    wave = g.m("ADD", 0.7, g.m("MULTIPLY", 0.3, g.m("SINE", g.m("ADD", g.m("MULTIPLY", time, 1.6), g.m("MULTIPLY", hgt, 9.0)))))
    hsv = g.node("ShaderNodeHueSaturation"); hsv.inputs["Saturation"].default_value = 1.4; ng.links.new(tex, hsv.inputs["Color"])
    ng.links.new(g.add(gi.outputs["Color"], g.scale(hsv.outputs[0], g.m("MULTIPLY", g.m("MULTIPLY", mask, wave), strength))), go.inputs["Color"])


def _insert(mat_name, group_name, tex_key):
    m = bpy.data.materials.get(mat_name)
    if m is None or any(n.type == "GROUP" and n.node_tree and n.node_tree.name == group_name for n in m.node_tree.nodes):
        return False
    nt = m.node_tree
    em = next(n for n in nt.nodes if n.type == "EMISSION")
    src = em.inputs["Color"].links[0].from_socket
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == "LunaCel_tex_" + tex_key)
    gn = nt.nodes.new("ShaderNodeGroup"); gn.node_tree = bpy.data.node_groups[group_name]; gn.name = "FX"
    nt.links.new(src, gn.inputs["Color"]); nt.links.new(tex.outputs["Color"], gn.inputs["Tex"])
    nt.links.new(gn.outputs["Color"], em.inputs["Color"])
    return True


def setup_glow():
    build_glow_group(); build_hair_group()
    done = [mn for mn in GLOW_MATERIALS if _insert(mn, "LunaCel_FXGlow", mn.split("_", 1)[1])]
    hair = bpy.data.objects.get("Spring_01_hair")
    if hair:
        float_attr(hair.data, "fx_h", [(hair.matrix_world @ v.co).z for v in hair.data.vertices])
        if _insert("LunaCel_hair", "LunaCel_FXHair", "hair"):
            done.append("LunaCel_hair")
    report["glow_materials"] = done


def booster_material(kind):
    mat = bpy.data.materials.new("FX_Booster_%s" % kind); mat.use_nodes = True
    t = mat.node_tree; t.nodes.clear()
    out = t.nodes.new("ShaderNodeOutputMaterial"); out.location = (0, 0)
    g = G(t, y=600); time = g.time()
    strength = g.value(BOOST_STRENGTH, "FX_BoostStrength", "ブースターの強さ")
    uvn = g.node("ShaderNodeUVMap", uv_map="FXUV")
    sp = g.node("ShaderNodeSeparateXYZ"); t.links.new(uvn.outputs[0], sp.inputs[0]); u, v = sp.outputs[0], sp.outputs[1]
    if kind == "shell":
        vn = g.m("DIVIDE", v, SHELL_TOP_Z - 0.27, clamp=True)
        cu, cv = g.m("DIVIDE", u, 0.022), g.m("SUBTRACT", g.m("DIVIDE", v, 0.022), g.m("MULTIPLY", time, 5.0)); speed_band = 3.0
    else:
        vn = v
        cu, cv = g.m("MULTIPLY", u, 9.0), g.m("SUBTRACT", g.m("MULTIPLY", v, 17.0), g.m("MULTIPLY", time, 7.0)); speed_band = 6.0
    fu, fv = g.m("FRACT", cu), g.m("FRACT", cv)
    r = g.noise2(g.combine(g.m("FLOOR", cu), g.m("FLOOR", cv)))
    edge = g.m("MINIMUM", g.m("MINIMUM", fu, g.m("SUBTRACT", 1.0, fu)), g.m("MINIMUM", fv, g.m("SUBTRACT", 1.0, fv)))
    tile = g.m("GREATER_THAN", edge, 0.09)
    band = g.m("POWER", g.m("MAXIMUM", 0.0, g.m("SINE", g.m("SUBTRACT", g.m("MULTIPLY", vn, 9.0), g.m("MULTIPLY", time, speed_band)))), 4.0)
    if kind == "shell":
        on = g.m("LESS_THAN", r, g.m("MULTIPLY", g.m("POWER", vn, 1.6), 0.85))
        grid = g.m("MULTIPLY", g.m("SUBTRACT", 1.0, tile), g.m("MULTIPLY", g.m("POWER", vn, 2.0), 0.35))
        inten = g.m("ADD", g.m("MULTIPLY", g.m("MULTIPLY", tile, on), g.m("ADD", 0.35, g.m("MULTIPLY", band, 0.9))), grid)
        inten = g.m("MULTIPLY", inten, g.smooth(vn, 0.05, 0.45))
    else:
        on = g.m("GREATER_THAN", r, g.m("SUBTRACT", g.m("MULTIPLY", vn, 1.15), 0.1))
        across = g.m("SUBTRACT", 1.0, g.m("ABSOLUTE", g.m("SUBTRACT", g.m("MULTIPLY", u, 2.0), 1.0)))
        lr = g.noise2(g.combine(g.m("FLOOR", g.m("MULTIPLY", u, 36.0)), 3.0))
        streak = g.m("MULTIPLY", g.m("POWER", lr, 4.0),
                     g.m("POWER", g.m("MAXIMUM", 0.0, g.m("SINE", g.m("ADD", g.m("SUBTRACT", g.m("MULTIPLY", v, 14.0), g.m("MULTIPLY", time, 11.0)), g.m("MULTIPLY", lr, 40.0)))), 3.0))
        core = g.m("MULTIPLY", g.m("POWER", g.m("SUBTRACT", 1.0, vn), 3.0), 0.18)
        inten = g.m("MULTIPLY", g.m("MULTIPLY", tile, on), g.m("ADD", 0.45, g.m("MULTIPLY", band, 0.8)))
        inten = g.m("ADD", g.m("ADD", inten, g.m("MULTIPLY", streak, 1.6)), core)
        fade = g.m("MULTIPLY", g.m("POWER", g.m("SUBTRACT", 1.0, vn), 1.3), g.smooth(vn, 0.0, 0.12))
        inten = g.m("MULTIPLY", g.m("MULTIPLY", inten, fade), g.smooth(across, 0.0, 0.45))
    flick = g.m("ADD", 0.88, g.m("MULTIPLY", 0.12, g.m("SINE", g.m("MULTIPLY", time, 9.0))))
    col = g.mixcol(g.m("POWER", vn, 0.8, clamp=True), (0.05, 0.85, 1.0), (0.55, 0.25, 1.0))
    col = g.mixcol(g.m("MULTIPLY", r, 0.25), col, (1.0, 1.0, 1.0))
    em = g.emission(col, g.m("MULTIPLY", g.m("MULTIPLY", inten, flick), strength))
    tr = g.node("ShaderNodeBsdfTransparent")
    ad = g.node("ShaderNodeAddShader"); t.links.new(tr.outputs[0], ad.inputs[0]); t.links.new(em, ad.inputs[1])
    t.links.new(ad.outputs[0], out.inputs["Surface"])
    mat.surface_render_method = "BLENDED"; mat.use_backface_culling = False
    if hasattr(mat, "use_transparency_overlap"):
        mat.use_transparency_overlap = True
    return mat


def new_fx_object(name, verts, faces, uvs, weights, mat):
    rig = _rig(); sc = bpy.context.scene
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    uvl = me.uv_layers.new(name="FXUV")
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            uvl.data[li].uv = uvs[vi]
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    col = bpy.data.collections.get("FX") or bpy.data.collections.new("FX")
    if col.name not in sc.collection.children:
        sc.collection.children.link(col)
    col.objects.link(o)
    o.parent = rig; o.matrix_parent_inverse = rig.matrix_world.inverted()
    groups = {}
    for vi, ws in enumerate(weights):
        for bone, w in ws:
            vg = groups.get(bone) or o.vertex_groups.new(name=bone); groups[bone] = vg; vg.add([vi], w, "REPLACE")
    o.modifiers.new("Armature", "ARMATURE").object = rig
    o.visible_shadow = False
    return o


def setup_booster():
    if bpy.data.objects.get("FX_BoosterShell"):
        return
    rig = _rig(); skirt = bpy.data.objects["Skirt"]; me = skirt.data; mw = skirt.matrix_world
    gname = {g.index: g.name for g in skirt.vertex_groups}
    pos = [mw @ v.co for v in me.vertices]; nrm = [(mw.to_3x3() @ v.normal).normalized() for v in me.vertices]
    wts = [[(gname[g.group], g.weight) for g in v.groups if g.weight > 0 and gname[g.group] in rig.data.bones] for v in me.vertices]
    hips = rig.matrix_world @ rig.data.bones["hips"].head_local
    keep = [p for p in me.polygons if all(pos[vi].z < SHELL_TOP_Z for vi in p.vertices)]
    used = sorted({vi for p in keep for vi in p.vertices})
    uv_of = lambda vi: (math.atan2(pos[vi].x - hips.x, pos[vi].y - hips.y) * 0.2, SHELL_TOP_Z - pos[vi].z)
    verts, faces, uvs, weights = [], [], [], []
    for sign in (1, -1):
        remap = {}
        for vi in used:
            remap[vi] = len(verts); verts.append(pos[vi] + nrm[vi] * 0.003 * sign); uvs.append(uv_of(vi)); weights.append(wts[vi])
        for p in keep:
            us = [uv_of(vi)[0] for vi in p.vertices]
            if max(us) - min(us) > 0.3:
                continue
            faces.append([remap[vi] for vi in p.vertices])
    new_fx_object("FX_BoosterShell", verts, faces, uvs, weights, booster_material("shell"))
    chains = defaultdict(list)
    for b in rig.data.bones:
        if b.name.startswith("SkirtSpring_") and not b.name.endswith("_End"):
            chains[b.name.rsplit("_", 1)[0]].append(b.name)
    tails = []
    for cname, bones in sorted(chains.items()):
        bones.sort()
        mine = [i for i, ws in enumerate(wts) if ws and max(ws, key=lambda x: x[1])[0] in bones]
        if not mine:
            continue
        tip = pos[min(mine, key=lambda i: pos[i].z)]
        if tip.z < TAIL_MAX_Z:
            tails.append((cname, bones[-1], tip, mine))
    tails.sort(key=lambda t: t[2].z)
    picked = []
    for t in tails:
        if all((t[2] - q[2]).length > 0.16 for q in picked):
            picked.append(t)
    pm = booster_material("plume")
    verts, faces, uvs, weights = [], [], [], []; NU = 4
    for cname, bone, tip, mine in picked:
        near = [pos[i] for i in mine if pos[i].z < tip.z + 0.10]
        cen = sum(near, Vector()) / len(near)
        radial = Vector((tip.x - hips.x, tip.y - hips.y, 0)).normalized(); tang = Vector((-radial.y, radial.x, 0))
        w0 = max(0.07, min(0.16, max(abs((p - cen).dot(tang)) for p in near) * 2))
        d = (radial * 0.5 + Vector((0, 0, -1))).normalized(); a1 = tang
        pts = []; z = tip.z + PLUME_RISE
        while z > tip.z + 0.03:
            sl = [pos[i] for i in mine if abs(pos[i].z - z) < 0.03]
            if sl:
                pts.append(sum(sl, Vector()) / len(sl))
            z -= 0.04
        endc = Vector((cen.x, cen.y, tip.z)); pts.append(endc)
        for _ in range(2):
            pts = [pts[0]] + [(pts[j - 1] + pts[j] * 2 + pts[j + 1]) / 4 for j in range(1, len(pts) - 1)] + [pts[-1]]
        for k in range(1, 9):
            pts.append(endc + d * (PLUME_LEN * k / 8))
        cum = [0.0]
        for j in range(1, len(pts)):
            cum.append(cum[-1] + (pts[j] - pts[j - 1]).length)
        NV = len(pts) - 1; rows = []
        for j, p in enumerate(pts):
            dirj = (pts[min(j + 1, NV)] - pts[max(j - 1, 0)]).normalized()
            near_i = min(mine, key=lambda i: (pos[i] - p).length_squared)
            rows.append((p, dirj.cross(a1).normalized(), cum[j] / cum[-1], wts[near_i]))
        for k in range(3):
            ang = math.pi * k / 3; base = len(verts)
            for p, a2, s, w in rows:
                wd = a1 * math.cos(ang) + a2 * math.sin(ang); half = w0 / 2 * (0.55 + PLUME_SPREAD * s)
                for i in range(NU + 1):
                    uu = i / NU; verts.append(p + wd * (half * (uu * 2 - 1))); uvs.append((uu, s)); weights.append(w)
            for j in range(NV):
                for i in range(NU):
                    a = base + j * (NU + 1) + i; faces.append([a, a + 1, a + NU + 2, a + NU + 1])
    new_fx_object("FX_BoosterPlume", verts, faces, uvs, weights, pm)
    report["booster"] = dict(plumes=[t[0] for t in picked])


def setup_fx():
    st = {}
    setup_attributes(st)
    setup_star(st)
    setup_glow()
    setup_booster()
    sc = bpy.context.scene
    sc.render.fps = FPS; sc.frame_start, sc.frame_end = 1, LOOP


def apply_all():
    fix_dark_parts()
    setup_fx()
    setup_compositor()
    return report
