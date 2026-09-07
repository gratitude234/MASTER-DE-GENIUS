import { createElement } from "react";

/** Router hints that are not HTML attributes and must not be serialised. */
const ROUTER_PROPS = ["children", "scroll", "prefetch", "replace", "shallow"];

/**
 * next/link reaches into the Next.js client runtime, which a plain Node render
 * has no router for. For markup assertions a Link is just its anchor.
 */
export default function Link(props) {
  const attributes = { ...props };
  for (const key of ROUTER_PROPS) delete attributes[key];
  return createElement("a", attributes, props.children);
}
