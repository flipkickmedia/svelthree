<!--
`accessors:true` hast to be set per component because of the svelte-language-server bug, otherwise accessors would be falsely detected as missing and highlighted as errors.
svelthree uses svelte-accmod, where accessors are always `true`, regardless of `svelte:options`.  
-->
<svelte:options accessors />

<!--
@component
**svelthree** _Mesh_ Component.
[ tbd ]  Link to Docs.
-->
<script context="module" lang="ts">
	/** For typed objects being set as `props` 'shorthand' attribute values, e.g.:
	 * ```
	 * const my_init_props: MeshProps = {...}
	 * component_ref.props = my_init_props
	 * ```
	 * */
	export type MeshProps = OnlyWritableNonFunctionPropsPlus<
		Omit<Mesh, PropBlackList>,
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

	export type MeshInteractionHandler = (e?: CustomEvent) => void
</script>

<script lang="ts">
	import type { Scene } from "three"

	import { beforeUpdate, onMount, afterUpdate, onDestroy, getContext, setContext } from "svelte"
	import { get_current_component } from "svelte/internal"
	import { self as _self } from "svelte/internal"
	import { c_rs, c_lc, c_mau, c_dev, verbose_mode, get_comp_name } from "../utils/SvelthreeLogger"
	import type { LogLC, LogDEV } from "../utils/SvelthreeLogger"
	import type { OnlyWritableNonFunctionPropsPlus, PropBlackList } from "../types-extra"
	import type { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three"

	import { svelthreeStores } from "../stores"
	import { PropUtils, SvelthreeProps } from "../utils"

	import { SvelthreeAnimation } from "../components-internal"
	import type { SvelthreeAnimationFunction, SvelthreeAnimationFunctionReturn } from "../types-extra"

	import { SvelthreeInteraction } from "../components-internal"
	import { createEventDispatcher } from "svelte"
	import type { Writable } from "svelte/store"

	import { BoxHelper } from "three"

	import type { BufferGeometry } from "three"

	import { Mesh } from "three"
	import type { OnlyWritableNonFunctionPropsOverwritten, RemoveFirst } from "../types-extra"
	import type { Material, Color } from "three"

	const self = get_current_component()
	const c_name = get_comp_name(self)

	const verbose: boolean = verbose_mode()

	export let log_all: boolean = false
	export let log_dev: { [P in keyof LogDEV]: LogDEV[P] } = log_all ? { all: true } : undefined
	export let log_rs: boolean = log_all
	export let log_lc: { [P in keyof LogLC]: LogLC[P] } = log_all ? { all: true } : undefined
	export let log_mau: boolean = log_all

	const dispatch = createEventDispatcher()

	let scene: Scene = getContext("scene")
	const sti: number = getContext("store_index")

	/** [ **feature**: allow providing (_injection_) of (_already created_) threejs object instances ].
	 * `create` is an internal indicator for how the component's corresponding threejs object instance has to be / has been created.
	 * It's being set to `false` on initialization if an (_already created_) threejs object instance was provided,
	 * otherwise it's set to `true`, means a new threejs object instance will be created. */
	let create = false

	/** The (three) instance that was shared to this component as it's 'parent'. */
	let our_parent: Object3D = undefined

	/** Returns the `mesh` instance created by the component & allows providing (_injection_) of (_already created / premade_) `THREE.Mesh` instances. */
	export let mesh: Mesh = undefined
	let mesh_uuid: string = undefined

	// Generic Material type and props
	// COOL!  This is possible now! see https://github.com/sveltejs/language-tools/issues/442#issuecomment-977803507
	// 'mat' shorthand attribute will give us proper intellisense (props list) for the assigned 'material'!
	// TODO  MULTIPLE MATERIALS: this works only with single Material atm, multiple Materials are not implemented yet.
	type AnyMaterial = $$Generic<Material | Material[]>
	type AnyMaterialProps = OnlyWritableNonFunctionPropsOverwritten<
		Omit<AnyMaterial, PropBlackList>,
		{ color: Color | string | number | [r: number, g: number, b: number] | number[] | Vector3 }
	>
	export let material: AnyMaterial = undefined
	export let geometry: BufferGeometry = undefined

	export const is_svelthree_component: boolean = true
	export const is_svelthree_mesh: boolean = true

	if (mesh) {
		create = false
		on_instance_provided()
	} else {
		create = true
	}

	/** IMPORTANT  Executed when / if an instance was provided **on initializiation** -> only once if at all! */
	function on_instance_provided(): void {
		// check if type of provided instance is correct and then do something with it...
		if (mesh.type === "Mesh") {
			if (mesh.geometry) {
				geometry = mesh.geometry
				if (verbose && log_dev) console.debug(...c_dev(c_name, "saved geometry:", { geometry }))
			} else {
				// this will most probably never happen ( TODO  when would it?)
				throw new Error("SVELTHREE > Mesh : 'mesh' provided, but has no geometry!")
			}

			if (mesh.material) {
				material = mesh.material as AnyMaterial
				if (verbose && log_dev) console.debug(...c_dev(c_name, "saved material:", { material }))
			} else {
				// this will most probably never happen ( TODO  when would it?)
				throw new Error("SVELTHREE > Mesh : 'mesh' provided, but has no material!")
			}

			mesh.userData.initScale = mesh.scale.x
			mesh.userData.svelthreeComponent = self
		} else {
			throw new Error(
				`SVELTHREE > Mesh Error: provided 'mesh' instance has wrong type '${mesh.type}', should be 'Mesh'!`
			)
		}
	}

	// Determining 'parent' on initialization if 'mesh' instance was provided ('create' is false).
	if (!create) {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", mesh)
	}

	// reactive creating / recreating mesh

	$: if (geometry && create) on_geometry_provided()
	$: if (material && create) on_material_provided()

	function on_geometry_provided() {
		if (verbose && log_dev) console.debug(...c_dev(c_name, "'geometry' provided!"))
		try_geometry_update()
	}

	function on_material_provided() {
		if (verbose && log_dev) console.debug(...c_dev(c_name, "'material' provided!"))
		try_material_update()
	}

	// change geometry and material on provided mesh

	// we know mesh has geometry if geometry is available and !create, it was referenced on_instance_provided()
	$: if (geometry && !create) {
		if (geometry !== mesh.geometry) try_geometry_update()
	}

	// we know mesh has material if material is available and !create, it was referenced on_instance_provided()
	$: if (material && !create) {
		if (material !== mesh.material) try_material_update()
	}

	function try_geometry_update(): void {
		if (mesh) {
			mesh.geometry = geometry as BufferGeometry

			// update BoxHelper if any
			if (mesh.userData.box) mesh.userData.box.update()

			if (verbose && log_dev) console.debug(...c_dev(c_name, "'geometry' updated!"))
		}
	}

	function try_material_update(): void {
		if (mesh) {
			mesh.material = material
			if (verbose && log_dev) console.debug(...c_dev(c_name, "'material' updated!"))
			force_material_update()
		}
	}

	function force_material_update(): void {
		// recreate 'sMat' in case sMat was created with / is bound to 'mesh.material'
		sMat = new SvelthreeProps(material)
		if (sMat && mat) sMat.update(mat)
	}

	// creation using provided geometry & material or constructor 'params' shorthand

	/** Initializes `Mesh` with provided constructor parameters.*/
	export let params: ConstructorParameters<typeof Mesh> = undefined

	$: if (!mesh && create) {
		if (geometry && material) {
			if (params?.length)
				console.error(
					`SVELTHREE Error > ${c_name} : You've set 'geometry', 'material' & 'params' -> specified 'params' will be ignored! Please use either 'geometry' & 'material' or 'params' for initialization.`
				)

			// letting threejs throw errors if anything's wrong with 'geometry' or 'material'
			mesh = new Mesh(geometry, material)

			mesh_uuid = mesh.uuid

			mesh.userData.initScale = mesh.scale.x
			mesh.userData.svelthreeComponent = self

			if (verbose && log_dev) console.debug(...c_dev(c_name, `${geometry.type} created!`, { mesh }))
			if (verbose && log_dev) console.debug(...c_dev(c_name, "saved 'geometry' (created):", geometry))
			if (verbose && log_dev) console.debug(...c_dev(c_name, "saved 'material' (created):", material))
		} else {
			// create 'mesh' via params (can be an empty []) or if no 'params' set (undefined) via new Mesh()

			// create with params -> since 'geometry' & 'material' are optional, params can also be empty []!
			if (params) {
				// disallow 'params' with 'geometry' or 'material'
				if (geometry)
					throw new Error(
						`SVELTHREE Error > ${c_name} : You've set 'geometry' & 'params' -> specified 'geometry' will be ignored! Please use either 'geometry' & 'material' or 'params' for initialization.`
					)
				if (material)
					throw new Error(
						`SVELTHREE Error > ${c_name} : You've set 'material' & 'params' -> specified 'material' will be ignored! Please use either 'geometry' & 'material' or 'params' for initialization.`
					)

				if (params.length) {
					// letting threejs throw errors if anything's wrong with provided 'params'
					mesh = new Mesh(...params)
				} else {
					// will create a blank 'BufferGeometry' and a blank Material
					mesh = new Mesh()
				}
			} else {
				// no 'geometry', no 'material' and no 'params'
				// will create a blank 'BufferGeometry' or a blank Material or both.
				mesh = new Mesh(geometry, material)
			}

			mesh_uuid = mesh.uuid

			mesh.userData.initScale = mesh.scale.x
			mesh.userData.svelthreeComponent = self

			if (verbose && log_dev) console.debug(...c_dev(c_name, `${geometry.type} created!`, { mesh }))
		}
	}

	// Determining 'parent' if 'mesh' instance has to be created first / was not provided on initialization ('create' is true).
	$: if (mesh && create && !our_parent) set_parent()

	function set_parent() {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", mesh)
	}

	// this statement is being triggered on creation / recreation
	$: if (mesh && ((mesh_uuid && mesh_uuid !== mesh.uuid) || (mesh.parent !== our_parent && mesh !== our_parent)))
		add_instance_to()

	function add_instance_to(): void {
		//let replacing = false

		// if 'mesh' was already created or set via 'mesh' attribute before
		if (mesh_uuid && mesh.uuid !== mesh_uuid) {
			// remove old instance and update references where needed

			const old_instance: Object3D = scene.getObjectByProperty("uuid", mesh_uuid)

			// update 'index_in_x'

			if (old_instance.userData.helper?.parent) {
				old_instance.userData.helper.parent.remove(old_instance.userData.helper)
				old_instance.userData.helper = null
			}

			if (old_instance.userData.box?.parent) {
				old_instance.userData.helper.parent.remove(old_instance.userData.helper)
				old_instance.userData.box = null
			}

			if (old_instance.parent) old_instance.parent.remove(old_instance)

			// recreate 'SvelthreeProps'
			// - all initially set props will be applied to the new instance.
			// - 'props' attribute can be used directly after mesh reassignment.
			sProps = new SvelthreeProps(mesh)

			// helpers will be recreated automatically
			// (see corresponding reactive statement -> !mesh.userData.helper)
		}

		// add `mesh` to `our_parent`
		if (our_parent) {
			// TODO  UNDERSTAND completely why we need the `mesh !== our_parent` check (was added as quick-fix)
			// TODO  Update - we changed the approach, still needed?
			if (mesh.parent !== our_parent && mesh !== our_parent) {
				our_parent.add(mesh)
				mesh_uuid = mesh.uuid

				if (verbose && log_dev) {
					console.debug(
						...c_dev(c_name, `${geometry.type} was added to ${our_parent.type}!`, {
							mesh,
							scene,
							total: scene.children.length
						})
					)
				}
			} else {
				// TODO / TOFIX  why is this happening if `!replacing`?
				//if (!replacing) console.warn(`mesh was already added to the ${get_comp_name(our_parent)}`, {mesh, our_parent, scene})
			}
		} else {
			console.error("No 'our_parent' (or 'scene')! Nothing to add 'mesh' to!", { mesh, our_parent, scene })
		}
	}

	/** Override object's `.matrixAutoUpdate` set (*on initialzation*) by scene's `.matrixAutoUpdate` (*default is `true`*). Also: `mau` can be changed on-the-fly.*/
	export let mau: boolean = undefined
	$: if (mesh) mesh.matrixAutoUpdate = scene.matrixAutoUpdate
	$: if (mesh && mau !== undefined) mesh.matrixAutoUpdate = mau

	export let name: string = undefined
	$: if (mesh && name) mesh.name = name

	let sMat: SvelthreeProps

	$: if (!sMat) {
		if (mesh.material) {
			sMat = new SvelthreeProps(mesh.material)
		}
	}

	// Generic Material props
	// COOL!  This works now! 'mat' shorthand attribute will give us proper intellisense (props list) for the assigned 'material'!
	// TODO  MULTIPLE MATERIALS: this works only with single Material atm, multiple Materials are not implemented yet.
	/** **shorthand** attribute for setting properties of a `Material` using key-value pairs in an `Object`. */
	export let mat: { [P in keyof AnyMaterialProps]: AnyMaterialProps[P] } = undefined
	$: if (mat && sMat) sMat.update(mat)

	/** ☝️ `matrix` **shorthand** attribute overrides ( *are ignored* ) `pos`, `rot`, `quat`, `scale` and `lookAt` 'shorthand' attributes! */
	export let matrix: Matrix4 | Parameters<Matrix4["set"]> = undefined

	const w_sh = PropUtils.getShortHandAttrWarnings(`SVELTHREE > ${c_name} >`)

	let sProps: SvelthreeProps

	// IMPORTANT  `props` will be overridden by 'shorthand' attributes!
	/** **shorthand** attribute for setting properties using key-value pairs in an `Object`. */
	export let props: { [P in keyof MeshProps]: MeshProps[P] } = undefined

	$: if (!sProps && mesh && props) sProps = new SvelthreeProps(mesh)
	$: if (props && sProps) update_props()
	function update_props() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "props", props))
		sProps.update(props)
	}

	// IMPORTANT  following 'shorthand' attributes will override `props` attribute!

	/** **shorthand** attribute for setting the `position` property. */
	export let pos: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && mesh && pos ? set_pos() : pos && mesh ? console.warn(w_sh.pos) : null
	function set_pos() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "pos", pos))
		PropUtils.setPositionFromValue(mesh, pos)
	}

	/** **shorthand** attribute for setting the `rotation` property. */
	export let rot:
		| Euler
		| Parameters<Euler["set"]>
		| Quaternion
		| Parameters<Quaternion["set"]>
		| Vector3
		| Parameters<Vector3["set"]> = undefined
	$: !matrix && !quat && mesh && rot ? set_rot() : rot && mesh ? console.warn(w_sh.rot) : null
	function set_rot() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "rot", rot))
		PropUtils.setRotationFromValue(mesh, rot)
	}

	/** **shorthand** attribute for setting the `quaternion` property. */
	export let quat: Quaternion | Parameters<Quaternion["set"]> = undefined
	$: !matrix && mesh && quat ? set_quat() : quat && mesh ? console.warn(w_sh.quat) : null
	function set_quat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "quat", quat))
		PropUtils.setQuaternionFromValue(mesh, quat)
	}

	export let scale: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && mesh && scale ? set_scale() : scale && mesh ? console.warn(w_sh.scale) : null
	function set_scale() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "scale", scale))
		PropUtils.setScaleFromValue(mesh, scale)
	}

	/** */
	export let lookAt: Vector3 | Parameters<Vector3["set"]> | Object3D = undefined
	$: !matrix && mesh && lookAt ? set_lookat() : lookAt && mesh ? console.warn(w_sh.lookAt) : null
	function set_lookat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "lookAt", lookAt))
		PropUtils.setLookAtFromValue(mesh, lookAt)
	}

	// IMPORTANT  `matrix` 'shorthand' attribute will override all other transforms ('shorthand' attributes)!
	$: if (matrix && mesh) set_matrix()
	function set_matrix(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "matrix", matrix))
		PropUtils.setMatrixFromValue(mesh, matrix)
	}

	export let castShadow: boolean = undefined
	$: if (castShadow !== undefined && mesh) mesh.castShadow = castShadow

	export let receiveShadow: boolean = undefined
	$: if (receiveShadow !== undefined && mesh) mesh.receiveShadow = receiveShadow

	type BoxHelperParams = ConstructorParameters<typeof BoxHelper>
	export let boxParams: RemoveFirst<BoxHelperParams> = undefined
	/** Creates and adds a `BoxHelper`. */
	export let box: boolean = undefined

	$: if (box && mesh && !mesh.userData.box) add_box_helper()
	$: if (!box && mesh.userData.box) remove_box_helper()

	function add_box_helper() {
		if (boxParams) {
			mesh.userData.box = new BoxHelper(mesh, ...boxParams)
		} else {
			mesh.userData.box = new BoxHelper(mesh)
		}

		scene.add(mesh.userData.box)
	}

	function remove_box_helper() {
		if (mesh.userData.box?.parent) {
			mesh.userData.box.parent.remove(mesh.userData.box)
			mesh.userData.box = null
		}
	}

	export let interact: boolean = undefined

	let interactive: boolean = undefined
	const canvas_interactivity: Writable<{ enabled: boolean }> = getContext("canvas_interactivity")

	$: interactive = $canvas_interactivity.enabled

	let interactionEnabled: boolean = undefined
	$: interactionEnabled = interactive && interact

	export let onClick: MeshInteractionHandler = undefined

	export let onPointerUp: MeshInteractionHandler = undefined

	export let onPointerDown: MeshInteractionHandler = undefined

	export let onPointerOver: MeshInteractionHandler = undefined

	export let onPointerOut: MeshInteractionHandler = undefined

	export let onPointerEnter: MeshInteractionHandler = undefined

	export let onPointerLeave: MeshInteractionHandler = undefined

	export let onPointerMove: MeshInteractionHandler = undefined

	onClick = null
	onPointerUp = null
	onPointerDown = null
	onPointerOver = null
	onPointerOut = null
	onPointerEnter = null
	onPointerLeave = null
	onPointerMove = null

	let ani: any

	let currentSceneActive = false
	$: currentSceneActive = $svelthreeStores[sti].scenes[scene.userData.index_in_scenes]?.isActive

	export let animation: SvelthreeAnimationFunction = undefined

	export let aniauto: boolean = undefined

	let animationEnabled: boolean = false
	$: if (animation) animationEnabled = true

	/** Removes the (three) instance of the object created by the component from it's parent. */
	export const remove_instance_from_parent = (): void => {
		if (mesh.parent) mesh.parent.remove(mesh)
	}
	/**
	 * Same as `remove_instance_from_parent()` just shorter syntax.
	 * Removes the (three) instance of the object created by the component from it's parent.
	 */
	export const remove = remove_instance_from_parent

	/** Returns the (three) instance of the object created by the component. */
	export const get_instance = (): Mesh => mesh

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
							...c_mau(c_name, "onMount : mesh.", {
								matrixAutoUpdate: mesh.matrixAutoUpdate,
								matrixWorldNeedsUpdate: mesh.matrixWorldNeedsUpdate
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
							...c_mau(c_name, "onDestroy : mesh.", {
								matrixAutoUpdate: mesh.matrixAutoUpdate,
								matrixWorldNeedsUpdate: mesh.matrixWorldNeedsUpdate
							})
						)
					}

					if (onDestroy_inject_before) onDestroy_inject_before()

					remove_box_helper()

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
							...c_mau(c_name, "beforeUpdate : mesh.", {
								matrixAutoUpdate: mesh.matrixAutoUpdate,
								matrixWorldNeedsUpdate: mesh.matrixWorldNeedsUpdate
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
							...c_mau(c_name, "afterUpdate : mesh.", {
								matrixAutoUpdate: mesh.matrixAutoUpdate,
								matrixWorldNeedsUpdate: mesh.matrixWorldNeedsUpdate
							})
						)
					}

					if (afterUpdate_inject_before) afterUpdate_inject_before()

					// Update local matrix after all (props) changes (async microtasks) have been applied.
					if (!mesh.matrixAutoUpdate) mesh.updateMatrix()

					if (verbose && !mesh.matrixAutoUpdate && log_mau) {
						console.debug(
							...c_mau(c_name, "afterUpdate : mesh.", {
								matrixAutoUpdate: mesh.matrixAutoUpdate,
								matrixWorldNeedsUpdate: mesh.matrixWorldNeedsUpdate
							})
						)
					}

					if (box && mesh.userData.box) mesh.userData.box.update()

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
		obj={mesh}
		{animationEnabled}
		{animation}
		{aniauto}
		{log_dev}
		{log_rs}
		{log_lc}
		{log_mau}
	/>
{/if}

{#if $svelthreeStores[sti].renderer && $svelthreeStores[sti].renderer.xr.enabled === false}
	<SvelthreeInteraction
		{dispatch}
		obj={mesh}
		parent={self}
		{interactionEnabled}
		{log_dev}
		{log_rs}
		{log_lc}
		{log_mau}
	/>
{/if}
