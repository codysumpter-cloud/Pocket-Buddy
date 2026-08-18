import { initializeApplication } from "../../application.js";
import { LocalContext } from "../../context.js";
import { initializeBuddyLayer } from "../../buddy/layer.js";
import { installContextualBuddyAssist } from "../../buddy/assist.js";

initializeApplication(new LocalContext());
initializeBuddyLayer()
  .then((api) => installContextualBuddyAssist(api))
  .catch((error) => console.error("Pocket Buddy core failed to start", error));
