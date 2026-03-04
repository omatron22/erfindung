let audioCtx: AudioContext | null = null;

// --- Master volume (0-100, persisted) ---
let _masterVolume = 80;
try {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("catan-volume") : null;
  if (stored !== null) _masterVolume = Math.max(0, Math.min(100, Number(stored)));
} catch {}

export function getMasterVolume(): number { return _masterVolume; }
export function setMasterVolume(v: number) {
  _masterVolume = Math.max(0, Math.min(100, v));
  try { localStorage.setItem("catan-volume", String(_masterVolume)); } catch {}
}

// --- SFX mute (persisted) ---
let _sfxMuted = false;
try {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("catan-sfx-muted") : null;
  if (stored === "true") _sfxMuted = true;
} catch {}

export function isSfxMuted(): boolean { return _sfxMuted; }
export function setSfxMuted(m: boolean) {
  _sfxMuted = m;
  try { localStorage.setItem("catan-sfx-muted", String(m)); } catch {}
}

// --- Background music ---
let _bgMusic: HTMLAudioElement | null = null;
let _musicMuted = false;
let _musicVolume = 0.3;
try {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem("catan-music-muted") : null;
  if (stored === "true") _musicMuted = true;
} catch {}

export function isMusicMuted(): boolean { return _musicMuted; }
export function setMusicMuted(m: boolean) {
  _musicMuted = m;
  try { localStorage.setItem("catan-music-muted", String(m)); } catch {}
  if (_bgMusic) {
    _bgMusic.muted = m;
  }
}

export function startMusic() {
  if (_bgMusic) {
    // Audio element exists but may not be playing (autoplay blocked) — retry
    if (_bgMusic.paused && !_musicMuted) {
      _bgMusic.play().catch(() => {});
    }
    return;
  }
  const audio = new Audio("/music/gabemar.m4a");
  audio.loop = true;
  audio.volume = _musicVolume * (_masterVolume / 100);
  audio.muted = _musicMuted;
  audio.play().catch(() => {}); // autoplay may be blocked, that's ok
  _bgMusic = audio;
}

export function stopMusic() {
  if (!_bgMusic) return;
  _bgMusic.pause();
  _bgMusic.currentTime = 0;
  _bgMusic = null;
}

export function updateMusicVolume() {
  if (_bgMusic) {
    _bgMusic.volume = _musicVolume * (_masterVolume / 100);
  }
}

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Helper: play a square wave note (classic 8-bit sound) */
function playSquareNote(freq: number, startTime: number, duration: number, volume = 0.08) {
  if (_masterVolume === 0 || _sfxMuted) return;
  const ctx = getContext();
  const vol = volume * (_masterVolume / 100);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, startTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Dice rattle — fast descending noise burst (8-bit style) */
export function playDiceRoll() {
  const ctx = getContext();
  const t = ctx.currentTime;
  // Rapid square wave clicks descending
  for (let i = 0; i < 6; i++) {
    playSquareNote(800 - i * 80, t + i * 0.04, 0.03, 0.06);
  }
  // Final two landing tones
  playSquareNote(440, t + 0.28, 0.08, 0.1);
  playSquareNote(660, t + 0.35, 0.1, 0.1);
}

/** Build — two rising 8-bit dings */
export function playBuild() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(523, t, 0.1, 0.1);        // C5
  playSquareNote(784, t + 0.1, 0.15, 0.1); // G5
}

/** Trade — quick ascending arpeggio */
export function playTrade() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(392, t, 0.08, 0.07);       // G4
  playSquareNote(523, t + 0.08, 0.08, 0.07); // C5
  playSquareNote(659, t + 0.16, 0.12, 0.07); // E5
}

/** Turn notification — gentle rising bell */
export function playTurnNotification() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(440, t, 0.12, 0.06);       // A4
  playSquareNote(554, t + 0.12, 0.12, 0.06); // C#5
  playSquareNote(659, t + 0.24, 0.2, 0.08); // E5
}

/** Robber move — ominous low descending tone */
export function playRobber() {
  if (_masterVolume === 0 || _sfxMuted) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  const vol = 0.1 * (_masterVolume / 100);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.35);
}

/** Steal — quick descending snatch */
export function playSteal() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(880, t, 0.05, 0.08);
  playSquareNote(660, t + 0.05, 0.05, 0.08);
  playSquareNote(440, t + 0.1, 0.1, 0.08);
}

/** End turn — soft click */
export function playEndTurn() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(330, t, 0.06, 0.05);
  playSquareNote(262, t + 0.06, 0.08, 0.04);
}

/** Dev card buy — mysterious ascending */
export function playDevCard() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(262, t, 0.08, 0.06);
  playSquareNote(330, t + 0.08, 0.08, 0.06);
  playSquareNote(392, t + 0.16, 0.08, 0.06);
  playSquareNote(523, t + 0.24, 0.15, 0.08);
}

/** Error — low buzz */
export function playError() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(110, t, 0.08, 0.1);
  playSquareNote(110, t + 0.12, 0.08, 0.1);
}

/** Chat message — tiny blip */
export function playChat() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(1047, t, 0.04, 0.04);
}

/** Setup placement — soft confirm */
export function playSetup() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(440, t, 0.06, 0.06);
  playSquareNote(554, t + 0.06, 0.1, 0.06);
}

/** Win fanfare — ascending triumphant */
export function playWin() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(523, t, 0.15, 0.1);       // C5
  playSquareNote(659, t + 0.15, 0.15, 0.1); // E5
  playSquareNote(784, t + 0.3, 0.15, 0.1);  // G5
  playSquareNote(1047, t + 0.45, 0.3, 0.12); // C6
}

/** Collect resources — happy coin pickup */
export function playCollect() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(784, t, 0.06, 0.06);
  playSquareNote(1047, t + 0.06, 0.1, 0.07);
}

/** Button click — tiny tick */
export function playClick() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(800, t, 0.025, 0.04);
}

/** Achievement unlocked — distinct rising fanfare */
export function playAchievement() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(392, t, 0.1, 0.08);        // G4
  playSquareNote(523, t + 0.1, 0.1, 0.08);  // C5
  playSquareNote(659, t + 0.2, 0.1, 0.08);  // E5
  playSquareNote(784, t + 0.3, 0.1, 0.1);   // G5
  playSquareNote(1047, t + 0.4, 0.3, 0.12); // C6
}

/** Menu open — short ascending whoosh */
export function playMenuOpen() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(330, t, 0.06, 0.05);
  playSquareNote(440, t + 0.05, 0.06, 0.05);
  playSquareNote(554, t + 0.1, 0.08, 0.06);
}

/** Menu close — short descending whoosh */
export function playMenuClose() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(554, t, 0.06, 0.05);
  playSquareNote(440, t + 0.05, 0.06, 0.05);
  playSquareNote(330, t + 0.1, 0.08, 0.04);
}

/** Navigate / start — confident double ding */
export function playNavigate() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(659, t, 0.08, 0.08);       // E5
  playSquareNote(880, t + 0.1, 0.15, 0.1);  // A5
}

/** Hover tick — very subtle blip for hover feedback */
export function playHover() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(600, t, 0.015, 0.02);
}

/** Confirm action — firm click */
export function playConfirm() {
  const ctx = getContext();
  const t = ctx.currentTime;
  playSquareNote(523, t, 0.05, 0.07);
  playSquareNote(784, t + 0.06, 0.1, 0.08);
}
