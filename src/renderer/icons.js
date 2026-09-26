'use strict';

const PATHS = Object.freeze({
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  gift: ['M3 8h18v4H3z', 'M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8', 'M12 8v13', 'M12 8c-1.2-3.6-5.6-4.6-6.3-2.2C5.1 7.8 8.4 8 12 8Z', 'M12 8c1.2-3.6 5.6-4.6 6.3-2.2C18.9 7.8 15.6 8 12 8Z'],
  calendar: ['M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z', 'M8 3v4', 'M16 3v4', 'M4 11h16'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  feather: ['M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z', 'M16 8 2 22', 'M17.5 15H9'],
  gem: ['M6 3h12l4 6-10 12L2 9Z', 'M2 9h20', 'M12 21 8.5 9 11 3', 'M12 21l3.5-12L13 3'],
  crown: ['M3 7.5 7.5 12 12 5l4.5 7L21 7.5 19 18H5Z', 'M5 21h14'],
  sparkle: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z', 'M19 3v4', 'M21 5h-4', 'M5 17v3', 'M6.5 18.5h-3'],
  grid: ['M4 5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z', 'M13 5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Z', 'M4 14a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z', 'M13 14a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1Z'],
  seed: ['M12 3c3.9 2.8 6 6.6 6 10a6 6 0 0 1-12 0c0-3.4 2.1-7.2 6-10Z', 'M12 10v6', 'M9.5 13.5 12 16l2.5-2.5'],
  hand: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V12', 'M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5', 'M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13', 'M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a7 7 0 0 1-5.3-2.4L3.6 15a1.6 1.6 0 0 1 2.4-2.1L8 15'],
  bowl: ['M3 11h18c0 5-4 9-9 9s-9-4-9-9Z', 'M8.5 7.5c0-1.5 1-2 1-3.5', 'M12.5 7.5c0-1.5 1-2 1-3.5'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  zap: ['M13 2 4 14h7l-1 8 9-12h-7Z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  lock: ['M6 11h12v10H6z', 'M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11'],
  power: ['M12 2.5v9', 'M18.4 6.6a9 9 0 1 1-12.8 0'],
  volume: ['M11 5 6 9H2v6h4l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  pointer: ['M4.5 3.5 11 20l2.4-6.6L20 11Z'],
  window: ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'M3 9h18'],
  monitor: ['M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z', 'M8 20h8', 'M12 16v4'],
  pulse: ['M22 12h-4l-3 8L9 4l-3 8H2'],
  cookie: ['M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5', 'M8.5 8.5h.01', 'M16 15.5h.01', 'M12 12h.01', 'M11 17h.01', 'M7 14h.01'],
  rose: ['M12 13a4 4 0 0 0 4-4c0-2-1.5-3.5-4-5-2.5 1.5-4 3-4 5a4 4 0 0 0 4 4Z', 'M12 13v8', 'M12 17c-2.5 0-4-1.5-4.5-3.5', 'M12 18.5c2 0 3.4-1.2 4-3'],
  music: ['M9 18V5l12-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  smile: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
  rain: ['M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2', 'M16 14v6', 'M8 14v6', 'M12 16v6'],
  box: ['M21 8 12 3 3 8v8l9 5 9-5Z', 'M3 8l9 5 9-5', 'M12 13v8'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
});

function icon(name, size = 18) {
  const paths = PATHS[name] || PATHS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

module.exports = { icon, ICONS: Object.keys(PATHS) };
