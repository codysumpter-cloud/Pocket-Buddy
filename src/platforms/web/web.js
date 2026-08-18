import { initializeApplication } from "../../application.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";
import { installContextualBuddyAssist } from "../../buddy/assist.js";
import { PrismtekWebContext, installPrismtekWebRuntimeGuards } from "./prismtek-web-runtime.js";

// Install the website observers before the Buddy layer starts so original menu
// actions can be preserved before the lean Buddy menu rearranges them.
installPrismtekWebRuntimeGuards();
initializeApplication(new PrismtekWebContext());
initializeBuddyLayer()
  .then((api) => installContextualBuddyAssist(api))
  .catch((error) => console.error("Pocket Buddy core failed to start", error));
