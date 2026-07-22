import { SleepTimerConfig, VodItem } from './types';

export const AMBIENT_SLEEP_ITEMS: VodItem[] = [
  {
    id: 'zzz_fireplace',
    title: '4K Cozy Fireplace & Crackling Log',
    type: 'movie',
    poster: 'https://images.unsplash.com/photo-1542296332-2e4473faf563?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1542296332-2e4473faf563?w=1200&auto=format&fit=crop&q=80',
    summary: 'Warm crackling fireplace ambiance in crisp 4K Ultra HD. Deep relaxing embers and gentle fire sounds.',
    genre: 'Sleep & Ambient',
    rating: 'G',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
  },
  {
    id: 'zzz_rain',
    title: 'Night Rain & Thunder on Window Glass',
    type: 'movie',
    poster: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=1200&auto=format&fit=crop&q=80',
    summary: 'Gentle night rain falling against glass with distant rolling thunder for deep sleep and insomnia relief.',
    genre: 'Sleep & Ambient',
    rating: 'G',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  },
  {
    id: 'zzz_nebula',
    title: 'Deep Space Nebula & Delta Waves',
    type: 'movie',
    poster: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80',
    summary: 'Slow motion cosmic starfield drifting with 432Hz delta binaural beats for deep REM sleep.',
    genre: 'Sleep & Ambient',
    rating: 'G',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
  },
  {
    id: 'zzz_lullaby',
    title: 'Baby Lullabies & Starry Night Light',
    type: 'movie',
    poster: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&auto=format&fit=crop&q=80',
    banner: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&auto=format&fit=crop&q=80',
    summary: 'Soothing soft music box lullabies paired with gentle galaxy projector animation for babies and toddlers.',
    genre: 'Sleep & Ambient',
    rating: 'G',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
  }
];

let timerInterval: number | null = null;
let timerState: SleepTimerConfig = {
  durationMinutes: 0,
  remainingSeconds: 0,
  fadeAudio: true,
  active: false
};

export function startSleepTimer(minutes: number, onExpire?: () => void): void {
  stopSleepTimer();

  timerState = {
    durationMinutes: minutes,
    remainingSeconds: minutes * 60,
    fadeAudio: true,
    active: true
  };

  showSleepToast(`Sleep timer set for ${minutes} minutes 🌙`);

  timerInterval = window.setInterval(() => {
    if (timerState.remainingSeconds > 0) {
      timerState.remainingSeconds--;

      // Fade audio in last 30 seconds
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (video && timerState.remainingSeconds <= 30 && timerState.remainingSeconds > 0) {
        video.volume = Math.max(0, timerState.remainingSeconds / 30);
      }

      if (timerState.remainingSeconds === 0) {
        stopSleepTimer();
        if (video) {
          video.pause();
        }
        showSleepToast(`Sleep timer completed. Goodnight! 😴`);
        if (onExpire) onExpire();
      }
    }
  }, 1000);
}

export function stopSleepTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerState.active = false;
  timerState.remainingSeconds = 0;
}

export function getSleepTimerState(): SleepTimerConfig {
  return timerState;
}

