/** Focus routes own the whole viewport; support returns after submission. */
export function shouldShowSupportCta(pathname: string) {
  return !pathname.startsWith("/exam/") && !pathname.startsWith("/practice/session/") && !pathname.startsWith("/admin");
}
