import {
	isDebug,
	makeElement,
	onClick,
	makeDraggable,
	makeClosable,
	error,
	getShadowRoot
} from './shared.js';

export const MENU_ID = "birb-menu";
export const MENU_EXIT_ID = "birb-menu-exit";

const ICONS = {
	default: [
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 0, 0, 0, 1, 0],
		[1, 0, 0, 1, 0, 0, 1],
		[1, 0, 0, 1, 0, 0, 1],
		[0, 1, 0, 0, 0, 1, 0],
		[0, 0, 1, 1, 1, 0, 0],
	],
	back: [
		[0, 0, 1, 0, 0, 0, 0],
		[0, 1, 1, 0, 0, 0, 0],
		[1, 1, 1, 1, 1, 1, 0],
		[0, 1, 1, 0, 0, 0, 0],
		[0, 0, 1, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0, 0],
	],
	home: [
		[0, 0, 0, 1, 0, 0, 0],
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 1, 1, 1, 1, 0],
		[1, 1, 0, 0, 0, 1, 1],
		[1, 1, 0, 1, 0, 1, 1],
		[1, 1, 1, 1, 1, 1, 1],
	],
	buddy: [
		[0, 1, 1, 1, 1, 1, 0],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 1, 0, 1, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[0, 1, 1, 1, 1, 1, 0],
		[0, 0, 1, 0, 0, 0, 0],
	],
	chill: [
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 1, 0, 0, 0, 0],
		[1, 1, 0, 0, 0, 0, 0],
		[1, 1, 0, 0, 0, 1, 0],
		[0, 1, 1, 0, 1, 1, 0],
		[0, 0, 1, 1, 1, 0, 0],
	],
	pets: [
		[0, 1, 0, 0, 0, 1, 0],
		[1, 1, 0, 1, 0, 1, 1],
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 1, 1, 1, 1, 0],
		[0, 1, 1, 1, 1, 1, 0],
		[0, 0, 1, 1, 1, 0, 0],
	],
	heart: [
		[0, 1, 1, 0, 1, 1, 0],
		[1, 0, 0, 1, 0, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[0, 1, 0, 0, 0, 1, 0],
		[0, 0, 1, 0, 1, 0, 0],
		[0, 0, 0, 1, 0, 0, 0],
	],
	talk: [
		[0, 1, 1, 1, 1, 1, 0],
		[1, 0, 0, 0, 0, 0, 1],
		[1, 0, 1, 0, 1, 0, 1],
		[1, 0, 0, 0, 0, 0, 1],
		[0, 1, 1, 1, 1, 1, 0],
		[0, 1, 0, 0, 0, 0, 0],
	],
	edit: [
		[0, 0, 0, 0, 1, 1, 0],
		[0, 0, 0, 1, 1, 0, 0],
		[0, 0, 1, 1, 0, 0, 0],
		[0, 1, 1, 0, 0, 0, 0],
		[1, 1, 0, 0, 0, 0, 0],
		[1, 0, 0, 0, 0, 0, 0],
	],
	scale: [
		[0, 0, 1, 0, 1, 0, 0],
		[0, 0, 1, 1, 1, 0, 0],
		[1, 1, 1, 1, 1, 1, 1],
		[0, 0, 1, 1, 1, 0, 0],
		[0, 0, 1, 0, 1, 0, 0],
		[0, 0, 0, 0, 0, 0, 0],
	],
	sound: [
		[0, 0, 1, 1, 0, 0, 0],
		[0, 1, 1, 1, 0, 1, 0],
		[1, 1, 1, 1, 0, 0, 1],
		[1, 1, 1, 1, 0, 0, 1],
		[0, 1, 1, 1, 0, 1, 0],
		[0, 0, 1, 1, 0, 0, 0],
	],
	theme: [
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 0, 1, 0, 1, 0],
		[1, 0, 1, 1, 1, 0, 1],
		[1, 0, 1, 1, 1, 0, 1],
		[0, 1, 0, 1, 0, 1, 0],
		[0, 0, 1, 1, 1, 0, 0],
	],
	info: [
		[0, 0, 1, 1, 1, 0, 0],
		[0, 1, 0, 0, 0, 1, 0],
		[0, 0, 0, 1, 0, 0, 0],
		[0, 0, 0, 1, 0, 0, 0],
		[0, 0, 0, 1, 0, 0, 0],
		[0, 1, 1, 1, 1, 1, 0],
	],
};

