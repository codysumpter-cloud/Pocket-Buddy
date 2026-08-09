const { Plugin, Notice } = require('obsidian');
module.exports = class PocketBird extends Plugin {
	onload() {
		console.log("Loading Pocket Buddy...");
		const OBSIDIAN_PLUGIN = this;
		__CODE__
		console.log("Pocket Buddy loaded!");
	}

	onunload() {
		// Remove the Buddy when the plugin is unloaded.
		document.getElementById('birb')?.remove();
		console.log('Pocket Buddy unloaded!');
	}
};