import{getStoredProfiles as g,getActiveProfile as x,openProfileEditor as a}from"./profiles-Cy61qwaS.js";import{g as b}from"./auth-Dq18GEHP.js";function m(){const i=document.getElementById("settingsModal");i&&i.remove();const o=b(),n=g(),p=x(),t=document.createElement("div");t.id="settingsModal",t.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `,t.innerHTML=`
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 620px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9); max-height: 90vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 800;">⚙️ Household Settings</h2>
        <button id="closeSettingsBtn" style="background: none; border: none; color: #9aa5b5; font-size: 24px; cursor: pointer;">✕</button>
      </div>

      <!-- Account Info -->
      <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
        <div style="font-size: 12px; color: #9aa5b5; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">CURRENT ACCOUNT</div>
        <div style="font-size: 18px; font-weight: 700; color: #fff;">${o?l(o.email):"Local / Self-Hosted Guest"}</div>
        <div style="margin-top: 10px; display: inline-flex; align-items: center; gap: 8px; background: rgba(197,240,78,0.15); border: 1px solid rgba(197,240,78,0.3); padding: 4px 14px; border-radius: 20px; color: #c5f04e; font-size: 12px; font-weight: 700;">
          <span>⭐ Membership Tier: Founder VIP (Unlimited Profiles)</span>
        </div>
      </div>

      <!-- Household Profiles -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 700;">Household Profiles</h3>
          <button id="settingsAddProfileBtn" style="background: #c5f04e; color: #06070a; border: none; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">+ Add Profile</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${n.map(e=>`
            <div style="display: flex; align-items: center; justify-content: space-between; background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px 16px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 36px; height: 36px; border-radius: 8px; background: ${e.avatar_color}; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #06070a;">
                  ${e.is_kids?"🎈":e.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${l(e.name)} ${e.id===p.id?'<span style="color: #c5f04e; font-size: 12px;">(Active)</span>':""}</div>
                  <div style="font-size: 12px; color: #9aa5b5;">${e.is_kids?"veedeeoh.kidz":"Standard"} · Rating Max: ${e.max_rating} ${e.pin?"· 🔒 PIN Set":""}</div>
                </div>
              </div>
              <button class="settingsEditProfileBtn" data-id="${e.id}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;">Edit</button>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Playback Preferences -->
      <div>
        <h3 style="margin: 0 0 14px; font-size: 18px; font-weight: 700;">Playback & Bandwidth</h3>
        <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 14px;">Default Subtitle CC</div>
              <div style="font-size: 12px; color: #9aa5b5;">Always enable closed captions when available</div>
            </div>
            <input type="checkbox" checked style="width: 18px; height: 18px; accent-color: #c5f04e;" />
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <div style="font-weight: 700; font-size: 14px;">Stream Quality Cap</div>
              <div style="font-size: 12px; color: #9aa5b5;">Client-side direct streaming bandwidth limit</div>
            </div>
            <select style="background: #10141e; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px;">
              <option value="auto">Auto (Highest Available)</option>
              <option value="1080p">1080p Full HD</option>
              <option value="720p">720p Data Saver</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `,document.body.appendChild(t);const d=t.querySelector("#closeSettingsBtn");d&&d.addEventListener("click",()=>t.remove());const s=t.querySelector("#settingsAddProfileBtn");s&&s.addEventListener("click",()=>{t.remove(),a()}),t.querySelectorAll(".settingsEditProfileBtn").forEach(e=>{e.addEventListener("click",()=>{const c=e.dataset.id,r=n.find(f=>f.id===c);r&&(t.remove(),a(r))})})}function l(i){return i.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}export{m as openSettingsModal};
