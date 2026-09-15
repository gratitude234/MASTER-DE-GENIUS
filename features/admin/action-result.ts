export type AdminActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string };

export function actionOk<T = undefined>(message: string, data?: T): AdminActionResult<T> {
  return { ok: true, message, data };
}

export function actionFail(error: string): AdminActionResult<never> {
  return { ok: false, error };
}
