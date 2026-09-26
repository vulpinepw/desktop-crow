'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

function launchCommand() {
  const exe = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  if (process.env.APPIMAGE && /appimage_extracted_/.test(process.execPath)) args.unshift('--appimage-extract-and-run');
  return { exe, args: args.concat(['--autostart']) };
}

const WIN_RUN_NAME = 'DesktopCrow';

function linuxAutostartFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', 'desktop-crow.desktop');
}

function desktopQuote(s) {
  return `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;
}

function setAutostart(enabled) {
  const { exe, args } = launchCommand();
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: exe, args, name: WIN_RUN_NAME });
    return true;
  }
  if (process.platform === 'linux') {
    const file = linuxAutostartFile();
    if (enabled) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const exec = [exe].concat(args).map(desktopQuote).join(' ');
      const body = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Desktop Crow',
        'Comment=A crow that lives on your desktop',
        `Exec=${exec}`,
        'Icon=desktop-crow',
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n');
      fs.writeFileSync(file, body, 'utf8');
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return true;
  }
  return false;
}

function getAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    const { exe, args } = launchCommand();
    return !!app.getLoginItemSettings({ path: exe, args }).openAtLogin;
  }
  if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile());
  return false;
}

module.exports = { setAutostart, getAutostart, desktopQuote, linuxAutostartFile, WIN_RUN_NAME };
