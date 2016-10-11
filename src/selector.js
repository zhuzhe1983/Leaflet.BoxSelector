//selection logic separated into another class for clarity, but included in this file for simplicity
var SelectionManager = L.Class.extend({

	initialize: function (map) {
		this._map = map;
	},
	
	getSelectedMarkers: function() {
		var markers = Object.keys(this._allSelectedMarkers).sort().map(function(markerId) { //sort is just so the order is predictable, makes debugging easier
			return this._allSelectedMarkers[markerId];
		}.bind(this));
		return markers;
	},
	
	enable: function() {
		this._clearExistingSelection();
	},
	
	_clearExistingSelection: function() {
		this._allSelectedMarkers = {};
		this._previouslySelectedMarkers = [];
		this._currentlySelectedMarkers = [];
	},
	
	disable: function() {
		for (key in this._allSelectedMarkers) {
			var marker = this._allSelectedMarkers[key];
			this._toggleSelection(marker, false);
		}
		this._clearExistingSelection();
	},
	
	start: function() {
		this._currentlySelectedMarkers = [];
		this._findAllLoadedMarkers();
	},
	
	_findAllLoadedMarkers: function() {
		this._allLoadedMarkers = {};
		var fakeBounds = {contains: function() {return true;}};//TODO refactor enumerate to remove this
		this._enumerateMarkers(fakeBounds, this._map._layers, function(marker) {
			var key = L.Util.stamp(marker);
			this._allLoadedMarkers[key] = marker;
		}.bind(this));
	},
	
	update: function(latLngBounds) {
		var newlySelectedMarkers = {};
		this._enumerateMarkers(latLngBounds, this._map._layers, function(marker) {
			var key = L.Util.stamp(marker);
			newlySelectedMarkers[key] = marker;
		}.bind(this));
		var mismatches = this._outerJoinArrays(Object.keys(this._currentlySelectedMarkers), Object.keys(newlySelectedMarkers));
		var idToSelect = mismatches.in2ButNot1;
		var idToDeselect = mismatches.in1ButNot2;
		for (var i = 0; i < idToSelect.length; i++) {
			var marker = this._allLoadedMarkers[idToSelect[i]];
			this._toggleSelection(marker, true);
		}
		for (var i = 0; i < idToDeselect.length; i++) {
			//if this marker was selected in a previous run, don't de-select it now
			if (this._previouslySelectedMarkers.indexOf(idToDeselect[i]) == -1) {
				var marker = this._allLoadedMarkers[idToDeselect[i]];
				this._toggleSelection(marker, false);
			}
		}
		this._currentlySelectedMarkers = newlySelectedMarkers;
	},
	
	finish: function(bounds) {
		this._enumerateMarkers(bounds, this._map._layers, function(marker) {
			if (this._allSelectedMarkers == null) {
				this._allSelectedMarkers = {};
			}
			var key = L.Util.stamp(marker);
			this._allSelectedMarkers[key] = marker; //may already be there, but just override it
		}.bind(this));
		this._previouslySelectedMarkers = this._previouslySelectedMarkers.concat(Object.keys(this._currentlySelectedMarkers));
	},
	
	_enumerateMarkers: function(bounds, layers, callback) {
		Object.keys(layers).forEach(function (key) {
			var layer = layers[key];
			if (layer instanceof L.Marker) {
				if (bounds.contains(layer.getLatLng())) {
					callback(layer);
				}
			} else if (layer._layers != undefined) {
				this._enumerateMarkers(bounds, layer._layers, callback);
			}
		}, this);
	},
	
	_toggleSelection(marker, select) {
		if (select) {
			L.DomUtil.addClass(marker._icon, 'marker-highlight');
		} else {
			L.DomUtil.removeClass(marker._icon, 'marker-highlight');
		}
	},
	
	//both arrays must contain only numbers
	_outerJoinArrays: function (arr1, arr2) {
		function numericalSort(a, b) {
			return a - b;
		}
		arr1 = arr1.sort(numericalSort);
		arr2 = arr2.sort(numericalSort);
		var i = 0;
		var j = 0;
		var in1ButNot2 = [];
		var in2ButNot1 = [];
		while (i < arr1.length || j < arr2.length) {
			if (i == arr1.length) {
				//run out of array 1, so everything left in array 2 must be missing from 1
				in2ButNot1.push(arr2[j]); //TODO could just merge the arrays to be more efficient here
				j++;
			} else if (j == arr2.length) {
				//run out of array 2, so everything left in array 1 must be missing from 2
				in1ButNot2.push(arr1[i]); //TODO could just merge the arrays to be more efficient here
				i++;
			} else if (arr1[i] == arr2[j]) {
				//in both, move on
				i++;
				j++;
			} else if (arr1[i] < arr2[j]) {
				//must be missing from arr2
				in1ButNot2.push(arr1[i]);
				i++;
			} else {//if (arr1[i] > arr2[j]) {
				//must be missing from arr1
				in2ButNot1.push(arr2[j]);
				j++;
			}
		}
		if (i != arr1.length || j != arr2.length) {
			console.error("not all the things were consumed");
			console.error("arr1.length=" + arr1.length + ", i=" + i);
			console.error("arr2.length=" + arr2.length + ", j=" + j);
		}
		return {
			in1ButNot2: in1ButNot2,
			in2ButNot1: in2ButNot1
		};
	}
});

