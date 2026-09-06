/** Keep running time monotonic even when the device's wall clock moves backwards. */
export class SessionClock {
  private origin: number;
  private monotonic: number;
  private wall: number;
  private last: number;
  constructor(serverTime: number, private monotonicNow = () => performance.now(), private wallNow = () => Date.now()) {
    this.origin = this.last = serverTime; this.monotonic = monotonicNow(); this.wall = wallNow();
  }
  now() {
    this.last = Math.max(this.last, this.origin + Math.max(0, this.monotonicNow() - this.monotonic, this.wallNow() - this.wall));
    return this.last;
  }
  sync(serverTime: number) {
    // Server calibration may correct a device clock that jumped forward.
    this.origin = this.last = serverTime; this.monotonic = this.monotonicNow(); this.wall = this.wallNow();
  }
}
export const resumedTime = (serverTime: number, savedWall: number, wall = Date.now()) => serverTime + Math.max(0, wall - savedWall);
