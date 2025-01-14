<!--
`accessors:true` hast to be set per component because of the svelte-language-server bug, otherwise accessors would be falsely detected as missing and highlighted as errors.
svelthree uses svelte-accmod, where accessors are always `true`, regardless of `svelte:options`.  
-->
<svelte:options accessors />

<!--
@component
**svelthree** _CubeCamera_ Component.
Renders a CubeMap for usage with **non-PBR** materials which have an `.envMap` property. `CubeCamera` is currently not working with PBR materials like `MeshStandardMaterial` (see [22236](https://github.com/mrdoob/three.js/issues/22236).     
[ tbd ]  Link to Docs. -->
<script context="module" lang="ts">
	/** For typed objects being set as `props` 'shorthand' attribute values, e.g.:
	 * ```
	 * const my_init_props: CubeCameraProps = {...}
	 * component_ref.props = my_init_props
	 * ```
	 * */
	export type CubeCameraProps = OnlyWritableNonFunctionPropsPlus<
		Omit<CubeCamera, PropBlackList>,
		{
			position?: Vector3 | Parameters<Vector3["set"]>
			scale?: Vector3 | Parameters<Vector3["set"]>
			rotation?:
				| Euler
				| Parameters<Euler["set"]>
				| Quaternion
				| Parameters<Quaternion["set"]>
				| Vector3
				| Parameters<Vector3["set"]>
			quaternion?: Quaternion | Parameters<Quaternion["set"]>
			matrix?: Matrix4 | Parameters<Matrix4["set"]>
		}
	>

	export type WebGLCubeRenderTargetProps = OnlyWritableNonFunctionProps<Omit<WebGLCubeRenderTarget, PropBlackList>>
	export type WebGLCubeRenderTargetOpt = { [P in keyof WebGLRenderTargetOptions]: WebGLRenderTargetOptions[P] }
</script>

<script lang="ts">
	import type { Scene } from "three"

	import { beforeUpdate, onMount, afterUpdate, onDestroy, getContext, setContext } from "svelte"
	import { get_current_component } from "svelte/internal"
	import { self as _self } from "svelte/internal"
	import { c_rs, c_lc, c_mau, c_dev, verbose_mode, get_comp_name } from "../utils/SvelthreeLogger"
	import type { LogLC, LogDEV } from "../utils/SvelthreeLogger"
	import type { OnlyWritableNonFunctionPropsPlus, PropBlackList } from "../types-extra"
	import type { Euler, Matrix4, Object3D, Quaternion } from "three"

	import { svelthreeStores } from "../stores"
	import { PropUtils, SvelthreeProps } from "../utils"

	import { SvelthreeAnimation } from "../components-internal"
	import type { SvelthreeAnimationFunction, SvelthreeAnimationFunctionReturn } from "../types-extra"

	import { CubeCamera, WebGLCubeRenderTarget } from "three"
	// custom CubeCameraHelper
	import { CubeCameraHelper } from "../utils"
	import { Vector3 } from "three"
	import type { CubeTexture, WebGLRenderer, WebGLRenderTargetOptions, Camera, Mesh } from "three"
	import type {
		Material,
		MeshBasicMaterialParameters,
		MeshPhongMaterial,
		MeshBasicMaterial,
		MeshLambertMaterial
	} from "three"
	import type { RemoveLast, OnlyWritableNonFunctionProps } from "../types-extra"
	import type { default as MeshSvelthreeComponent } from "./Mesh.svelte"
	import type { default as EmptySvelthreeComponent } from "./Empty.svelte"

	const self = get_current_component()
	const c_name = get_comp_name(self)

	const verbose: boolean = verbose_mode()

	export let log_all: boolean = false
	export let log_dev: { [P in keyof LogDEV]: LogDEV[P] } = log_all ? { all: true } : undefined
	export let log_rs: boolean = log_all
	export let log_lc: { [P in keyof LogLC]: LogLC[P] } = log_all ? { all: true } : undefined
	export let log_mau: boolean = log_all

	/**
	 * - `false` (default) -> `update_cubecam()` will be called **once on initialization**, further updates have to be done **manually** by calling `[CubeCamera component reference].update_cubecam()`.
	 * - `true` -> WebGLRenderer component will update the CubeCamera (_renderTarget.texture_) on **every frame**.
	 */
	export let dynamic: boolean = false

	let camera_updated: boolean = false

	let root_scene: Scene | null = undefined

	// keep in mind we can have scenes inside scenes!
	// root scene must not be the currently active scene!
	function get_root_scene(): Scene | null {
		let context_scene: Scene = getContext("scene")
		if (context_scene.parent === null) {
			return context_scene
		} else {
			let n = undefined
			let o: any = context_scene
			while (n !== null) {
				n = o.parent
			}
			return o
		}

		return null
	}

	/** Bind `CubeCamera`'s position to the specified component / object (three) instance
	 * ☝️ The `pos` shorthand attribute will override `bind_pos`! _Alternatively (standard)_:
	 * add the `CubeCamera` component as a child to either a `Mesh` or an `Empty` component,
	 * in this case `CubeCamera`'s position will be bound to it's parent / object (three) instance. */
	export let bind_pos: MeshSvelthreeComponent<any> | EmptySvelthreeComponent | Object3D = undefined
	$: if (camera && $svelthreeStores[sti].renderer && bind_pos && !bind_pos_offset && !dynamic) update_cubecam()

	/** Adjust `CubeCamera`'s position by setting an offset relative to the pivot of the object specified by `bind_pos`. */
	export let bind_pos_offset: Vector3 = undefined
	$: if (camera && $svelthreeStores[sti].renderer && bind_pos && bind_pos_offset && !dynamic) update_cubecam()

	/** Specify which objects / components should be hidden on `CubeCamera` update.
	 * Default: `CubeCamera`'s parent component's object (three) instance will be hidden.
	 * -> ☝️ If you add `CubeCamera` as a direct child of a `Scene` component without specifying some other object / objects to be hidden,
	 * the **root scene** will be hidden during the 'envMap'-texture rendering and your 'envMap' texture will be blank! */
	export let hide: (MeshSvelthreeComponent<any> | EmptySvelthreeComponent | Object3D)[] = undefined

	/** Binds the texture generated by the `CubeCamera` to some `Mesh`-component's `.material`(_currently non PBR + has `.envMap`_).
	 * This is the opposite of / alternative to binding the material's `.envMap` property to `[CubeCamera component reference].texture` */
	export let bind_tex: MeshPhongMaterial | MeshBasicMaterial | MeshLambertMaterial = undefined
	$: if (bind_tex) bind_tex.envMap = texture

	/** Reference to the `CubeTexture` instance generated by the `CubeCamera` (_full path: `camera.renderTarget.texture`_). */
	export let texture: CubeTexture = undefined
	$: texture = camera.renderTarget.texture

	/** Set to `true` for correct **floor reflections** (_default: `false`_). */
	export let is_floor: boolean = false

	let scene: Scene = getContext("scene")
	const sti: number = getContext("store_index")

	/** [ **feature**: allow providing (_injection_) of (_already created_) threejs object instances ].
	 * `create` is an internal indicator for how the component's corresponding threejs object instance has to be / has been created.
	 * It's being set to `false` on initialization if an (_already created_) threejs object instance was provided,
	 * otherwise it's set to `true`, means a new threejs object instance will be created. */
	let create = false

	/** The (three) instance that was shared to this component as it's 'parent'. */
	let our_parent: Object3D = undefined

	/** Returns the `camera` instance created by the component & allows providing (_injection_) of (_already created / premade_) `THREE.CubeCamera` instances. */
	export let camera: CubeCamera = undefined

	/** Returns the `renderTarget` instance created by the component & allows providing (_injection_) of (_already created / premade_) `THREE.WebGLCubeRenderTarget` instances. */
	export let renderTarget: WebGLCubeRenderTarget = undefined

	let camera_uuid: string = undefined
	let index_in_cubecameras: number = undefined

	export const is_svelthree_component: boolean = true
	export const is_svelthree_camera: boolean = true

	if (camera) {
		create = false
		on_instance_provided()
	} else {
		create = true
	}

	/** IMPORTANT  Executed when / if an instance was provided **on initializiation** -> only once if at all! */
	function on_instance_provided(): void {
		// check if type of provided instance is correct and then do something with it...
		if (camera.type === "CubeCamera") {
			camera.userData.initScale = camera.scale.x
			camera.userData.svelthreeComponent = self

			// with `CubeCameras` we push the component reference to svelthreeStores,
			// beacuse we need to access it's `update()` function from the `WebGLRenderer` component.

			$svelthreeStores[sti].cubeCameras.push(self)

			index_in_cubecameras = camera.userData.index_in_cubecameras
		} else {
			throw new Error(
				`SVELTHREE > CubeCamera Error: provided 'camera' instance has wrong type '${camera.type}', should be 'CubeCamera'!`
			)
		}
	}

	// Determining 'parent' on initialization if 'camera' instance was provided ('create' is false).
	if (!create) {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// `CubeCamera` instances are always added to the `root_scene`
		// no matter which component the `CubeCamera` component was added to.
		root_scene = get_root_scene()

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", camera)
	}
	// GENERATOR REMARK: 'reactive_re_creation_logic' not implemented for 'CubeCamera'!

	/** Initializes `renderTarget` with provided constructor parameters.*/
	export let renderTargetParams: ConstructorParameters<typeof WebGLCubeRenderTarget> = undefined

	/** Initializes `camera` with provided constructor parameters -> `renderTarget` is not needed (assigned internally). */
	export let params: RemoveLast<ConstructorParameters<typeof CubeCamera>> = undefined

	// create 'renderTarget' first
	$: if (!renderTarget && create) {
		// leave any parameter errors handling to threejs
		if (renderTargetParams) {
			renderTarget = new WebGLCubeRenderTarget(...renderTargetParams)
		} else {
			throw new Error(
				`SVELTHREE > ${c_name} : You need to specify 'renderTargetParams' attribute in order to create 'renderTarget' `
			)
		}

		if (verbose && log_dev) console.debug(...c_dev(c_name, `'renderTarget' created!`, { renderTarget }))
	}

	// create 'camera'
	$: if (!camera && renderTarget && create) {
		// leave any parameter errors handling to threejs
		if (params) {
			camera = new CubeCamera(...params, renderTarget)
		} else {
			throw new Error(
				`SVELTHREE > ${c_name} : You need to specify 'params' attribute in order to create 'camera' `
			)
		}

		camera_uuid = camera.uuid

		camera.userData.initScale = camera.scale.x
		camera.userData.svelthreeComponent = self

		// with `CubeCameras` we push the component reference to svelthreeStores,
		// beacuse we need to access it's `update()` function from the `WebGLRenderer` component.

		$svelthreeStores[sti].cubeCameras.push(self)

		index_in_cubecameras = camera.userData.index_in_cubecameras

		if (verbose && log_dev) console.debug(...c_dev(c_name, `${camera.type} created!`, { camera }))
	}

	// Determining 'parent' if 'camera' instance has to be created first / was not provided on initialization ('create' is true).
	$: if (camera && create && !our_parent) set_parent()

	function set_parent() {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// `CubeCamera` instances are always added to the `root_scene`
		// no matter which component the `CubeCamera` component was added to.
		root_scene = get_root_scene()

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", camera)
	}

	// this statement is being triggered on creation / recreation
	$: if (camera && ((camera_uuid && camera_uuid !== camera.uuid) || (root_scene && camera.parent !== root_scene)))
		add_instance_to()

	function add_instance_to(): void {
		//let replacing = false

		// if 'camera' was already created or set via 'camera' attribute before
		if (camera_uuid && camera.uuid !== camera_uuid) {
			// remove old instance and update references where needed

			const old_instance: Object3D = scene.getObjectByProperty("uuid", camera_uuid)

			// update 'index_in_x'

			/*
if ($svelthreeStores[sti].cubeCameras.indexOf(old_instance) !== index_in_cubecameras) {
	index_in_cubecameras = $svelthreeStores[sti].cubeCameras.indexOf(old_instance)
}
*/

			index_in_cubecameras = old_instance.userData.index_in_cubecameras

			if (old_instance.userData.helper?.parent) {
				old_instance.userData.helper.parent.remove()
				old_instance.userData.helper = null
			}

			if (old_instance.userData.box?.parent) {
				old_instance.userData.helper.parent.remove(old_instance.userData.helper)
				old_instance.userData.box = null
			}

			if (old_instance.parent) old_instance.parent.remove(old_instance)

			camera.userData.index_in_cubecameras = index_in_cubecameras

			$svelthreeStores[sti].cubeCameras[index_in_cubecameras] = self

			// recreate 'SvelthreeProps'
			// - all initially set props will be applied to the new instance.
			// - 'props' attribute can be used directly after camera reassignment.
			sProps = new SvelthreeProps(camera)

			// helpers will be recreated automatically
			// (see corresponding reactive statement -> !camera.userData.helper)
		}

		// `CubeCamera`'s instance `camera` is always added to the `root_scene` no matter which component the `CubeCamera` component was added to.
		// the `our_parent` is needed for positioning only.
		if (root_scene) {
			// TODO  UNDERSTAND completely why we need the `camera !== our_parent` check (was added as quick-fix)
			// TODO  Update - we changed the approach, still needed?
			if (root_scene !== our_parent) {
				root_scene.add(camera)
				camera_uuid = camera.uuid

				if (verbose && log_dev) {
					console.debug(
						...c_dev(c_name, `${camera.type} was added to ${our_parent.type}!`, {
							camera,
							scene,
							total: scene.children.length
						})
					)
				}
			} else {
				// TODO / TOFIX  why is this happening if `!replacing`?
				//if (!replacing) console.warn(`camera was already added to the ${get_comp_name(our_parent)}`, {camera, our_parent, scene})
			}
		} else {
			console.error("No 'our_parent' (or 'scene')! Nothing to add 'camera' to!", { camera, our_parent, scene })
		}
	}

	interface MaterialWithEnvMap extends Material {
		envMap?: MeshBasicMaterialParameters["envMap"]
	}

	/** Called internally from WebGLRenderer component if `dynamic` is `true` (default). Can also be called directly if `dynamic` is `false`. */
	export const update_cubecam = () => {
		// TODO  FEATURE: There could be some logic if camera.parent is scene (&& NOT the root scene) traversing all objects in a scene,
		// checking if their material has an '.envMap' property and is not a PBR material and then apply the the cubemap texture to those objects.
		// But for now, this is not possible.

		let bound_pos: typeof bind_pos = bind_pos || our_parent
		let to_hide: typeof hide | typeof bind_pos = hide || bound_pos
		let renderer: WebGLRenderer = $svelthreeStores[sti].renderer
		let active_scene: Scene = $svelthreeStores[sti].activeScene

		if (pos === undefined) {
			// the floor hack -> see https://jsfiddle.net/3mprbLc9/
			if (is_floor) {
				let active_cam: Camera = $svelthreeStores[sti].activeCamera
				let target_pos: Vector3 = get_cubecam_target_position(active_cam)
				camera.position.copy(target_pos)

				// IMPORTANT  GOOD  this does NOT triggers all 'camera' bound reactive statements as opposed to `camera.position.y *= -1`!
				camera.position.setY(camera.position.y * -1)
			} else {
				let target_pos: Vector3 = get_cubecam_target_position(bound_pos)
				if (bind_pos_offset) {
					let corrected_target_pos: Vector3 = target_pos.clone().add(bind_pos_offset)
					camera.position.copy(corrected_target_pos)
				} else {
					camera.position.copy(target_pos)
				}
			}
		}

		change_visibility(to_hide, false)
		camera.update(renderer, active_scene)
		change_visibility(to_hide, true)

		camera_updated = true

		if (!bind_tex) {
			let op: Mesh = bound_pos as Mesh
			let op_mat: MaterialWithEnvMap = op.material as MaterialWithEnvMap
			if (op_mat?.hasOwnProperty("envMap")) {
				op_mat.envMap = camera.renderTarget.texture
			}
		}
	}

	function change_visibility(to_change: typeof hide | typeof bind_pos, val: boolean) {
		let toc: typeof hide = to_change as typeof hide
		if (toc.length && toc.length > 0) {
			for (let i = 0; i < toc.length; i++) {
				set_visibility(toc[i], val)
			}
		} else {
			set_visibility(toc, val)
		}
	}

	function set_visibility(obj: typeof hide | typeof bind_pos, val: boolean) {
		if (obj["is_svelthree_component"]) {
			let o: MeshSvelthreeComponent<any> | EmptySvelthreeComponent = obj as
				| MeshSvelthreeComponent<any>
				| EmptySvelthreeComponent
			o.get_instance().visible = val
		} else {
			let o: Object3D = obj as Object3D
			o.visible = val
		}
	}

	function get_cubecam_target_position(obj: typeof bind_pos | Camera): Vector3 {
		let wp: Vector3 = new Vector3()

		if (typeof obj["getWorldPosition"] === "function") {
			let o: Object3D = obj as Object3D
			o.getWorldPosition(wp)
		} else {
			let o: MeshSvelthreeComponent<any> | EmptySvelthreeComponent = obj as
				| MeshSvelthreeComponent<any>
				| EmptySvelthreeComponent
			o.get_instance().getWorldPosition(wp)
		}

		return wp
	}

	/** Override object's `.matrixAutoUpdate` set (*on initialzation*) by scene's `.matrixAutoUpdate` (*default is `true`*). Also: `mau` can be changed on-the-fly.*/
	export let mau: boolean = undefined
	$: if (camera) camera.matrixAutoUpdate = scene.matrixAutoUpdate
	$: if (camera && mau !== undefined) camera.matrixAutoUpdate = mau

	export let name: string = undefined
	$: if (camera && name) camera.name = name

	/** ☝️ `matrix` **shorthand** attribute overrides ( *are ignored* ) `pos`, `rot`, `quat`, `scale` and `lookAt` 'shorthand' attributes! */
	export let matrix: Matrix4 | Parameters<Matrix4["set"]> = undefined

	const w_sh = PropUtils.getShortHandAttrWarnings(`SVELTHREE > ${c_name} >`)

	let sProps: SvelthreeProps

	let sPropsTarget: SvelthreeProps

	/** **shorthand** attribute for setting properties using key-value pairs in an `Object`. */
	export let renderTargetOptions: { [P in keyof WebGLRenderTargetOptions]: WebGLRenderTargetOptions[P] } = undefined
	$: if (renderTargetOptions && camera_updated) recreate_render_target()

	function recreate_render_target() {
		//console.log("recreate_render_target!")
		if (verbose && log_rs)
			console.debug(...c_rs(c_name, "renderTargetOptions (recreating 'renderTarget')", renderTargetOptions))
		// without camera recreation!
		// renderTarget has to be recreated, see https://github.com/mrdoob/three.js/blob/master/src/renderers/WebGLCubeRenderTarget.js
		// it creates a whole bunch of stuff based on provided options. The main goal was not to recreate the camera.
		renderTarget = new WebGLCubeRenderTarget(renderTargetParams[0], renderTargetOptions)
		camera.renderTarget = renderTarget

		update_cubecam()
		update_texture_bindings()
	}

	function update_texture_bindings() {
		if (bind_tex) {
			bind_tex.envMap = camera.renderTarget.texture
		} else {
			if (bind_pos) {
				if (bind_pos["mat"]) {
					bind_pos["mat"].envMap = camera.renderTarget.texture
				} else if (bind_pos["material"]) {
					bind_pos["material"].envMap = camera.renderTarget.texture
					bind_pos["material"].needsUpdate = true
				}
			} else if (our_parent) {
				if (our_parent["mat"]) {
					our_parent["mat"].envMap = camera.renderTarget.texture
				} else if (our_parent["material"]) {
					our_parent["material"].envMap = camera.renderTarget.texture
				}
			}
		}
	}

	/** **shorthand** attribute for setting properties using key-value pairs in an `Object`. */
	export let renderTargetProps: { [P in keyof WebGLCubeRenderTargetProps]: WebGLCubeRenderTargetProps[P] } = undefined

	$: if (!sPropsTarget && renderTargetProps && renderTargetProps) sPropsTarget = new SvelthreeProps(renderTargetProps)
	$: if (renderTargetProps && sPropsTarget) update_render_target_props()
	function update_render_target_props() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "renderTargetProps", renderTargetProps))
		sPropsTarget.update(renderTargetProps)
	}

	// IMPORTANT  `props` will be overridden by 'shorthand' attributes!
	/** **shorthand** attribute for setting properties using key-value pairs in an `Object`. */
	export let props: { [P in keyof CubeCameraProps]: CubeCameraProps[P] } = undefined

	$: if (!sProps && camera && props) sProps = new SvelthreeProps(camera)
	$: if (props && sProps) update_props()
	function update_props() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "props", props))
		sProps.update(props)
	}

	// IMPORTANT  following 'shorthand' attributes will override `props` attribute!

	/** **shorthand** attribute for setting the `position` property. */
	export let pos: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && camera && pos ? set_pos() : pos && camera ? console.warn(w_sh.pos) : null
	function set_pos() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "pos", pos))
		PropUtils.setPositionFromValue(camera, pos)
	}

	/** **shorthand** attribute for setting the `rotation` property. */
	export let rot:
		| Euler
		| Parameters<Euler["set"]>
		| Quaternion
		| Parameters<Quaternion["set"]>
		| Vector3
		| Parameters<Vector3["set"]> = undefined
	$: !matrix && !quat && camera && rot ? set_rot() : rot && camera ? console.warn(w_sh.rot) : null
	function set_rot() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "rot", rot))
		PropUtils.setRotationFromValue(camera, rot)
	}

	/** **shorthand** attribute for setting the `quaternion` property. */
	export let quat: Quaternion | Parameters<Quaternion["set"]> = undefined
	$: !matrix && camera && quat ? set_quat() : quat && camera ? console.warn(w_sh.quat) : null
	function set_quat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "quat", quat))
		PropUtils.setQuaternionFromValue(camera, quat)
	}

	export let scale: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && camera && scale ? set_scale() : scale && camera ? console.warn(w_sh.scale) : null
	function set_scale() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "scale", scale))
		PropUtils.setScaleFromValue(camera, scale)
	}

	/** */
	export let lookAt: Vector3 | Parameters<Vector3["set"]> | Object3D = undefined
	$: !matrix && camera && lookAt ? set_lookat() : lookAt && camera ? console.warn(w_sh.lookAt) : null
	function set_lookat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "lookAt", lookAt))
		PropUtils.setLookAtFromValue(camera, lookAt)
	}

	// IMPORTANT  `matrix` 'shorthand' attribute will override all other transforms ('shorthand' attributes)!
	$: if (matrix && camera) set_matrix()
	function set_matrix(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "matrix", matrix))
		PropUtils.setMatrixFromValue(camera, matrix)
	}

	// no 'params' -> CameraHelper takes only a cam instance as a parameter.
	/** Creates and adds a  `CubeCameraHelper` (_no `helperParams`_). */
	export let helper: boolean = undefined

	$: camera && !camera.userData.helper && helper === true ? add_helper() : null
	$: camera && camera.userData.helper && !helper ? remove_helper() : null

	function add_helper(): void {
		camera.userData.helper = new CubeCameraHelper(camera)
		camera.userData.helper.add(root_scene)
	}

	function remove_helper(): void {
		if (camera.userData.helper) {
			camera.userData.helper.remove()
			camera.userData.helper = null
		}
	}

	let ani: any

	let currentSceneActive = false
	$: currentSceneActive = $svelthreeStores[sti].scenes[scene.userData.index_in_scenes]?.isActive

	export let animation: SvelthreeAnimationFunction = undefined

	export let aniauto: boolean = undefined

	let animationEnabled: boolean = false
	$: if (animation) animationEnabled = true

	/** Removes the (three) instance of the object created by the component from it's parent. */
	export const remove_instance_from_parent = (): void => {
		if (camera.parent) camera.parent.remove(camera)
	}
	/**
	 * Same as `remove_instance_from_parent()` just shorter syntax.
	 * Removes the (three) instance of the object created by the component from it's parent.
	 */
	export const remove = remove_instance_from_parent

	/** Returns the (three) instance of the object created by the component. */
	export const get_instance = (): CubeCamera => camera

	/** Returns the `animation` object. */
	export const get_animation = (): any => ani.getAnimation()
	/** Same as `get_animation()` just shorter syntax. Returns the `animation` object. */
	export const get_ani = get_animation

	/** Starts the `animation` object. */
	export const start_animation = (): void => ani.startAni()
	/** Same as `start_animation()` just shorter syntax. Starts the `animation` object. */
	export const start_ani = start_animation

	/** **Completely replace** `onMount` -> any `onMount_inject_before` & `onMount_inject_after` will be ignored.
	 * _default verbosity will be gone!_ */
	export let onMount_replace: (args?: any) => any = undefined

	onMount(
		onMount_replace
			? async () => onMount_replace(_self)
			: async () => {
					if (verbose && log_lc && (log_lc.all || log_lc.om)) {
						console.info(...c_lc(c_name, "onMount"))
					}

					if (verbose && log_mau) {
						console.debug(
							...c_mau(c_name, "onMount : camera.", {
								matrixAutoUpdate: camera.matrixAutoUpdate,
								matrixWorldNeedsUpdate: camera.matrixWorldNeedsUpdate
							})
						)
					}
			  }
	)

	/** **Inject** functionality **before** component's existing `onDestroy` logic.
	 * _default verbosity not affected._ */
	export let onDestroy_inject_before: (args?: any) => any = undefined

	/** **Inject** functionality **after** component's existing `onDestroy` logic.
	 * _default verbosity not affected._ */
	export let onDestroy_inject_after: (args?: any) => any = undefined

	/** **Completely replace** `onDestroy` -> any `onDestroy_inject_before` & `onDestroy_inject_after` will be ignored.
	 * _default verbosity will be gone!_ */
	export let onDestroy_replace: (args?: any) => any = undefined

	onDestroy(
		onDestroy_replace
			? async () => onDestroy_replace(_self)
			: async () => {
					if (verbose && log_lc && (log_lc.all || log_lc.od)) {
						console.info(...c_lc(c_name, "onDestroy"))
					}

					if (verbose && log_mau) {
						console.debug(
							...c_mau(c_name, "onDestroy : camera.", {
								matrixAutoUpdate: camera.matrixAutoUpdate,
								matrixWorldNeedsUpdate: camera.matrixWorldNeedsUpdate
							})
						)
					}

					if (onDestroy_inject_before) onDestroy_inject_before()

					remove_instance_from_parent()

					if (onDestroy_inject_after) onDestroy_inject_after()
			  }
	)

	/** **Completely replace** `beforeUpdate` -> any `beforeUpdate_inject_before` & `beforeUpdate_inject_after` will be ignored.
	 * _default verbosity will be gone!_ */
	export let beforeUpdate_replace: (args?: any) => any = undefined

	beforeUpdate(
		beforeUpdate_replace
			? async () => beforeUpdate_replace(_self)
			: async () => {
					if (verbose && log_lc && (log_lc.all || log_lc.bu)) {
						console.info(...c_lc(c_name, "beforeUpdate"))
					}

					if (verbose && log_mau) {
						console.debug(
							...c_mau(c_name, "beforeUpdate : camera.", {
								matrixAutoUpdate: camera.matrixAutoUpdate,
								matrixWorldNeedsUpdate: camera.matrixWorldNeedsUpdate
							})
						)
					}
			  }
	)

	/** **Inject** functionality **before** component's existing `afterUpdate` logic.
	 * _default verbosity not affected._ */
	export let afterUpdate_inject_before: (args?: any) => any = undefined

	/** **Inject** functionality **after** component's existing `afterUpdate` logic.
	 * _default verbosity not affected._ */
	export let afterUpdate_inject_after: (args?: any) => any = undefined

	/** **Completely replace** `afterUpdate` -> any `afterUpdate_inject_before` & `afterUpdate_inject_after` will be ignored.
	 * _default verbosity will be gone!_ */
	export let afterUpdate_replace: (args?: any) => any = undefined

	afterUpdate(
		afterUpdate_replace
			? async () => afterUpdate_replace(_self)
			: async () => {
					if (verbose && log_lc && (log_lc.all || log_lc.au)) {
						console.info(...c_lc(c_name, "afterUpdate"))
					}

					if (verbose && log_mau) {
						console.debug(
							...c_mau(c_name, "afterUpdate : camera.", {
								matrixAutoUpdate: camera.matrixAutoUpdate,
								matrixWorldNeedsUpdate: camera.matrixWorldNeedsUpdate
							})
						)
					}

					if (afterUpdate_inject_before) afterUpdate_inject_before()

					// Update local matrix after all (props) changes (async microtasks) have been applied.
					if (!camera.matrixAutoUpdate) camera.updateMatrix()

					if (verbose && !camera.matrixAutoUpdate && log_mau) {
						console.debug(
							...c_mau(c_name, "afterUpdate : camera.", {
								matrixAutoUpdate: camera.matrixAutoUpdate,
								matrixWorldNeedsUpdate: camera.matrixWorldNeedsUpdate
							})
						)
					}

					if (afterUpdate_inject_after) afterUpdate_inject_after()
			  }
	)
</script>

<!-- using context -->
<slot />

<!-- TODO  get rid of the SvelthreeAnimation component / create a ts class -->
{#if animation}
	<SvelthreeAnimation
		bind:this={ani}
		bind:currentSceneActive
		obj={camera}
		{animationEnabled}
		{animation}
		{aniauto}
		{log_dev}
		{log_rs}
		{log_lc}
		{log_mau}
	/>
{/if}