function fallbackIconForLabel(label) {
	const text = String(label || "").trim().toLowerCase();
	if (text.includes("go back") || text === "back") return ICONS.back;
	if (text.includes("home")) return ICONS.home;
	if (text.includes("chill")) return ICONS.chill;
	if (text.includes("my pets") || text.includes("pet library")) return ICONS.pets;
	if (text === "buddy" || text.includes("status")) return ICONS.buddy;
	if (text.includes("talk") || text.includes("chat")) return ICONS.talk;
	if (text.includes("care") || text.includes("pet buddy")) return ICONS.heart;
	if (text.includes("rename")) return ICONS.edit;
	if (text.includes("scale")) return ICONS.scale;
	if (text.includes("sound")) return ICONS.sound;
	if (text.includes("theme")) return ICONS.theme;
	if (text.includes("build") || text.includes("source")) return ICONS.info;
	return ICONS.default;
}

function createIconCanvas(icon) {
	const iconCanvas = document.createElement("canvas");
	iconCanvas.width = 7;
	iconCanvas.height = 6;
	iconCanvas.classList.add("birb-menu-item-icon");
	const ctx = iconCanvas.getContext("2d");
	if (ctx) {
		for (let row = 0; row < icon.length; row++) {
			for (let col = 0; col < icon[row].length; col++) {
				if (icon[row][col]) {
					ctx.fillStyle = "black";
					ctx.fillRect(col, row, 1, 1);
				}
			}
		}
	}
	return iconCanvas;
}

function ensureMenuItemIcon(menuItem) {
	if (!(menuItem instanceof HTMLElement) || menuItem.querySelector(":scope > .birb-menu-item-icon")) return;
	menuItem.prepend(createIconCanvas(fallbackIconForLabel(menuItem.textContent)));
}

function ensureMenuIcons(content) {
	content.querySelectorAll(":scope > .birb-menu-item").forEach(ensureMenuItemIcon);
}

export class MenuItem {
	/**
	 * @param {string|(() => string)} text
	 * @param {() => void} action
	 * @param {number[][]} [icon]
	 * @param {boolean} [removeMenu]
	 */
	constructor(text, action, icon, removeMenu = true) {
		this.text = text;
		this.action = action;
		this.icon = icon;
		this.removeMenu = removeMenu;
	}
}

export class SpinnerMenuItem extends MenuItem {
	/**
	 * @param {string|(() => string)} text
	 * @param {() => void} labelAction
	 * @param {() => void} leftAction
	 * @param {() => void} rightAction
	 */
	constructor(text, labelAction, leftAction, rightAction) {
		super(text, labelAction, undefined, false);
		this.leftAction = leftAction;
		this.rightAction = rightAction;
	}
}

export class ConditionalMenuItem extends MenuItem {
	/**
	 * @param {string} text
	 * @param {() => void} action
	 * @param {() => boolean} condition
	 * @param {number[][]} [icon]
	 * @param {boolean} [removeMenu]
	 */
	constructor(text, action, condition, icon, removeMenu = true) {
		super(text, action, icon, removeMenu);
		this.condition = condition;
	}
}

export class DebugMenuItem extends ConditionalMenuItem {
	/**
	 * @param {string} text
	 * @param {() => void} action
	 */
	constructor(text, action, removeMenu = true) {
		super(text, action, () => isDebug(), undefined, removeMenu);
	}
}

export class Separator extends MenuItem {
	constructor() {
		super("", () => { });
	}
}

/**
 * @param {MenuItem} item
 * @param {() => void} removeMenuCallback
 * @returns {HTMLElement}
 */
function createMenuItem(item, removeMenuCallback) {
	if (item instanceof Separator) {
		return makeElement("birb-window-separator");
	}
	const label = typeof item.text === "function" ? item.text() : item.text;
	let menuItem = makeElement("birb-menu-item", label);
	menuItem.prepend(createIconCanvas(item.icon || fallbackIconForLabel(label)));
	if (item instanceof SpinnerMenuItem) {
		menuItem.classList.add("birb-menu-item-spinner");
		const container = makeElement("birb-menu-item-spinner-container");
		// Prevent accidental resets
		onClick(container, (e) => e.stopPropagation());
		menuItem.appendChild(container);
		const leftButton = makeElement("birb-spinner-button", "-");
		leftButton.classList.add("birb-spinner-button-negative");
		const rightButton = makeElement("birb-spinner-button", "+");
		rightButton.classList.add("birb-spinner-button-positive");
		onClick(leftButton, (e) => {
			item.leftAction();
			e.stopPropagation();
		});
		onClick(rightButton, (e) => {
			item.rightAction();
			e.stopPropagation();
		});
		container.appendChild(leftButton);
		container.appendChild(rightButton);
	}
	onClick(menuItem, () => {
		if (item.removeMenu) {
			removeMenuCallback();
		}
		item.action();
	});
	return menuItem;
}