function showSleepToast(msg: string): void {
  const existing = document.getElementById('zzzToast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.id = 'zzzToast';
  t.style.cssText = `
    position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
    background: rgba(16,20,30,0.95); border: 1px solid rgba(167,139,250,0.5);
    color: #a78bfa; padding: 12px 24px; border-radius: 24px; font-size: 14px;
    font-weight: 700; z-index: 10002; box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    font-family: 'Space Grotesk', sans-serif; pointer-events: none;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

const ZZZ_FAV_KEY = 'veedeeoh_zzz_favorites';

export function getZzzFavorites(): VodItem[] {
  try {
    const raw = localStorage.getItem(ZZZ_FAV_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isZzzFavorite(id: string): boolean {
  const favs = getZzzFavorites();
  return favs.some(f => f.id === id);
}

export function toggleZzzFavorite(item: VodItem): boolean {
  const favs = getZzzFavorites();
  const index = favs.findIndex(f => f.id === item.id);
  let isNowPinned = false;
  if (index >= 0) {
    favs.splice(index, 1);
    showSleepToast(`Removed "${item.title}" from zzz space`);
  } else {
    favs.unshift(item);
    isNowPinned = true;
    showSleepToast(`Added "${item.title}" to zzz space`);
  }
  localStorage.setItem(ZZZ_FAV_KEY, JSON.stringify(favs));
  return isNowPinned;
}

export function renderZzzSanctuary(container: HTMLElement | null): void {
  if (!container) return;
  container.replaceChildren();

  // 1. Bedtime Favorites Rail (User-pinned calm space documentaries & shows)
  const favs = getZzzFavorites();
  if (favs.length > 0) {
    const favSection = document.createElement('div');
    favSection.className = 'showcaseRail';
    favSection.style.marginBottom = '32px';

    const favHeader = document.createElement('h3');
    favHeader.style.cssText = 'font-size: 20px; font-weight: 800; color: #a78bfa; margin: 0 0 16px; display: flex; align-items: center; gap: 8px;';
    favHeader.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#a78bfa" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      <span>🌙 My Bedtime Favorites</span>
    `;
    favSection.appendChild(favHeader);

    const favRow = document.createElement('div');
    favRow.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px;';

    favs.forEach(item => {
      const card = document.createElement('div');
      card.style.cssText = 'background: #10141e; border: 1px solid rgba(167,139,250,0.3); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;';
      card.onmouseover = () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#a78bfa'; };
      card.onmouseout = () => { card.style.transform = 'none'; card.style.borderColor = 'rgba(167,139,250,0.3)'; };

      card.innerHTML = `
        <div style="height: 150px; position: relative; overflow: hidden;">
          <img src="${item.poster || item.banner || ''}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
          <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.9) 100%);"></div>
          <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
            <span style="background: rgba(167,139,250,0.3); backdrop-filter: blur(8px); border: 1px solid rgba(167,139,250,0.5); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">BEDTIME FAVORITE</span>
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #a78bfa; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
          </div>
        </div>
        <div style="padding: 16px;">
          <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(item.title)}</h4>
          <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.summary || '')}</p>
        </div>
      `;

      card.onclick = () => {
        import('./vod').then(vod => vod.openVodDetails(item));
      };

      favRow.appendChild(card);
    });

    favSection.appendChild(favRow);
    container.appendChild(favSection);
  }

  // 2. Curated Sleep & Ambient Soundscapes Rail
  const section = document.createElement('div');
  section.className = 'showcaseRail';
  section.style.marginBottom = '32px';

  const header = document.createElement('h3');
  header.style.cssText = 'font-size: 20px; font-weight: 800; color: #a78bfa; margin: 0 0 16px; display: flex; align-items: center; gap: 8px;';
  header.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
    <span>Sleep & Ambient Soundscapes</span>
  `;
  section.appendChild(header);

  const row = document.createElement('div');
  row.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px;';

  AMBIENT_SLEEP_ITEMS.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #10141e; border: 1px solid rgba(167,139,250,0.2); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;';
    card.onmouseover = () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#a78bfa'; };
    card.onmouseout = () => { card.style.transform = 'none'; card.style.borderColor = 'rgba(167,139,250,0.2)'; };

    card.innerHTML = `
      <div style="height: 150px; position: relative; overflow: hidden;">
        <img src="${item.poster}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.9) 100%);"></div>
        <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span style="background: rgba(167,139,250,0.3); backdrop-filter: blur(8px); border: 1px solid rgba(167,139,250,0.5); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">AMBIENT</span>
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #a78bfa; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
        </div>
      </div>
      <div style="padding: 16px;">
        <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #fff;">${escapeHtml(item.title)}</h4>
        <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(item.summary)}</p>
      </div>
    `;

    card.onclick = () => {
      import('./vod').then(vod => vod.openVodDetails(item));
    };

    row.appendChild(card);
  });

  section.appendChild(row);
  container.appendChild(section);

  // Wire Top Floating Controls Bar
  wireZzzControlBar();
}

function wireZzzControlBar(): void {
  const timerBtns = document.querySelectorAll('.zzzTimerOptionBtn');
  timerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      timerBtns.forEach(b => {
        (b as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
        (b as HTMLElement).style.color = '#9aa5b5';
        (b as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
      });
      (btn as HTMLElement).style.background = '#a78bfa';
      (btn as HTMLElement).style.color = '#06070a';
      (btn as HTMLElement).style.borderColor = '#a78bfa';

      const mins = parseInt((btn as HTMLElement).dataset.mins || '0');
      if (mins > 0) {
        startSleepTimer(mins);
      } else {
        stopSleepTimer();
        showSleepToast('Sleep timer turned off');
      }
    });
  });

  const alarmBtn = document.getElementById('zzzAlarmToggleBtn');
  if (alarmBtn) {
    alarmBtn.onclick = () => openSunriseAlarmModal();
  }

  const dimmerBtn = document.getElementById('zzzDimmerToggleBtn');
  if (dimmerBtn) {
    dimmerBtn.onclick = () => toggleNightDimmerMode();
  }
}

export function toggleNightDimmerMode(): void {
  let overlay = document.getElementById('zzzNightDimmerOverlay');
  if (overlay) {
    overlay.remove();
    showSleepToast('Nightstand mode disabled');
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'zzzNightDimmerOverlay';
  overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(5,6,9,0.95); backdrop-filter: blur(14px); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #a78bfa; font-family: "Space Grotesk", sans-serif; cursor: pointer; user-select: none;';
  
  const updateClock = () => {
    const now = new Date();
    const hrs = now.getHours() % 12 || 12;
    const mins = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    if (overlay) {
      overlay.innerHTML = `
        <div style="font-size: 88px; font-weight: 800; letter-spacing: 2px; color: rgba(167,139,250,0.65); opacity: 0.8; text-shadow: 0 0 35px rgba(167,139,250,0.4);">${hrs}:${mins} <span style="font-size: 26px;">${ampm}</span></div>
        <p style="margin-top: 16px; font-size: 14px; color: rgba(255,255,255,0.4); font-weight: 600;">Tap anywhere to exit Nightstand Mode</p>
      `;
    }
  };

  updateClock();
  const clockInt = setInterval(updateClock, 10000);
  overlay.onclick = () => {
    clearInterval(clockInt);
    overlay?.remove();
  };

  document.body.appendChild(overlay);
  showSleepToast('Nightstand clock active');
}

export function openSunriseAlarmModal(): void {
  const existing = document.getElementById('zzzAlarmModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'zzzAlarmModal';
  modal.style.cssText = 'position: fixed; inset: 0; background: rgba(6,7,10,0.9); backdrop-filter: blur(16px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px; color: #fff; font-family: "Space Grotesk", sans-serif;';
  modal.innerHTML = `
    <div style="background: #10141e; border: 1px solid rgba(255,183,3,0.35); border-radius: 24px; max-width: 380px; width: 100%; padding: 28px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.9);">
      <div style="margin-bottom: 8px; display: flex; justify-content: center; color: #ffb703;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M5 3L2 6"></path><path d="M22 6l-3-3"></path></svg>
      </div>
      <h3 style="margin: 0 0 6px; font-size: 22px; font-weight: 800;">Gentle Sunrise Alarm</h3>
      <p style="margin: 0 0 20px; color: #9aa5b5; font-size: 13px;">Set target wakeup time. The screen will slowly brighten with gentle sunrise colors and morning soundscapes.</p>

      <div style="margin-bottom: 20px;">
        <input type="time" id="zzzAlarmTimeInput" value="07:00" style="font-size: 28px; padding: 8px 16px; background: #080a10; border: 1px solid rgba(255,183,3,0.4); border-radius: 12px; color: #ffb703; text-align: center; outline: none; width: 160px;" />
      </div>

      <div style="display: flex; gap: 10px;">
        <button id="closeAlarmModalBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="setAlarmBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #ffb703; border: none; color: #06070a; font-weight: 800; cursor: pointer;">Set Alarm</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#closeAlarmModalBtn') as HTMLButtonElement | null;
  if (closeBtn) closeBtn.onclick = () => modal.remove();

  const setBtn = modal.querySelector('#setAlarmBtn') as HTMLButtonElement | null;
  if (setBtn) {
    setBtn.onclick = () => {
      const timeVal = (modal.querySelector('#zzzAlarmTimeInput') as HTMLInputElement).value;
      if (timeVal) {
        showSleepToast(`Sunrise Alarm set for ${timeVal}`);
        if ("wakeLock" in navigator) {
          navigator.wakeLock.request("screen").catch(() => {});
        }
      }
      modal.remove();
    };
  }
}

export function openSleepTimerModal(): void {
  toggleNightDimmerMode();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
