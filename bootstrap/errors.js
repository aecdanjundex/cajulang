  class CajuError extends Error {
    constructor(stage, msg, line, col) { super(msg); this.stage = stage; this.line = line; this.col = col; }
  }
  class Stopped extends Error {}

