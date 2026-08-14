// The custom scheme Home is served from.
//
// Home used to run on an HTTP server bound to port 0, which meant a different
// origin every launch. localStorage is origin-scoped, so the saved house,
// furniture, Cozy state and actor needs were discarded on every restart. A
// fixed scheme gives Home one stable origin for the life of the app.
//
// Kept in its own module because the scheme must be registered as privileged
// before app ready, in main.mjs, and served from canonical-home.mjs.
export const HOME_SCHEME = "pocket-buddy";