function appendMenuItems(content, menuItems, removeCallback) {
	for (const item of menuItems) {
		if (!(item instanceof ConditionalMenuItem) || item.condition()) {
			content.appendChild(createMenuItem(item, removeCallback));
		}
	}
	ensureMenuIcons(content);
}

function resetExtensionMenuState(menu) {
	for (const key of Object.keys(menu.dataset)) {
		if (key.startsWith("pocketBuddy")) {
			delete menu.dataset[key];
		}
	}
}

/**
 * Add the menu to the page if it doesn't already exist
 * @param {MenuItem[]} menuItems
 * @param {string} title
 * @param {(menu: HTMLElement) => void} updateLocationCallback
 * @param {() => void} [titleClickCallback]
 */
export function insertMenu(menuItems, title, updateLocationCallback, titleClickCallback) {
	if (getShadowRoot().querySelector("#" + MENU_ID)) {
		return;
	}
	let menu = makeElement("birb-window", undefined, MENU_ID);
	let header = makeElement("birb-window-header");
	const titleDiv = makeElement("birb-window-title", title);
	header.appendChild(titleDiv);
	let content = makeElement("birb-window-content");
	const removeCallback = () => removeMenu();
	if (titleClickCallback) {
		onClick(titleDiv, () => {
			removeCallback();
			titleClickCallback();
		});
		titleDiv.classList.add("birb-window-title-clickable");
	}
	appendMenuItems(content, menuItems, removeCallback);
	menu.appendChild(header);
	menu.appendChild(content);
	getShadowRoot().appendChild(menu);
	makeDraggable(getShadowRoot().querySelector(".birb-window-header"));

	// Pocket Buddy augments the original Pocket Bird menu after it is inserted.
	// Keep icon slots stable even when an extension layer replaces or relabels rows.
	const iconObserver = new MutationObserver(() => ensureMenuIcons(content));
	iconObserver.observe(content, { childList: true, subtree: true, characterData: true });

	let menuExit = makeElement("birb-window-exit", undefined, MENU_EXIT_ID);
	onClick(menuExit, removeCallback);
	getShadowRoot().appendChild(menuExit);
	makeClosable(removeCallback);

	updateLocationCallback(menu);
}

/**
 * Remove the menu from the page
 */
export function removeMenu() {
	const menu = getShadowRoot().querySelector("#" + MENU_ID);
	if (menu) {
		menu.remove();
	}
	const exitMenu = getShadowRoot().querySelector("#" + MENU_EXIT_ID);
	if (exitMenu) {
		exitMenu.remove();
	}
}

/**
 * @returns {boolean} Whether the menu element is on the page
 */
export function isMenuOpen() {
	return getShadowRoot().querySelector("#" + MENU_ID) !== null;
}

/**
 * @param {MenuItem[]} menuItems
 * @param {(menu: HTMLElement) => void} updateLocationCallback
 */
export function switchMenuItems(menuItems, updateLocationCallback) {
	const menu = getShadowRoot().querySelector("#" + MENU_ID);
	if (!menu || !(menu instanceof HTMLElement)) {
		return;
	}
	const content = menu.querySelector(".birb-window-content");
	if (!content) {
		error("Birb: Content not found");
		return;
	}

	// Menu extensions mark which view they have augmented. The original Settings
	// implementation swaps children in place, so stale markers would otherwise
	// make the extension think the rebuilt menu was already upgraded.
	resetExtensionMenuState(menu);
	content.replaceChildren();
	const removeCallback = () => removeMenu();
	appendMenuItems(content, menuItems, removeCallback);
	menu.dispatchEvent(new CustomEvent("birb-menu-items-changed", { bubbles: true }));
	updateLocationCallback(menu);
}
