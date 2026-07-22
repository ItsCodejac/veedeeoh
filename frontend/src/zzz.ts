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

export function openSleepTimerModal(): void {
  const existing = document.getElementById('zzzTimerModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'zzzTimerModal';
  modal.style.cssText = `
    position: fixed; inset: 0; background: rgba(6,7,10,0.88);
    backdrop-filter: blur(16px); z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;

  modal.innerHTML = `
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 400px; width: 100%; padding: 32px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.9);">
      <div style="margin-bottom: 8px; display: flex; justify-content: center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      </div>
      <h2 style="margin: 0 0 6px; font-size: 24px; font-weight: 800;">veedeeoh.zzz</h2>
      <p style="margin: 0 0 24px; color: #9aa5b5; font-size: 14px;">Select a sleep timer duration with smooth audio fade</p>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        <button class="timerChoiceBtn" data-min="15" style="padding: 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;">15 Minutes</button>
        <button class="timerChoiceBtn" data-min="30" style="padding: 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;">30 Minutes</button>
        <button class="timerChoiceBtn" data-min="60" style="padding: 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;">60 Minutes</button>
        <button class="timerChoiceBtn" data-min="90" style="padding: 14px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer;">90 Minutes</button>
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="cancelZzzBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Close</button>
        ${timerState.active ? `<button id="stopZzzBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #ff5e7e; border: none; color: #fff; font-weight: 700; cursor: pointer;">Turn Off Timer</button>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const btns = modal.querySelectorAll('.timerChoiceBtn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const min = parseInt((btn as HTMLElement).dataset.min || '30');
      startSleepTimer(min);
      modal.remove();
    });
  });

  const cancelBtn = modal.querySelector('#cancelZzzBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal.remove());

  const stopBtn = modal.querySelector('#stopZzzBtn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopSleepTimer();
      showSleepToast('Sleep timer turned off');
      modal.remove();
    });
  }
}
