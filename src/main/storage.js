'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeSave, defaultSave } = require('../core/save-schema');

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
    }
  }
}

class Storage {
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'save.json');
    this.bak = path.join(dir, 'save.json.bak');
    this.tmp = path.join(dir, 'save.json.tmp');
    this.log = opts.log || (() => {});
    this.mainIsGood = false;
    this.lastError = null;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  static parse(text) {
    const t = text.length && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return JSON.parse(t);
  }

  load(nowMs = Date.now()) {
    const attempts = [
      ['main', this.file],
      ['backup', this.bak],
    ];
    let recovered = false;
    for (const [name, f] of attempts) {
      try {
        const raw = Storage.parse(fs.readFileSync(f, 'utf8'));
        if (name === 'main') this.mainIsGood = true;
        return { save: normalizeSave(raw, nowMs), source: name, fresh: false, recovered };
      } catch (e) {
        if (e.code !== 'ENOENT') {
          recovered = true;
          this.log(`load: ${name} unreadable (${e.message}); trying next`);
          if (name === 'main') {
            try {
              fs.copyFileSync(f, `${f}.corrupt-${nowMs}`);
            } catch {
            }
          }
        }
      }
    }
    return { save: defaultSave(nowMs), source: null, fresh: !recovered, recovered };
  }

  save(data) {
    this.ensureDir();
    const json = JSON.stringify(data, null, 2);
    const fd = fs.openSync(this.tmp, 'w');
    try {
      fs.writeSync(fd, json, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (this.mainIsGood && fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.bak);
      } catch (e) {
        this.log(`save: backup copy failed (${e.message})`);
      }
    }
    this.replace(this.tmp, this.file);
    this.mainIsGood = true;
    this.lastError = null;
  }

  replace(src, dst) {
    for (let i = 0; i < 6; i++) {
      try {
        fs.renameSync(src, dst);
        return;
      } catch (e) {
        const retry = process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code);
        if (!retry) throw e;
        sleepSync(15 * (i + 1));
      }
    }
    fs.writeFileSync(dst, fs.readFileSync(src));
    try {
      fs.unlinkSync(src);
    } catch {
    }
  }

  trySave(data) {
    try {
      this.save(data);
      return true;
    } catch (e) {
      this.lastError = e;
      this.log(`save failed: ${e.message}`);
      return false;
    }
  }
}

module.exports = { Storage };