L.Control.BoxSelector = L.Control.extend({
	initialize: function (options) {
		L.setOptions(this, options);
		if (this.options.actions == null) {
			//set default action
			this.options.actions = {
				alert: {
					display: "Display selected coords",
					action:	L.Control.BoxSelector.Actions.Alert
				}
			}
		}
	},
	
	onAdd: function (map) {
		this._map = map;
		this._mapcontainer = map._container;
		this._pane = map._panes.overlayPane;
		this._addHooks();
		this._manager = new SelectionManager(this._map);
		
		//set up select icon
		this._selectorContainer = L.DomUtil.create('div', 'leaflet-control-box-selector leaflet-bar leaflet-control boxselector-control boxselector-hidden');
		var buttonBar = L.DomUtil.create('div', 'leaflet-bar-part leaflet-bar-part-single boxselector-button-bar', this._selectorContainer);
		this._toggleElement = L.DomUtil.create('a', 'boxselector-icon', buttonBar);
		this._toggleElement.id = 'boxselector-icon';
		this._toggleElement.href = '#';
		var iconWrapper = L.DomUtil.create('div', 'icon-wrapper', this._toggleElement);
		var icon = L.DomUtil.create('img', 'icon', iconWrapper);
		icon.src = '../src/select-icon.png';
		
		//set up dropdown icon
		var dropdownButton = L.DomUtil.create('a', 'boxselector-dropdown-button', buttonBar);
		dropdownButton.id = 'boxselector-dropdown-button';
		dropdownButton.href = '#';
		var dropdownIconWrapper = L.DomUtil.create('div', 'boxselector-dropdown-icon-wrapper', dropdownButton);
		var dropdownIcon = L.DomUtil.create('div', 'boxselector-dropdown-icon', dropdownIconWrapper);
		L.DomEvent.on(dropdownButton, 'click', this.expandCollapse, this)
		
		//set up drop down (hidden to start with)
		this._expanded = false;
		this._dropdown = L.DomUtil.create('div', 'boxselector-dropdown', this._selectorContainer);
		for (var actionId in this.options.actions) {
			var dropdownEntry = L.DomUtil.create('a', 'boxselector-dropdown-entry', this._dropdown);
			dropdownEntry.actionId = actionId;
			dropdownEntry.href = '#';
			var label = L.DomUtil.create('span', '', dropdownEntry);
			label.innerHTML = this.options.actions[actionId].display;
			label.actionId = actionId;

			L.DomEvent.on(dropdownEntry, 'click', this._actionItemClick, this);
		}
		
		L.DomEvent.on(this._toggleElement, 'click', this._toggle, this);

		//ensure we tear down		
		this._map.on('unload', this._removeHooks, this);
		
		return this._selectorContainer;
	},
	
	expandCollapse: function() {
		if (this._expanded) {
			L.DomUtil.addClass(this._selectorContainer, 'boxselector-hidden');
			L.DomUtil.removeClass(this._selectorContainer, 'boxselector-expanded');
			this._expanded = false;
		} else {
			L.DomUtil.addClass(this._selectorContainer, 'boxselector-expanded');
			L.DomUtil.removeClass(this._selectorContainer, 'boxselector-hidden');
			this._expanded = true;
		}
	},
	
	_actionItemClick: function(e) {
		var actionItemElement = e.target;
		var actionId = actionItemElement.actionId;
		var action = this.options.actions[actionId].action;
		action(this.getSelectedMarkers());
	},

	_addHooks: function () {
		L.DomEvent.on(this._mapcontainer, 'mousedown', this._onMouseDown, this);
	},

	_removeHooks: function () {
		L.DomEvent.off(this._mapcontainer, 'mousedown', this._onMouseDown, this);
	},

	_toggle: function() {
		this._setEnabled(!this._isEnabled());
		if (this._isEnabled()) {
			//enable selection
			map.dragging.disable();
			L.DomUtil.addClass(this._toggleElement, 'enabled');
			this._manager.enable();
		} else {
			//disable selection
			map.dragging.enable();
			L.DomUtil.removeClass(this._toggleElement, 'enabled');
			this._manager.disable();
		}
	},
	
	_isEnabled: function() {
		return this._selectionEnabled;
	},
	
	_setEnabled: function(enabled) {
		this._selectionEnabled = enabled;
	},

	moved: function () {
		return this._moved;
	},

	_resetState: function () {
		this._moved = false;
	},

	_onMouseDown: function (e) {
		if (!this._isEnabled() || (e.button !== 0)) {
			return false;
		}

		this._resetState();

		L.DomUtil.disableTextSelection();
		L.DomUtil.disableImageDrag();

		this._startPoint = this._map.mouseEventToContainerPoint(e);

		L.DomEvent.on(document, {
			contextmenu: L.DomEvent.stop,
			mousemove: this._onMouseMove,
			mouseup: this._onMouseUp,
			keydown: this._onKeyDown
		}, this);

		this._manager.start();
	},

	_onMouseMove: function (e) {
		if (!this._moved) {
			this._moved = true;

			this._box = L.DomUtil.create('div', 'leaflet-zoom-box', this._mapcontainer);
			L.DomUtil.addClass(this._mapcontainer, 'leaflet-crosshair');
		}

		this._point = this._map.mouseEventToContainerPoint(e);

		var bounds = new L.Bounds(this._point, this._startPoint),
		    size = bounds.getSize();

		L.DomUtil.setPosition(this._box, bounds.min);

		this._box.style.width  = size.x + 'px';
		this._box.style.height = size.y + 'px';

		var latLngBounds = new L.LatLngBounds(
			this._map.containerPointToLatLng(this._startPoint),
			this._map.containerPointToLatLng(this._point));

		this._manager.update(latLngBounds);
	},

	_finish: function () {
		if (this._moved) {
			L.DomUtil.remove(this._box);
			L.DomUtil.removeClass(this._mapcontainer, 'leaflet-crosshair');
		}

		L.DomUtil.enableTextSelection();
		L.DomUtil.enableImageDrag();

		L.DomEvent.off(document, {
			contextmenu: L.DomEvent.stop,
			mousemove: this._onMouseMove,
			mouseup: this._onMouseUp,
			keydown: this._onKeyDown
		}, this);
	},

	_onMouseUp: function (e) {
		if ((e.which !== 1) && (e.button !== 1)) { return; }

		this._finish();

		if (!this._moved) { return; }
		// Postpone to next JS tick so internal click event handling
		// still see it as "moved".
		setTimeout(L.bind(this._resetState, this), 0);

		var bounds = new L.LatLngBounds(
			this._map.containerPointToLatLng(this._startPoint),
			this._map.containerPointToLatLng(this._point));

		this._manager.finish(bounds);
	},
	
	getSelectedMarkers: function() {
		return this._manager.getSelectedMarkers();
	},

	_onKeyDown: function (e) {
		if (e.keyCode === 27) {
			this._finish();
		}
	}
});
L.Control.BoxSelector.Actions = {};
L.Control.BoxSelector.Actions.Alert = function(selectedMarkers) {
	var output = "";
	for (var i = 0; i < selectedMarkers.length; i++) {
		var marker = selectedMarkers[i];
		output += marker.name
		output += ": ";
		output += marker.getLatLng().lat;
		output += ",";
		output += marker.getLatLng().lng;
		output += "\n";
	}
	alert(output);
}
