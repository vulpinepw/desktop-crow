'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');

const MUSIC_APPS = [
  [/spotify/i, 'Spotify'],
  [/deezer/i, 'Deezer'],
  [/tidal/i, 'TIDAL'],
  [/applemusic|apple\.music|itunes/i, 'Apple Music'],
  [/amazon.?music/i, 'Amazon Music'],
  [/soundcloud/i, 'SoundCloud'],
  [/qobuz/i, 'Qobuz'],
  [/youtube.?music|ytmdesktop|youtube-music/i, 'YouTube Music'],
  [/pandora/i, 'Pandora'],
  [/zunemusic|groove/i, 'Media Player'],
  [/musicbee|foobar|aimp|winamp|clementine|strawberry|rhythmbox|lollypop|elisa|amarok|audacious|quodlibet|ncspot|cmus|mpd|tauon|nuclear|cider/i, null],
];
const BROWSERS = /chrome|chromium|msedge|edge|firefox|308046b0af4a39cb|opera|brave|vivaldi|yandex|librewolf|waterfox|floorp|arc\b|zen/i;
const MUSIC_SITES = [
  [/music\.youtube\.com/i, 'YouTube Music'],
  [/open\.spotify\.com/i, 'Spotify'],
  [/deezer\.com/i, 'Deezer'],
  [/soundcloud\.com/i, 'SoundCloud'],
  [/music\.apple\.com/i, 'Apple Music'],
  [/tidal\.com/i, 'TIDAL'],
  [/music\.amazon/i, 'Amazon Music'],
  [/bandcamp\.com/i, 'Bandcamp'],
  [/qobuz\.com/i, 'Qobuz'],
];
const MUSICY = /official\s+(music\s+)?(video|audio)|\blyrics?\b|lyric\s+video|\bft\.|\bfeat\.|\bremix\b|\(audio\)|music\s+video|\bvisuali[sz]er\b|\blive\s+(at|from|session)\b|\bacoustic\b|\bslowed\b|\bsped\s+up\b|\bnightcore\b|\bOST\b|\bsoundtrack\b|\bplaylist\b|\bmixtape\b|\bconcert\b|\bprod\.|\bcover\b/i;

