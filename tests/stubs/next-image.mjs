import { createElement } from "react";

/** Next-only optimisation props are not HTML attributes; the rest is an <img>. */
const NEXT_PROPS = ["unoptimized", "priority", "placeholder", "blurDataURL", "quality", "loader", "fill"];

export default function Image(props) {
  const attributes = { ...props };
  for (const key of NEXT_PROPS) delete attributes[key];
  return createElement("img", attributes);
}
