<!--
`accessors:true` hast to be set per component because of the svelte-language-server bug, otherwise accessors would be falsely detected as missing and highlighted as errors.
svelthree uses svelte-accmod, where accessors are always `true`, regardless of `svelte:options`.  
-->
<svelte:options accessors />

<!--
@component
**svelthree** _RectAreaLight_ Component.
[ tbd ]  Link to Docs.
-->
<script context="module" lang="ts">
	/** For typed objects being set as `props` 'shorthand' attribute values, e.g.:
	 * ```
	 * const my_init_props: RectAreaLightProps = {...}
	 * component_ref.props = my_init_props
	 * ```
	 * */
	export type RectAreaLightProps = OnlyWritableNonFunctionPropsPlus<
		Omit<RectAreaLight, PropBlackList>,
		{
			lookAt?: Vector3 | Parameters<Vector3["set"]> | Object3D
			position?: Vector3 | Parameters<Vector3["set"]>
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

	import { RectAreaLight } from "three"
	import type { Color } from "three"
	import { RectAreaLightHelper } from "three/examples/jsm/helpers/RectAreaLightHelper"
	import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib"
	import type { RemoveFirst } from "../types-extra"

	const self = get_current_component()
	const c_name = get_comp_name(self)

	const verbose: boolean = verbose_mode()

	export let log_all: boolean = false
	export let log_dev: { [P in keyof LogDEV]: LogDEV[P] } = log_all ? { all: true } : undefined
	export let log_rs: boolean = log_all
	export let log_lc: { [P in keyof LogLC]: LogLC[P] } = log_all ? { all: true } : undefined
	export let log_mau: boolean = log_all

	let scene: Scene = getContext("scene")
	const sti: number = getContext("store_index")

	/** [ **feature**: allow providing (_injection_) of (_already created_) threejs object instances ].
	 * `create` is an internal indicator for how the component's corresponding threejs object instance has to be / has been created.
	 * It's being set to `false` on initialization if an (_already created_) threejs object instance was provided,
	 * otherwise it's set to `true`, means a new threejs object instance will be created. */
	let create = false

	/** The (three) instance that was shared to this component as it's 'parent'. */
	let our_parent: Object3D = undefined

	/** Returns the `light` instance created by the component & allows providing (_injection_) of (_already created / premade_) `THREE.RectAreaLight` instances. */
	export let light: RectAreaLight = undefined
	let light_uuid: string = undefined

	export const is_svelthree_component: boolean = true
	export const is_svelthree_light: boolean = true

	if (light) {
		create = false
		on_instance_provided()
	} else {
		create = true
	}

	/** IMPORTANT  Executed when / if an instance was provided **on initializiation** -> only once if at all! */
	function on_instance_provided(): void {
		// check if type of provided instance is correct and then do something with it...
		if (light.type === "RectAreaLight") {
			light.userData.initScale = light.scale.x
			light.userData.svelthreeComponent = self
		} else {
			throw new Error(
				`SVELTHREE > RectAreaLight Error: provided 'light' instance has wrong type '${light.type}', should be 'RectAreaLight'!`
			)
		}
	}

	// Determining 'parent' on initialization if 'light' instance was provided ('create' is false).
	if (!create) {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", light)
	}
	// GENERATOR REMARK: 'reactive_re_creation_logic' not implemented for 'RectAreaLight'!

	let ral_ulib_initiated: boolean = false
	$: if (!ral_ulib_initiated) {
		ral_ulib_initiated = true
		RectAreaLightUniformsLib.init()
	}

	/** Initializes `RectAreaLight` with provided constructor parameters.*/
	export let params: ConstructorParameters<typeof RectAreaLight> = undefined

	$: if (!light && create) {
		if (params) {
			light = new RectAreaLight(...params)
		} else {
			light = new RectAreaLight()
		}

		light_uuid = light.uuid

		light.userData.svelthreeComponent = self

		if (verbose && log_dev) console.debug(...c_dev(c_name, `${light.type} created!`, { light }))
	}

	// Determining 'parent' if 'light' instance has to be created first / was not provided on initialization ('create' is true).
	$: if (light && create && !our_parent) set_parent()

	function set_parent() {
		// get the instance that was shared to us as our 'parent'.
		our_parent = getContext("parent") || scene

		// share created object (three) instance to all children (slots) as 'parent'.
		setContext("parent", light)
	}

	// this statement is being triggered on creation / recreation
	$: if (
		light &&
		((light_uuid && light_uuid !== light.uuid) || (light.parent !== our_parent && light !== our_parent))
	)
		add_instance_to()

	function add_instance_to(): void {
		//let replacing = false

		// if 'light' was already created or set via 'light' attribute before
		if (light_uuid && light.uuid !== light_uuid) {
			// remove old instance and update references where needed

			const old_instance: Object3D = scene.getObjectByProperty("uuid", light_uuid)

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
			// - 'props' attribute can be used directly after light reassignment.
			sProps = new SvelthreeProps(light)

			// helpers will be recreated automatically
			// (see corresponding reactive statement -> !light.userData.helper)
		}

		// add `light` to `our_parent`
		if (our_parent) {
			// TODO  UNDERSTAND completely why we need the `light !== our_parent` check (was added as quick-fix)
			// TODO  Update - we changed the approach, still needed?
			if (light.parent !== our_parent && light !== our_parent) {
				our_parent.add(light)
				light_uuid = light.uuid

				if (verbose && log_dev) {
					console.debug(
						...c_dev(c_name, `${light.type} was added to ${our_parent.type}!`, {
							light,
							scene,
							total: scene.children.length
						})
					)
				}
			} else {
				// TODO / TOFIX  why is this happening if `!replacing`?
				//if (!replacing) console.warn(`light was already added to the ${get_comp_name(our_parent)}`, {light, our_parent, scene})
			}
		} else {
			console.error("No 'our_parent' (or 'scene')! Nothing to add 'light' to!", { light, our_parent, scene })
		}
	}

	/** Override object's `.matrixAutoUpdate` set (*on initialzation*) by scene's `.matrixAutoUpdate` (*default is `true`*). Also: `mau` can be changed on-the-fly.*/
	export let mau: boolean = undefined
	$: if (light) light.matrixAutoUpdate = scene.matrixAutoUpdate
	$: if (light && mau !== undefined) light.matrixAutoUpdate = mau

	export let name: string = undefined
	$: if (light && name) light.name = name

	/** ☝️ `matrix` **shorthand** attribute overrides ( *are ignored* ) `pos`, `rot`, `quat`, `scale` and `lookAt` 'shorthand' attributes! */
	export let matrix: Matrix4 | Parameters<Matrix4["set"]> = undefined

	const w_sh = PropUtils.getShortHandAttrWarnings(`SVELTHREE > ${c_name} >`)

	let sProps: SvelthreeProps

	// IMPORTANT  `props` will be overridden by 'shorthand' attributes!
	/** **shorthand** attribute for setting properties using key-value pairs in an `Object`. */
	export let props: { [P in keyof RectAreaLightProps]: RectAreaLightProps[P] } = undefined

	$: if (!sProps && light && props) sProps = new SvelthreeProps(light)
	$: if (props && sProps) update_props()
	function update_props() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "props", props))
		sProps.update(props)
	}

	// IMPORTANT  following 'shorthand' attributes will override `props` attribute!

	/** **shorthand** attribute for setting the `position` property. */
	export let pos: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && light && pos ? set_pos() : pos && light ? console.warn(w_sh.pos) : null
	function set_pos() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "pos", pos))
		PropUtils.setPositionFromValue(light, pos)
	}

	/** **shorthand** attribute for setting the `rotation` property. */
	export let rot:
		| Euler
		| Parameters<Euler["set"]>
		| Quaternion
		| Parameters<Quaternion["set"]>
		| Vector3
		| Parameters<Vector3["set"]> = undefined
	$: !matrix && !quat && light && rot ? set_rot() : rot && light ? console.warn(w_sh.rot) : null
	function set_rot() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "rot", rot))
		PropUtils.setRotationFromValue(light, rot)
	}

	/** **shorthand** attribute for setting the `quaternion` property. */
	export let quat: Quaternion | Parameters<Quaternion["set"]> = undefined
	$: !matrix && light && quat ? set_quat() : quat && light ? console.warn(w_sh.quat) : null
	function set_quat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "quat", quat))
		PropUtils.setQuaternionFromValue(light, quat)
	}

	export let scale: Vector3 | Parameters<Vector3["set"]> = undefined
	$: !matrix && light && scale ? set_scale() : scale && light ? console.warn(w_sh.scale) : null
	function set_scale() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "scale", scale))
		PropUtils.setScaleFromValue(light, scale)
	}

	/** */
	export let lookAt: Vector3 | Parameters<Vector3["set"]> | Object3D = undefined
	$: !matrix && light && lookAt ? set_lookat() : lookAt && light ? console.warn(w_sh.lookAt) : null
	function set_lookat() {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "lookAt", lookAt))
		PropUtils.setLookAtFromValue(light, lookAt)
	}

	// IMPORTANT  `matrix` 'shorthand' attribute will override all other transforms ('shorthand' attributes)!
	$: if (matrix && light) set_matrix()
	function set_matrix(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "matrix", matrix))
		PropUtils.setMatrixFromValue(light, matrix)
	}

	export let color: Color | string | number | [r: number, g: number, b: number] | number[] | Vector3 = undefined
	$: if (color) set_color()
	function set_color(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "color", color))
		PropUtils.setColorFromValueKey(light, color, "color")
	}

	/** The light's intensity. Default is 1. */
	export let intensity: number = undefined
	$: if (light && intensity !== undefined) set_intensity()
	function set_intensity(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "intensity", intensity))
		light.intensity = intensity
	}

	export let power: number = undefined
	$: if (light && power !== undefined) set_power()
	function set_power(): void {
		if (verbose && log_rs) console.debug(...c_rs(c_name, "power", power))
		light.power = power
	}

	type HelperParams = ConstructorParameters<typeof RectAreaLightHelper>
	export let helperParams: RemoveFirst<HelperParams> = undefined
	export let helper: boolean = undefined

	$: light && !light.userData.helper && helper ? add_helper() : null
	$: light && light.userData.helper && !helper ? remove_helper() : null

	function add_helper(): void {
		if (helperParams) {
			light.userData.helper = new RectAreaLightHelper(light, ...helperParams)
		} else {
			light.userData.helper = new RectAreaLightHelper(light)
		}

		scene.add(light.userData.helper)
	}

	function remove_helper(): void {
		if (light.userData.helper?.parent) {
			light.userData.helper.parent.remove(light.userData.helper)
			light.userData.helper = null
		}
	}

	let ani: any

	let currentSceneActive = false
	$: currentSceneActive = $svelthreeStores[sti].scenes[scene.userData.index_in_scenes]?.isActive

	export let animation: SvelthreeAnimationFunction = undefined

	export let aniauto: boolean = undefined

	let animationEnabled: boolean = false
	$: if (animation) animationEnabled = true

	export const get_helper = (): RectAreaLightHelper => light.userData.helper as RectAreaLightHelper

	/** Removes the (three) instance of the object created by the component from it's parent. */
	export const remove_instance_from_parent = (): void => {
		if (light.parent) light.parent.remove(light)
	}
	/**
	 * Same as `remove_instance_from_parent()` just shorter syntax.
	 * Removes the (three) instance of the object created by the component from it's parent.
	 */
	export const remove = remove_instance_from_parent

	/** Returns the (three) instance of the object created by the component. */
	export const get_instance = (): RectAreaLight => light

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
							...c_mau(c_name, "onMount : light.", {
								matrixAutoUpdate: light.matrixAutoUpdate,
								matrixWorldNeedsUpdate: light.matrixWorldNeedsUpdate
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
							...c_mau(c_name, "onDestroy : light.", {
								matrixAutoUpdate: light.matrixAutoUpdate,
								matrixWorldNeedsUpdate: light.matrixWorldNeedsUpdate
							})
						)
					}

					if (onDestroy_inject_before) onDestroy_inject_before()

					remove_helper()
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
							...c_mau(c_name, "beforeUpdate : light.", {
								matrixAutoUpdate: light.matrixAutoUpdate,
								matrixWorldNeedsUpdate: light.matrixWorldNeedsUpdate
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
							...c_mau(c_name, "afterUpdate : light.", {
								matrixAutoUpdate: light.matrixAutoUpdate,
								matrixWorldNeedsUpdate: light.matrixWorldNeedsUpdate
							})
						)
					}

					if (afterUpdate_inject_before) afterUpdate_inject_before()

					// Update local matrix after all (props) changes (async microtasks) have been applied.
					if (!light.matrixAutoUpdate) light.updateMatrix()

					if (verbose && !light.matrixAutoUpdate && log_mau) {
						console.debug(
							...c_mau(c_name, "afterUpdate : light.", {
								matrixAutoUpdate: light.matrixAutoUpdate,
								matrixWorldNeedsUpdate: light.matrixWorldNeedsUpdate
							})
						)
					}

					if (helper && light.userData.helper) light.userData.helper.update()

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
		obj={light}
		{animationEnabled}
		{animation}
		{aniauto}
		{log_dev}
		{log_rs}
		{log_lc}
		{log_mau}
	/>
{/if}
