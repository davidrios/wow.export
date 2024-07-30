const { ref, computed, watchEffect, onMounted } = Vue;

export default {
	props: ['materials'],
	setup(props) {
		const materialsArray = computed(() => Array.from(props.materials.values()));
		const currentPos = ref(0);
		const rootRef = ref();
		
		onMounted(() => {
			watchEffect(() => {
				if (currentPos.value > materialsArray.value.length - 1)
					currentPos.value = 0;
	
				if (currentPos.value < 0)
					currentPos.value = materialsArray.value.length - 1;
	
				rootRef.value.querySelector('canvas')?.remove();
				if (materialsArray.value.length > 0)
					rootRef.value.appendChild(materialsArray.value[currentPos.value].getCanvas());
			})
		})
		
		return {
			currentPos,
			rootRef
		}
	},
	template: `
		<div class="texture-preview-panel" ref="rootRef">
			<div id="chr-overlay-btn" :style="{display: materials.size > 1 ? 'flex' : 'none'}">
				<input type="button" value="&gt;" @click="currentPos++"/>
				<input type="button" value="&lt;" @click="currentPos--"/>
			</div>
		</div>
	`
}