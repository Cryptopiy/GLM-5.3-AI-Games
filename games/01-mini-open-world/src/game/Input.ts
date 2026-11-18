/** Raw keyboard input tracked on the window. No focusable DOM elements are
 *  used, so UI interactions never steal game keys. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      e.code.startsWith('Arrow') ||
      e.code === 'Space' ||
      e.code === 'Tab'
    ) {
      e.preventDefault();
    }
    if (!e.repeat) this.pressedThisFrame.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onBlur = () => {
    this.down.clear();
  };

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True only on the frame the key went down. */
  pressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressedThisFrame.has(c));
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
