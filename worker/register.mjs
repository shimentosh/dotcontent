/**
 * What `node --import` loads before the worker starts.
 *
 * Separate from the hook itself because a resolve hook runs on its own thread
 * and cannot register itself; this is the two lines that live on the main one.
 */
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