function appLabel(app) {
  const base = String(app || '').split(/[\\/!]/).pop().replace(/\.exe$/i, '').replace(/^org\.mpris\.MediaPlayer2\./, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'a music app';
}

function classify(s) {
  if (!s || !s.playing) return null;
  const app = String(s.app || '');
  const title = String(s.title || '').trim();
  const artist = String(s.artist || '').trim();
  const album = String(s.album || '').trim();
  const url = String(s.url || '');
  const out = (source) => ({ playing: true, source, title: title || null, artist: artist || null });
  for (const [re, name] of MUSIC_SITES) if (re.test(url)) return out(name);
  for (const [re, name] of MUSIC_APPS) if (re.test(app)) return out(name || appLabel(app));
  if (BROWSERS.test(app) || !app) {
    if (/youtube music/i.test(`${title} ${album}`)) return out('YouTube Music');
    if (album) return out('your browser');
    if (/\s-\s*topic$/i.test(artist) || /vevo/i.test(artist) || MUSICY.test(title)) return out('YouTube');
    return null;
  }
  if (s.type === 1) return out(appLabel(app));
  return null;
}

function pickMusic(sessions) {
  if (!Array.isArray(sessions)) return null;
  for (const s of sessions) {
    const m = classify(s);
    if (m) return m;
  }
  return null;
}

function unescapeDbus(s) {
  return s.replace(/\\(.)/g, '$1');
}

function parseDbusMetadata(text) {
  const str = (key) => {
    const m = new RegExp(`string "${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+variant\\s+string "((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    return m ? unescapeDbus(m[1]) : '';
  };
  const arr = (key) => {
    const m = new RegExp(`string "${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+variant\\s+array \\[\\s+string "((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    return m ? unescapeDbus(m[1]) : '';
  };
  return { title: str('xesam:title'), artist: arr('xesam:artist') || str('xesam:artist'), album: str('xesam:album'), url: str('xesam:url') };
}

function parseDbusNames(text) {
  const out = [];
  const re = /string "(org\.mpris\.MediaPlayer2\.[^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function parseDbusStatus(text) {
  const m = /string "(Playing|Paused|Stopped)"/.exec(text);
  return m ? m[1] : null;
}

function same(a, b) {
  if (!a || !b) return a === b;
  return a.source === b.source && a.title === b.title && a.artist === b.artist;
}

class MediaWatcher {
  constructor(opts = {}) {
    this.onChange = opts.onChange || (() => {});
    this.diag = opts.diag || (() => {});
    this.script = opts.script;
    this.interval = opts.interval || 4;
    this.current = null;
    this.proc = null;
    this.timer = null;
    this.running = false;
    this.failures = 0;
    this.gaveUp = false;
  }

  set(m) {
    if (same(m, this.current)) return;
    this.current = m;
    this.onChange(m);
  }

  start() {
    if (this.running || this.gaveUp) return;
    this.running = true;
    if (process.platform === 'win32') this.startWindows();
    else if (process.platform === 'linux') this.pollLinux();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
      }
    }
    this.proc = null;
    this.set(null);
  }

  startWindows() {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let proc;
    try {
      proc = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', this.script, '-ParentId', String(process.pid), '-Interval', String(this.interval)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      this.diag(`media watcher could not start: ${e.message}`);
      this.gaveUp = true;
      this.running = false;
      return;
    }
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let data = null;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }
        if (data && data.error === 'unavailable') {
          this.gaveUp = true;
          this.diag('media sessions unavailable on this system');
          continue;
        }
        if (Array.isArray(data)) {
          this.failures = 0;
          this.set(pickMusic(data));
        }
      }
    });
    proc.on('error', (e) => this.diag(`media watcher error: ${e.message}`));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.set(null);
      if (!this.running || this.gaveUp) return;
      this.failures++;
      if (this.failures > 5) {
        this.gaveUp = true;
        this.diag(`media watcher stopped after ${this.failures} failures (exit ${code})`);
        return;
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.running) this.startWindows();
      }, 30000 * this.failures);
    });
  }

  dbus(args) {
    return new Promise((resolve) => {
      execFile('dbus-send', ['--session', '--print-reply', ...args], { timeout: 1500 }, (err, stdout) => resolve(err ? null : stdout));
    });
  }

  async readLinux() {
    const names = await this.dbus(['--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.ListNames']);
    if (names == null) return null;
    const sessions = [];
    for (const name of parseDbusNames(names).slice(0, 8)) {
      const st = await this.dbus([`--dest=${name}`, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties.Get', 'string:org.mpris.MediaPlayer2.Player', 'string:PlaybackStatus']);
      if (parseDbusStatus(st || '') !== 'Playing') continue;
      const md = await this.dbus([`--dest=${name}`, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties.Get', 'string:org.mpris.MediaPlayer2.Player', 'string:Metadata']);
      sessions.push(Object.assign({ app: name.replace(/^org\.mpris\.MediaPlayer2\./, ''), playing: true }, parseDbusMetadata(md || '')));
    }
    return sessions;
  }

  pollLinux() {
    if (!this.running) return;
    this.readLinux()
      .then((sessions) => {
        if (sessions == null) {
          this.failures++;
          if (this.failures > 5) {
            this.gaveUp = true;
            this.running = false;
            this.diag('dbus-send unavailable: music detection off');
            return;
          }
        } else {
          this.failures = 0;
          this.set(pickMusic(sessions));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.running) this.timer = setTimeout(() => this.pollLinux(), this.interval * 1000);
      });
  }
}

module.exports = { MediaWatcher, classify, pickMusic, parseDbusMetadata, parseDbusNames, parseDbusStatus };
