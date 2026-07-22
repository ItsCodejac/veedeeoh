const b="veedeeoh_active_profile",x=[{id:"default_main",name:"Main Profile",avatar_color:"#c5f04e",role:"owner"}];function u(){try{const e=localStorage.getItem("veedeeoh_household_profiles");if(!e)return x;const n=JSON.parse(e);return n.length>0?n:x}catch{return x}}function y(e){localStorage.setItem("veedeeoh_household_profiles",JSON.stringify(e))}function v(){try{const n=localStorage.getItem(b);if(n){const t=JSON.parse(n);if(t&&t.id)return t}}catch{}return u()[0]||x[0]}function w(e){localStorage.setItem(b,JSON.stringify(e)),window.dispatchEvent(new CustomEvent("veedeeoh:profile-changed",{detail:e}))}function E(e){const n=document.getElementById("profileSwitcherModal");n&&n.remove();const t=u(),s=v(),r=document.createElement("div");r.id="profileSwitcherModal",r.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 30px; color: #fff; font-family: 'Space Grotesk', sans-serif;
  `,r.innerHTML=`
    <div style="text-align: center; max-width: 700px; width: 100%;">
      <h1 style="font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; margin: 0 0 12px; letter-spacing: -1px;">Who's Watching?</h1>
      <p style="color: #9aa5b5; font-size: 16px; margin: 0 0 40px;">Select your profile to load custom favorites and watch progress</p>
      
      <div style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-bottom: 40px;">
        ${t.map(i=>`
          <button class="profileAvatarBtn" data-id="${i.id}" style="
            background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; transition: transform 0.2s ease; outline: none;
          ">
            <div style="
              width: 100px; height: 100px; border-radius: 20px; background: ${i.avatar_color}; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 800; color: #06070a; box-shadow: ${i.id===s.id?"0 0 0 4px #c5f04e, 0 12px 30px rgba(197,240,78,0.4)":"0 8px 24px rgba(0,0,0,0.5)"}; position: relative;
            ">
              ${i.name.charAt(0).toUpperCase()}
            </div>
            <span style="font-size: 16px; font-weight: 700; color: #fff;">${m(i.name)}</span>
          </button>
        `).join("")}

        <button id="addProfileBtn" style="
          background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; outline: none;
        ">
          <div style="
            width: 100px; height: 100px; border-radius: 20px; background: rgba(255,255,255,0.08); border: 2px dashed rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 36px; color: #9aa5b5; transition: all 0.2s;
          ">
            +
          </div>
          <span style="font-size: 16px; font-weight: 600; color: #9aa5b5;">Add Profile</span>
        </button>
      </div>

      <button id="manageProfilesBtn" style="
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: background 0.2s;
      ">Manage Household Profiles</button>
    </div>
  `,document.body.appendChild(r),r.querySelectorAll(".profileAvatarBtn").forEach(i=>{i.addEventListener("click",()=>{const p=i.dataset.id,o=t.find(a=>a.id===p);o&&(w(o),r.remove(),e&&e(o))})});const l=r.querySelector("#addProfileBtn");l&&l.addEventListener("click",()=>{r.remove(),g()});const d=r.querySelector("#manageProfilesBtn");d&&d.addEventListener("click",()=>{r.remove(),g()})}function g(e){const n=document.getElementById("profileEditorModal");n&&n.remove();const t=document.createElement("div");t.id="profileEditorModal",t.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;const s=!!e,r=e?e.name:"",c=e?e.avatar_color:"#c5f04e";t.innerHTML=`
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 460px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9);">
      <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 800;">${s?"Edit Profile":"Create New Profile"}</h2>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">PROFILE NAME</label>
        <input type="text" id="editName" value="${m(r)}" placeholder="e.g. Living Room, Sarah" style="width: 100%; padding: 12px 16px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 15px; outline: none;" />
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">AVATAR COLOR</label>
        <div style="display: flex; gap: 12px;" id="colorPickerRow">
          ${["#c5f04e","#ff5e7e","#06d6a0","#118ab2","#ffd166","#a78bfa"].map(o=>`
            <button class="colorChoiceBtn ${o===c?"selected":""}" data-color="${o}" style="
              width: 38px; height: 38px; border-radius: 10px; background: ${o}; border: ${o===c?"3px solid #fff":"none"}; cursor: pointer;
            "></button>
          `).join("")}
        </div>
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="cancelEditBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="saveProfileBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #c5f04e; border: none; color: #06070a; font-weight: 700; cursor: pointer;">Save Profile</button>
      </div>
    </div>
  `,document.body.appendChild(t);let l=c;const d=t.querySelectorAll(".colorChoiceBtn");d.forEach(o=>{o.addEventListener("click",()=>{d.forEach(a=>a.style.border="none"),o.style.border="3px solid #fff",l=o.dataset.color||"#c5f04e"})});const i=t.querySelector("#saveProfileBtn"),p=t.querySelector("#cancelEditBtn");p&&p.addEventListener("click",()=>t.remove()),i&&i.addEventListener("click",()=>{const o=t.querySelector("#editName").value.trim();if(!o){alert("Please enter a profile name.");return}const a=u();if(s&&e){const f=a.findIndex(h=>h.id===e.id);f!==-1&&(a[f]={id:e.id,name:o,avatar_color:l})}else{const f={id:"profile_"+Date.now(),name:o,avatar_color:l};a.push(f)}y(a),t.remove(),E()})}function m(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}export{v as getActiveProfile,u as getStoredProfiles,g as openProfileEditor,E as openProfileSwitcher,y as saveProfiles,w as setActiveProfile};
