import{getStoredProfiles as w,getActiveProfile as S,openProfileEditor as u}from"./profiles-DKBXu0ov.js";import{g as z}from"./auth-CfTRY03a.js";function y(){I()}function I(){const p=document.getElementById("settingsModal");p&&p.remove();const l=z(),f=w(),x=S(),h=l&&l.email?l.email.split("@")[0]:"My Household",v=localStorage.getItem("veedeeoh_account_name")||h;let s=[];try{const e=localStorage.getItem("veedeeoh_pending_invites")||"[]";s=JSON.parse(e)}catch{s=[]}const t=document.createElement("div");t.id="settingsModal",t.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `,t.innerHTML=`
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 620px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9); max-height: 90vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 16px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 800; display: inline-flex; align-items: center; gap: 10px;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span>Household Settings</span>
        </h2>
        <button id="closeSettingsBtn" style="background: none; border: none; color: #9aa5b5; font-size: 24px; cursor: pointer;">✕</button>
      </div>

      <!-- Account Info & Name -->
      <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <div style="font-size: 12px; color: #9aa5b5; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">CURRENT ACCOUNT</div>
            <div style="font-size: 18px; font-weight: 700; color: #fff;">${l?d(l.email):"Local / Self-Hosted Guest"}</div>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700; margin-top: 4px;">Role: ${x.role==="owner"?"Account Owner (Admin)":"Household Member"}</div>
          </div>
          <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(197,240,78,0.15); border: 1px solid rgba(197,240,78,0.3); padding: 4px 14px; border-radius: 20px; color: #c5f04e; font-size: 12px; font-weight: 700;">
            <span>Founder VIP</span>
          </div>
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #9aa5b5; margin-bottom: 6px; font-weight: 700;">HOUSEHOLD / ACCOUNT DISPLAY NAME</label>
          <input type="text" id="accountDisplayName" value="${d(v)}" placeholder="e.g. Cojac's Household" style="width: 100%; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
        </div>
      </div>

      <!-- Household Profiles -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 700;">Household Profiles</h3>
          <button id="settingsAddProfileBtn" style="background: #c5f04e; color: #06070a; border: none; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">+ Add Profile</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${f.map(e=>`
            <div style="display: flex; align-items: center; justify-content: space-between; background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px 16px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 36px; height: 36px; border-radius: 8px; background: ${e.avatar_color}; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #06070a;">
                  ${e.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style="font-weight: 700; font-size: 15px;">${d(e.name)} ${e.id===x.id?'<span style="color: #c5f04e; font-size: 12px;">(Active)</span>':""}</div>
                  <div style="font-size: 12px; color: #9aa5b5;">Standard Profile</div>
                </div>
              </div>
              <button class="settingsEditProfileBtn" data-id="${e.id}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;">Edit</button>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Anti-Netflix Direct Link Member Sharing -->
      <div style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 700;">🤝 Non-Geolocked Direct Invites</h3>
            <div style="font-size: 12px; color: #06d6a0; font-weight: 700;">Zero IP locks. Generate & text/email direct links to family anywhere.</div>
          </div>
        </div>
        <div style="background: #080a10; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
          <p style="margin: 0 0 12px; font-size: 13px; color: #9aa5b5;">Generate a direct non-geolocked invitation link for family members or roommates:</p>
          <div style="display: flex; gap: 10px; margin-bottom: ${s.length>0?"16px":"0"};">
            <input type="text" id="inviteMemberEmail" placeholder="Member name or email (e.g. Sarah)" style="flex: 1; padding: 10px 14px; background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none;" />
            <button id="sendInviteBtn" style="background: #06d6a0; color: #06070a; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer;">Generate Link</button>
          </div>

          ${s.length>0?`
            <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px;">
              <div style="font-size: 12px; font-weight: 700; color: #9aa5b5; text-transform: uppercase; margin-bottom: 10px;">ACTIVE HOUSEHOLD INVITE LINKS</div>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${s.map(e=>`
                  <div style="display: flex; align-items: center; justify-content: space-between; background: #10141e; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                    <div>
                      <div style="font-size: 14px; font-weight: 700; color: #fff;">${d(e.email)}</div>
                      <div style="font-size: 11px; color: #9aa5b5;">Created ${d(e.invitedAt||"Recently")}</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                      <button class="copyInviteLinkBtn" data-url="${d(e.inviteUrl)}" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #c5f04e; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Copy Link</button>
                      <button class="revokeInviteBtn" data-email="${d(e.email)}" style="background: rgba(255,94,126,0.15); border: 1px solid rgba(255,94,126,0.3); color: #ff5e7e; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;">Revoke</button>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
          `:""}
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
  `,document.body.appendChild(t);const b=t.querySelector("#closeSettingsBtn");b&&b.addEventListener("click",()=>t.remove());const m=t.querySelector("#settingsAddProfileBtn");m&&m.addEventListener("click",()=>{t.remove(),u()});const c=t.querySelector("#accountDisplayName");c&&c.addEventListener("change",()=>{const e=c.value.trim();e&&localStorage.setItem("veedeeoh_account_name",e)}),t.querySelectorAll(".settingsEditProfileBtn").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.id,o=f.find(n=>n.id===i);o&&(t.remove(),u(o))})});const a=t.querySelector("#sendInviteBtn"),g=t.querySelector("#inviteMemberEmail");a&&g&&a.addEventListener("click",async()=>{const e=g.value.trim();if(!e){alert("Please enter a member name or email.");return}a.disabled=!0,a.textContent="Generating...";try{const i="inv_"+Math.random().toString(36).substring(2,10),o=`${window.location.origin}/landing.html?invite=${i}&acc=${encodeURIComponent(v)}`,n=localStorage.getItem("veedeeoh_pending_invites")||"[]";let r=[];try{r=JSON.parse(n)}catch{}r=r.filter(k=>k.email!==e),r.unshift({email:e,invitedAt:new Date().toLocaleDateString(),inviteUrl:o,code:i}),localStorage.setItem("veedeeoh_pending_invites",JSON.stringify(r)),navigator.clipboard&&await navigator.clipboard.writeText(o).catch(()=>{}),g.value="",alert(`✅ Non-Geolocked Invite link created for "${e}"!

Link copied to your clipboard:
${o}`),t.remove(),y()}catch(i){alert(`Failed to generate invite link: ${i}`)}finally{a&&(a.disabled=!1,a.textContent="Generate Link")}}),t.querySelectorAll(".copyInviteLinkBtn").forEach(e=>{e.addEventListener("click",async()=>{const i=e.dataset.url;i&&navigator.clipboard&&(await navigator.clipboard.writeText(i),e.textContent="Copied!",setTimeout(()=>{e.textContent="Copy Link"},2e3))})}),t.querySelectorAll(".revokeInviteBtn").forEach(e=>{e.addEventListener("click",()=>{const i=e.dataset.email;if(!i)return;const o=localStorage.getItem("veedeeoh_pending_invites")||"[]";let n=[];try{n=JSON.parse(o)}catch{}n=n.filter(r=>r.email!==i),localStorage.setItem("veedeeoh_pending_invites",JSON.stringify(n)),t.remove(),y()})})}function d(p){return p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}export{y as openSettingsModal};
