/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
export default {
	/**
	 * selectedOption: An array of strings denoting options shown in the menu.
	 */
	props: ['headers', 'rows', 'filter', 'regex'],

	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			lastScroll: 0,
			isScrolling: false,
			slotCount: 1,
			slotCountMax: 0,
			lastSelectItem: null
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);
		// this.onPaste = e => this.handlePaste(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// document.addEventListener('paste', this.onPaste);

		// if (this.keyinput) {
		// 	this.onKeyDown = e => this.handleKey(e);
		// 	document.addEventListener('keydown', this.onKeyDown);
		// }

		// // Register observer for layout changes.
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.$refs.root);

		this.tableObserver = new ResizeObserver(() => this.resizeTable());
		this.tableObserver.observe(this.$refs.datatablebody);
	},


	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeUnmount: function() {
		// // Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		// document.removeEventListener('paste', this.onPaste);

		// if (this.keyinput)
		// 	document.removeEventListener('keydown', this.onKeyDown);

		// Disconnect resize observer.
		this.observer.disconnect();
		this.tableObserver.disconnect();
	},

	computed: {
		/**
		 * Offset of the scroll widget in pixels.
		 * Between 0 and the height of the component.
		 */
		scrollOffset: function() {
			return (this.scroll) + 'px';
		},

		/**
		 * Index which array reading should start at, based on the current
		 * relative scroll and the overall item count. Value is dynamically
		 * capped based on slot count to prevent empty slots appearing.
		 */
		scrollIndex: function() {
			return Math.round((this.filteredItems.length - this.slotCount) * this.scrollRel);
		},

		/**
		 * Reactively filtered version of the underlying data array.
		 * Automatically refilters when the filter input is changed.
		 */
		filteredItems: function() {
			// Skip filtering if no filter is set.
			if (!this.filter)
				return this.rows;

			let res = this.rows;

			if (this.regex) {
				try {
					const filter = new RegExp(this.filter.trim());
					res = res.filter(row => row.some(col =>
						(typeof col === 'string' && col.match(filter)) ||
						(typeof col === 'number' && col.toString().match(filter)) // also filter by id
					));
				} catch (e) {
					// Regular expression did not compile, skip filtering.
				}
			} else {
				const filter = this.filter.trim().toLowerCase();
				if (filter.length > 0) {
					res = res.filter(row => row.some(col =>
						(typeof col === 'string' && col.toLowerCase().includes(filter)) ||
						(typeof col === 'number' && col.toString().toLowerCase().includes(filter)) // also filter by id
					));
				}
			}

			return res;
		},

		/**
		 * Dynamic array of items which should be displayed from the underlying
		 * data array. Reactively updates based on scroll and data.
		 */
		displayItems: function() {
			return this.filteredItems.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function() {
			return 1 / this.filteredItems.length;
		}
	},

	methods: {
		resetSlotCount: function() {
			this.slotCount = Math.floor((this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight) / 32);
		},

		/**
		 * Invoked by a ResizeObserver when the main component node
		 * is resized due to layout changes.
		 */
		resize: function() {
			this.scroll = (this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight)) * this.scrollRel;
			this.resetSlotCount();
			setTimeout(() => this.resizeTable(), 10);
		},

		resizeTable: function() {
			const availableHeight = this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight;
			if (this.$refs.datatablebody.clientHeight <= availableHeight)
				return;

			let acum = 0;
			let slots = 0;
			for (const tr of this.$refs.datatablebody.querySelectorAll('tr')) {
				acum += tr.clientHeight + 2;  // clientHeight + border-spacing
				if (acum > availableHeight)
					break;

				slots++;
			}

			this.slotCount = slots;
			if (this.slotCountMax < slots)
				this.slotCountMax = slots;
		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function() {
			const max = this.$refs.root.clientHeight - this.$refs.dtscroller.clientHeight - this.$refs.datatableheader.clientHeight;
			this.scroll = Math.min(max, Math.max(0, this.scroll));
			if (this.filteredItems.length > this.slotCount)
				this.scrollRel = this.scroll / max;
			else
				this.scrollRel = 0;

			if (this.lastScroll !== this.scrollOffset) {
				this.resetSlotCount();
				setTimeout(() => this.resizeTable(), 10);
			}

			this.lastScroll = this.scrollOffset;
		},

		/**
		 * Invoked when a mouse-down event is captured on the scroll widget.
		 * @param {MouseEvent} e 
		 */
		startMouse: function(e) {
			this.scrollStartY = e.clientY;
			this.scrollStart = this.scroll;
			this.isScrolling = true;
		},

		/**
		 * Invoked when a mouse-move event is captured globally.
		 * @param {MouseEvent} e 
		 */
		moveMouse: function(e) {
			if (this.isScrolling) {
				this.scroll = this.scrollStart + (e.clientY - this.scrollStartY);
				this.recalculateBounds();
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 */
		stopMouse: function() {
			this.isScrolling = false;
		},

		/**
		 * Invoked when a mouse-wheel event is captured on the component node.
		 * @param {WheelEvent} e
		 */
		wheelMouse: function(e) {
			if (this.slotCount <= 1)
				return;

			const weight = this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight);
			const direction = e.deltaY > 0 ? 1 : -1;
			// cap scroll to max slots seen, otherwise it might scroll too much when resizing
			const scrollSlots = this.slotCountMax === 0 ? this.slotCount : Math.min(this.slotCount, this.slotCountMax);
			this.scroll += ((scrollSlots * 0.7 * this.itemWeight) * weight) * direction;
			this.recalculateBounds();
		},
	},

	watch: {
		filteredItems() {
			this.scroll = 0;
			this.scrollRel = 0;
			this.resetSlotCount();
			this.resizeTable();
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `
		<div>
			<div ref="root" class="ui-datatable" @wheel="wheelMouse">
				<div class="scroller" ref="dtscroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }">
					<div>
					</div>
				</div>
				<div class="table-container">
					<table>
						<thead ref="datatableheader">
							<tr>
								<th v-for="header in headers">{{header}}</th>
							</tr>
						</thead>
						<tbody ref="datatablebody">
							<tr v-for="row in displayItems">
								<td v-for="field in row">{{field}}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
			<div class="list-status">{{ filteredItems.length }} row{{ (filteredItems.length != 1 ? 's' : '') }} found.</div>
		</div
	`
};