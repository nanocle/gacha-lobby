# Luna Cel パネル（v2）: セルルック版の見た目を 3D ビューのサイドバー（N）の「Luna Cel」タブから調整する。
# 数値はノードとライトに直接入っている（パネルはそれを映すだけ）。Blend を保存すれば残る。
# 使い方: Scripting タブ > テキスト > 開く でこのファイルを開き、▶（スクリプト実行）。
bl_info = {"name": "Luna Cel Panel", "author": "nanocle", "version": (2, 0, 0), "blender": (4, 2, 0),
           "location": "3D ビュー > サイドバー > Luna Cel", "category": "Material"}

import bpy, math, json, os
from mathutils import Vector

GROUPS = (("LunaCel_Skin", "肌"), ("LunaCel_Hair", "髪"), ("LunaCel_Cloth", "それ以外"), ("LunaCel_Eye", "瞳"), ("LunaCel_Sclera", "白目"))


# ---------- ライトの向き ----------
def _obj(name):
    return bpy.data.objects.get(name)


def _dir(az, el):
    """az: 0 が正面、プラスで本人の左（画面の右）。180° が真後ろ"""
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def _get_azel(name):
    o = _obj(name)
    if o is None:
        return 0.0, 0.0
    L = (o.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    return math.atan2(L.x, -L.y), math.asin(max(-1.0, min(1.0, L.z)))


def _set_azel(name, az, el):
    o = _obj(name)
    if o:
        o.rotation_mode = "XYZ"; o.rotation_euler = _dir(az, el).to_track_quat("Z", "Y").to_euler("XYZ")


def face_sun_apply():
    """顔用のライト: 頭から見ていつも前上から。本体ライトの左右へ少しだけ付いて来る"""
    fs = _obj("LunaCel_FaceSun")
    if fs is None:
        return
    el = fs.get("lc_el", math.radians(50.0)); follow = fs.get("lc_follow", 0.35); limit = fs.get("lc_limit", math.radians(18.0))
    az_main = _get_azel("LunaCel_Sun")[0]
    az = max(-limit, min(limit, az_main * follow))
    D = _dir(az, el)
    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE" and "head" in o.pose.bones), None)
    if rig:
        pb = rig.pose.bones["head"]
        delta = (rig.matrix_world @ pb.matrix) @ (rig.matrix_world @ pb.bone.matrix_local).inverted()
        D = (delta.to_3x3() @ D).normalized()
    m = D.to_track_quat("Z", "Y").to_matrix().to_4x4(); m.translation = Vector((0.0, -1.2, 2.4))
    fs.matrix_world = m


def _azel_prop(name, which, label, lo, hi, after=None, mirror=None):
    def g(self):
        return _get_azel(name)[which]

    def s(self, v):
        az, el = _get_azel(name)
        az, el = (v if which == 0 else az), (v if which == 1 else el)
        _set_azel(name, az, el)
        if mirror:
            _set_azel(mirror, -az, el)          # 反対側のライトは左右対称に置く
        if after:
            bpy.context.view_layer.update(); after()
    return bpy.props.FloatProperty(name=label, subtype="ANGLE", min=lo, max=hi, get=g, set=s)


def _fs_prop(key, label, default, lo, hi, angle=True):
    def g(self):
        fs = _obj("LunaCel_FaceSun")
        return fs.get(key, default) if fs else default

    def s(self, v):
        fs = _obj("LunaCel_FaceSun")
        if fs:
            fs[key] = v; face_sun_apply()
    kw = dict(subtype="ANGLE") if angle else dict(precision=2)
    return bpy.props.FloatProperty(name=label, min=lo, max=hi, get=g, set=s, **kw)


# ---------- アウトライン ----------
def _outlines():
    return [o for o in bpy.data.objects if o.name.endswith("_Outline")]


def _get_ol_on(self):
    os_ = _outlines()
    return bool(os_) and not os_[0].hide_render


def _set_ol_on(self, v):
    for o in _outlines():
        o.hide_viewport = o.hide_render = not v


def _get_ol_th(self):
    for o in _outlines():
        md = o.modifiers.get("LC_Outline")
        if md:
            return md.thickness * 1000.0
    return 0.0


def _set_ol_th(self, v):
    for o in _outlines():
        md = o.modifiers.get("LC_Outline")
        if md:
            md.thickness = v / 1000.0


def _boost_nodes():
    return [m.node_tree.nodes["FX_BoostStrength"] for m in bpy.data.materials
            if m.name.startswith("FX_Booster_") and m.node_tree and "FX_BoostStrength" in m.node_tree.nodes]


def _get_boost(self):
    ns = _boost_nodes()
    return ns[0].outputs[0].default_value if ns else 0.0


def _set_boost(self, v):
    for n in _boost_nodes():
        n.outputs[0].default_value = v


class LunaCelUI(bpy.types.PropertyGroup):
    boost: bpy.props.FloatProperty(name="腰のブースター", min=0.0, soft_max=10.0, precision=2, get=_get_boost, set=_set_boost)
    light_az: _azel_prop("LunaCel_Sun", 0, "向き（左右）", -math.pi, math.pi, face_sun_apply)
    light_el: _azel_prop("LunaCel_Sun", 1, "高さ", -math.pi / 2, math.pi / 2)
    rim_az: _azel_prop("LunaCel_RimSun", 0, "向き（180°が真後ろ）", -math.pi * 2, math.pi * 2)
    rim_el: _azel_prop("LunaCel_RimSun", 1, "高さ", -math.pi / 2, math.pi / 2)
    hs_el: _fs_prop("lc_el", "影の長さ", math.radians(50), 0.0, math.radians(85))
    hs_follow: _fs_prop("lc_follow", "本体ライトへの追従", 0.35, 0.0, 1.0, angle=False)
    outline_on: bpy.props.BoolProperty(name="アウトライン", get=_get_ol_on, set=_set_ol_on)
    outline_th: bpy.props.FloatProperty(name="太さ (mm)", min=0.0, soft_max=5.0, max=20.0, precision=2, get=_get_ol_th, set=_set_ol_th)
    show_detail: bpy.props.BoolProperty(name="詳細", default=False)
    detail_group: bpy.props.EnumProperty(name="対象", items=[(g, lab, "") for g, lab in GROUPS])


# ---------- 影をくっきりにする設定 ----------
# ぼかしの元（太陽の大きさ・ジッター）を切り、影の解像度を細かくして、しきい値の幅を狭くする。
# 縁のなめらかさは、影のフィルター（1サンプル内でのならし）と描画のサンプル数で出す。
# 注意: EEVEE の影フィルターは「描画サンプルごとに位置を散らす」方式で、広げるほど縁がぼける。
# くっきりさせるには、フィルターは1テクセル程度にして、影の解像度を細かくする。
CRISP = dict(angle_deg=0.05, resolution=0.0001, filter=1.0, face_resolution=0.0001, face_filter=1.5,
             cast_lo=0.46, cast_hi=0.54, softness=0.012, face_cut=0.5, face_edge=0.02, samples_render=64, samples_viewport=32)


def crisp_shadows():
    notes = []
    for nm in ("LunaCel_Sun", "LunaCel_HairSun", "LunaCel_RimSun", "LunaCel_RimSun2", "LunaCel_FaceSun"):
        o = _obj(nm)
        if o is None:
            continue
        face = nm == "LunaCel_FaceSun"
        for k, v in (("angle", math.radians(CRISP["angle_deg"])), ("use_shadow_jitter", False),
                     ("shadow_filter_radius", CRISP["face_filter"] if face else CRISP["filter"]),
                     ("shadow_maximum_resolution", CRISP["face_resolution"] if face else CRISP["resolution"])):
            try:
                setattr(o.data, k, v)
            except Exception as ex:
                notes.append("%s.%s: %r" % (nm, k, ex))
    ev = bpy.context.scene.eevee
    for k, v in (("shadow_pool_size", "2048"), ("shadow_ray_count", 1), ("shadow_step_count", 6), ("shadow_resolution_scale", 1.0),
                 ("taa_render_samples", CRISP["samples_render"]), ("taa_samples", CRISP["samples_viewport"])):
        try:
            setattr(ev, k, v)
        except Exception as ex:
            notes.append("eevee.%s: %r" % (k, ex))
    sun = _obj("LunaCel_Sun"); ng = bpy.data.node_groups.get("LunaCel_Light")
    if sun and ng:
        full = sun.data.energy / math.pi
        for n in ng.nodes:
            if n.type == "MAP_RANGE":
                n.inputs[1].default_value = CRISP["cast_lo"] * full; n.inputs[2].default_value = CRISP["cast_hi"] * full
    for g, _ in GROUPS:
        n = _node(g, "P_Softness")
        if n:
            n.outputs[0].default_value = CRISP["softness"]
    for nm, key in (("LC_HS_Edge", "face_edge"), ("LC_HS_Cut", "face_cut")):
        n = _node("LunaCel_FaceLight", nm)
        if n:
            n.outputs[0].default_value = CRISP[key]
    return notes


class LUNACEL_OT_crisp(bpy.types.Operator):
    bl_idname = "lunacel.crisp"; bl_label = "影をくっきり設定にする"
    bl_description = "太陽の大きさとジッターを切り、影の解像度を上げ、陰と落ち影の境目の幅を狭くする"

    def execute(self, ctx):
        notes = crisp_shadows()
        self.report({"INFO"}, "影をくっきり設定にしました" + ("（一部の設定は未対応: %d 件）" % len(notes) if notes else ""))
        return {"FINISHED"}


# ---------- ノードの値をそのまま出す ----------
def _node(group, name):
    ng = bpy.data.node_groups.get(group)
    return ng.nodes.get(name) if ng else None


def _row(layout, group, name, text=None, slider=False):
    n = _node(group, name)
    if n is not None:
        layout.prop(n.outputs[0], "default_value", text=text if text is not None else (n.label or name), slider=slider)


def collect():
    out = {}
    for ng in bpy.data.node_groups:
        if ng.name.startswith("LunaCel_"):
            for n in ng.nodes:
                if n.name.startswith(("G_", "P_", "LC_")) and n.type in ("VALUE", "RGB"):
                    v = n.outputs[0].default_value
                    out["%s.%s" % (ng.name, n.name)] = [round(x, 4) for x in v][:3] if n.type == "RGB" else round(v, 4)
    for nm in ("LunaCel_Sun", "LunaCel_RimSun", "LunaCel_FaceSun"):
        az, el = _get_azel(nm); out[nm] = dict(az_deg=round(math.degrees(az), 1), el_deg=round(math.degrees(el), 1))
    # ここから下は、ノードグループの外にある値（FX・にじみ・アウトライン・背景・ライトの設定）
    fx = {}
    for ng in bpy.data.node_groups:
        if ng.name.startswith("LunaCel_FX"):
            for n in ng.nodes:
                if n.type == "VALUE" and n.name.startswith("FX_") and n.name != "FX_Time":
                    fx[n.name] = round(n.outputs[0].default_value, 4)
    ns = _boost_nodes()
    if ns:
        fx["FX_BoostStrength"] = round(ns[0].outputs[0].default_value, 4)
    out["fx"] = fx
    comp = bpy.data.node_groups.get("LunaCel_Composite")
    if comp and comp.nodes.get("LC_Bloom"):
        gl = comp.nodes["LC_Bloom"]
        out["bloom"] = {k: round(gl.inputs[k].default_value, 4) for k in ("Threshold", "Strength", "Size") if k in gl.inputs}
    os_ = _outlines()
    if os_:
        md = os_[0].modifiers.get("LC_Outline")
        out["outline"] = dict(on=not os_[0].hide_render, thickness_mm=round(md.thickness * 1000.0, 3) if md else None)
    w = bpy.context.scene.world
    n = w.node_tree.nodes.get("LC_Background") if w and w.node_tree else None
    if n:
        out["background"] = [round(x, 4) for x in n.inputs[7].default_value][:3]
    fs = _obj("LunaCel_FaceSun")
    if fs:
        out["face_light"] = {k: round(float(fs.get(k, 0.0)), 4) for k in ("lc_el", "lc_follow", "lc_limit")}
    lights = {}
    for nm in ("LunaCel_Sun", "LunaCel_RimSun", "LunaCel_FaceSun"):
        o = _obj(nm)
        if o:
            d = o.data
            lights[nm] = dict(energy=round(d.energy, 4), angle_deg=round(math.degrees(d.angle), 4),
                              filter=round(getattr(d, "shadow_filter_radius", 0.0), 4),
                              resolution=round(getattr(d, "shadow_maximum_resolution", 0.0), 6), jitter=bool(getattr(d, "use_shadow_jitter", False)))
    out["lights"] = lights
    return out


def apply_state(st):
    """collect() が書き出した値をシーンへ戻す（組み立て直したあとに、調整済みの値を掛けるため）"""
    done = 0
    for k, v in st.items():
        if "." in k and k.split(".", 1)[0] in bpy.data.node_groups:
            g, nname = k.split(".", 1); n = bpy.data.node_groups[g].nodes.get(nname)
            if n is not None:
                n.outputs[0].default_value = (*v, 1.0) if isinstance(v, list) else v; done += 1
    for nm in ("LunaCel_Sun", "LunaCel_RimSun"):
        if nm in st and _obj(nm):
            _set_azel(nm, math.radians(st[nm]["az_deg"]), math.radians(st[nm]["el_deg"])); done += 1
    for nm, d in st.get("lights", {}).items():
        o = _obj(nm)
        if o:
            o.data.energy = d["energy"]; o.data.angle = math.radians(d["angle_deg"])
            for attr, key in (("shadow_filter_radius", "filter"), ("shadow_maximum_resolution", "resolution"), ("use_shadow_jitter", "jitter")):
                try:
                    setattr(o.data, attr, d[key])
                except Exception:
                    pass
    fs = _obj("LunaCel_FaceSun")
    if fs and "face_light" in st:
        for k, v in st["face_light"].items():
            fs[k] = v
        bpy.context.view_layer.update(); face_sun_apply(); done += 1
    for k, v in st.get("fx", {}).items():
        if k == "FX_BoostStrength":
            for n in _boost_nodes():
                n.outputs[0].default_value = v
        else:
            for ng in bpy.data.node_groups:
                if ng.name.startswith("LunaCel_FX") and k in ng.nodes:
                    ng.nodes[k].outputs[0].default_value = v
        done += 1
    comp = bpy.data.node_groups.get("LunaCel_Composite")
    if comp and comp.nodes.get("LC_Bloom"):
        for k, v in st.get("bloom", {}).items():
            comp.nodes["LC_Bloom"].inputs[k].default_value = v; done += 1
    if "outline" in st:
        for o in _outlines():
            o.hide_viewport = o.hide_render = not st["outline"]["on"]
            md = o.modifiers.get("LC_Outline")
            if md and st["outline"]["thickness_mm"] is not None:
                md.thickness = st["outline"]["thickness_mm"] / 1000.0
        done += 1
    w = bpy.context.scene.world
    n = w.node_tree.nodes.get("LC_Background") if w and w.node_tree else None
    if n and "background" in st:
        n.inputs[7].default_value = (*st["background"], 1.0); done += 1
    return done


class LUNACEL_OT_dump(bpy.types.Operator):
    bl_idname = "lunacel.dump"; bl_label = "今の数値を書き出す"
    bl_description = "調整した数値をクリップボードへコピーし、Blend の隣に luna_cel_params.json として保存する"

    def execute(self, ctx):
        txt = json.dumps(collect(), ensure_ascii=False, indent=1)
        ctx.window_manager.clipboard = txt
        if bpy.data.filepath:
            path = os.path.join(os.path.dirname(bpy.data.filepath), "luna_cel_params.json")
            open(path, "w", encoding="utf-8").write(txt); self.report({"INFO"}, "保存: " + path)
        return {"FINISHED"}


class LUNACEL_PT_panel(bpy.types.Panel):
    bl_label = "Luna Cel"; bl_idname = "LUNACEL_PT_panel"
    bl_space_type = "VIEW_3D"; bl_region_type = "UI"; bl_category = "Luna Cel"

    def draw(self, ctx):
        lay = self.layout; lay.use_property_split = True; lay.use_property_decorate = False
        ui = ctx.scene.luna_cel_ui; G = "LunaCel_Global"
        if bpy.data.node_groups.get(G) is None:
            lay.label(text="セルルック版（v2）の Blend を開いてください", icon="ERROR"); return

        b = lay.box(); b.label(text="光", icon="LIGHT_SUN")
        c = b.column(align=True); c.prop(ui, "light_az"); c.prop(ui, "light_el")
        c = b.column(align=True); _row(c, G, "G_LightColor", "主光の色"); _row(c, G, "G_LightGain", "主光の強さ")
        _row(b, G, "G_Ambient", "環境色")

        b = lay.box(); b.label(text="影", icon="MOD_MASK")
        c = b.column(align=True)
        _row(c, G, "G_ShadowColor", "影の色")
        c = b.column(align=True)
        _row(c, "LunaCel_FaceLight", "LC_HS_Strength", "顔に落ちる髪の影", slider=True); c.prop(ui, "hs_el"); c.prop(ui, "hs_follow", slider=True)
        b.operator("lunacel.crisp", icon="SHARPCURVE")

        b = lay.box(); b.label(text="リムライト（後ろからの2本目のライト）", icon="LIGHT_SPOT")
        c = b.column(align=True); _row(c, G, "G_RimStrength", "強さ"); _row(c, G, "G_RimColor", "色")
        c = b.column(align=True); c.prop(ui, "rim_az"); c.prop(ui, "rim_el")

        comp = bpy.data.node_groups.get("LunaCel_Composite")
        if comp and comp.nodes.get("LC_Bloom"):
            b = lay.box(); b.label(text="にじみ（ブルーム）", icon="LIGHT_POINT")
            gl = comp.nodes["LC_Bloom"]; c = b.column(align=True)
            for nm, lab in (("Strength", "強さ"), ("Threshold", "にじみ始める明るさ"), ("Size", "広がり")):
                if nm in gl.inputs:
                    c.prop(gl.inputs[nm], "default_value", text=lab)
            sh = getattr(ctx.space_data, "shading", None)
            if sh is not None and hasattr(sh, "use_compositor"):
                b.prop(sh, "use_compositor", text="ビューポート")
        if bpy.data.node_groups.get("LunaCel_FXGlow"):
            b = lay.box(); row = b.row(); row.label(text="FX（発光・輪・ブースター）", icon="SHADERFX")
            row.operator("screen.animation_play", text="", icon="PAUSE" if ctx.screen.is_animation_playing else "PLAY")
            c = b.column(align=True)
            _row(c, "LunaCel_FXGlow", "FX_GlowStrength", "ポイント発光"); _row(c, "LunaCel_FXGlow", "FX_HaloStrength", "天使の輪")
            _row(c, "LunaCel_FXHair", "FX_HairStrength", "毛先"); c.prop(ui, "boost", text="腰のブースター")

        b = lay.box(); b.label(text="仕上げ", icon="SHADING_RENDERED")
        _row(b, G, "G_Flatten", "テクスチャの描き込みを飛ばす", slider=True)
        c = b.column(align=True); c.prop(ui, "outline_on"); c.prop(ui, "outline_th")
        w = ctx.scene.world
        if w and w.node_tree:
            n = w.node_tree.nodes.get("LC_Background")
            if n:
                b.prop(n.inputs[7], "default_value", text="背景色")

        b = lay.box(); row = b.row()
        row.prop(ui, "show_detail", icon="TRIA_DOWN" if ui.show_detail else "TRIA_RIGHT", emboss=False)
        if ui.show_detail:
            b.prop(ui, "detail_group")
            ng = bpy.data.node_groups.get(ui.detail_group)
            c = b.column(align=True)
            for n in sorted((n for n in ng.nodes if n.name.startswith("P_")), key=lambda n: n.location.y, reverse=True) if ng else []:
                c.prop(n.outputs[0], "default_value", text=n.label or n.name)
            c = b.column(align=True); c.label(text="顔の髪影の細部")
            for nm in ("LC_HS_Cut", "LC_HS_Edge"):
                _row(c, "LunaCel_FaceLight", nm)
        lay.operator("lunacel.dump", icon="COPYDOWN")


CLASSES = (LunaCelUI, LUNACEL_OT_dump, LUNACEL_OT_crisp, LUNACEL_PT_panel)


def register():
    for nm in ("LUNACEL_PT_panel", "LUNACEL_OT_dump", "LUNACEL_OT_sync", "LUNACEL_OT_select_sun"):
        old = getattr(bpy.types, nm, None)
        if old:
            try:
                bpy.utils.unregister_class(old)
            except Exception:
                pass
    for c in CLASSES:
        old = getattr(bpy.types, c.__name__, None)
        if old:
            try:
                bpy.utils.unregister_class(old)
            except Exception:
                pass
        bpy.utils.register_class(c)
    bpy.types.Scene.luna_cel_ui = bpy.props.PointerProperty(type=LunaCelUI)


def unregister():
    del bpy.types.Scene.luna_cel_ui
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
