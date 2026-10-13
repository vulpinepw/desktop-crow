'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, pickMusic, parseDbusMetadata, parseDbusNames, parseDbusStatus } = require('../src/main/media');

const src = (s) => {
  const m = classify(Object.assign({ playing: true }, s));
  return m ? m.source : null;
};

test('music apps are music whenever they play', () => {
  assert.equal(src({ app: 'Spotify.exe', title: 'Song', artist: 'Band' }), 'Spotify');
  assert.equal(src({ app: 'Deezer.Desktop', title: 'Song' }), 'Deezer');
  assert.equal(src({ app: 'AppleInc.AppleMusicWin_nzyj5cx40ttqa!App' }), 'Apple Music');
  assert.equal(src({ app: 'spotify' }), 'Spotify');
  assert.equal(src({ app: 'ytmdesktop' }), 'YouTube Music');
  assert.equal(src({ app: 'foobar2000.exe' }), 'Foobar2000');
  assert.equal(classify({ app: 'Spotify.exe', playing: false }), null, 'paused is not playing');
});

test('in a browser: music players and music videos count, other videos do not', () => {
  assert.equal(src({ app: 'chrome', title: 'Song', artist: 'Band', album: 'Album' }), 'your browser');
  assert.equal(src({ app: 'MSEdge', title: 'Song - YouTube Music' }), 'YouTube Music');
  assert.equal(src({ app: '308046B0AF4A39CB', title: 'Song', album: 'Album' }), 'your browser');
  assert.equal(src({ app: 'chrome', title: 'Artist - Song (Official Music Video)', artist: 'ArtistVEVO' }), 'YouTube');
  assert.equal(src({ app: 'chrome', title: 'Song', artist: 'Artist - Topic' }), 'YouTube');
  assert.equal(src({ app: 'chrome', title: 'Song ft. Someone (Lyrics)', artist: 'Some channel' }), 'YouTube');
  assert.equal(src({ app: 'chrome', title: 'How to cook pasta in 10 minutes', artist: 'Kitchen channel' }), null);
  assert.equal(src({ app: 'firefox.instance_1_23', title: 'Song', url: 'https://music.youtube.com/watch?v=x' }), 'YouTube Music');
  assert.equal(src({ app: 'chromium.instance42', title: 'Song', url: 'https://open.spotify.com/track/1' }), 'Spotify');
  assert.equal(src({ app: 'vlc.exe', title: 'Film', type: 2 }), null);
  assert.equal(src({ app: 'Microsoft.ZuneMusic', title: 'Song', type: 1 }), 'Media Player');
});

test('the first playing music session wins', () => {
  const m = pickMusic([
    { app: 'chrome', playing: true, title: 'A lecture about maths' },
    { app: 'Spotify.exe', playing: false },
    { app: 'Deezer.Desktop', playing: true, title: 'Tune', artist: 'Player' },
  ]);
  assert.deepEqual(m, { playing: true, source: 'Deezer', title: 'Tune', artist: 'Player' });
  assert.equal(pickMusic([]), null);
  assert.equal(pickMusic(null), null);
});

test('Linux: MPRIS replies from dbus-send are parsed', () => {
  const names = `method return time=1 sender=org.freedesktop.DBus -> destination=:1.9 serial=3 reply_serial=2
   array [
      string "org.freedesktop.DBus"
      string "org.mpris.MediaPlayer2.spotify"
      string ":1.7"
      string "org.mpris.MediaPlayer2.firefox.instance_1_23"
   ]`;
  assert.deepEqual(parseDbusNames(names), ['org.mpris.MediaPlayer2.spotify', 'org.mpris.MediaPlayer2.firefox.instance_1_23']);
  assert.equal(parseDbusStatus('method return\n   variant       string "Playing"'), 'Playing');
  assert.equal(parseDbusStatus('method return\n   variant       string "Paused"'), 'Paused');
  const md = `method return time=1 sender=:1.123 -> destination=:1.456 serial=12 reply_serial=2
   variant       array [
         dict entry(
            string "mpris:trackid"
            variant                object path "/org/mpris/MediaPlayer2/firefox"
         )
         dict entry(
            string "xesam:title"
            variant                string "Song \\"Live\\""
         )
         dict entry(
            string "xesam:album"
            variant                string "An Album"
         )
         dict entry(
            string "xesam:artist"
            variant                array [
                  string "The Band"
               ]
         )
         dict entry(
            string "xesam:url"
            variant                string "https://music.youtube.com/watch?v=x"
         )
      ]`;
  assert.deepEqual(parseDbusMetadata(md), { title: 'Song "Live"', artist: 'The Band', album: 'An Album', url: 'https://music.youtube.com/watch?v=x' });
});
