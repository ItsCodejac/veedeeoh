const E="veedeeoh_active_profile",m=[{id:"default_main",name:"Main Profile",avatar_color:"#c5f04e",is_kids:!1,max_rating:"TV-MA"},{id:"default_kids",name:"Kidz",avatar_color:"#ff5e7e",is_kids:!0,max_rating:"PG"}];function h(){try{const e=localStorage.getItem("veedeeoh_household_profiles");if(!e)return m;const r=JSON.parse(e);return r.length>0?r:m}catch{return m}}function P(e){localStorage.setItem("veedeeoh_household_profiles",JSON.stringify(e))}function _(){try{const r=localStorage.getItem(E);if(r){const t=JSON.parse(r);if(t&&t.id)return t}}catch{}return h()[0]||m[0]}function B(e){localStorage.setItem(E,JSON.stringify(e)),document.documentElement.setAttribute("data-kids-mode",e.is_kids?"true":"false"),window.dispatchEvent(new CustomEvent("veedeeoh:profile-changed",{detail:e}))}function I(e,r){const t=document.getElementById("pinVerificationModal");t&&t.remove();const n=document.createElement("div");n.id="pinVerificationModal",n.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.9);
    backdrop-filter: blur(16px); z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
  `,n.innerHTML=`
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 20px; max-width: 360px; width: 100%; padding: 32px; text-align: center; color: #fff; font-family: 'Space Grotesk', sans-serif; box-shadow: 0 20px 50px rgba(0,0,0,0.9);">
      <div style="margin-bottom: 12px; display: flex; justify-content: center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#c5f04e" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      </div>
      <h3 style="margin: 0 0 8px; font-size: 20px;">Parent PIN Required</h3>
      <p style="margin: 0 0 20px; color: #9aa5b5; font-size: 14px;">Enter 4-digit Master PIN to proceed</p>
      <input type="password" id="pinInput" maxlength="4" placeholder="••••" style="width: 140px; font-size: 28px; letter-spacing: 8px; text-align: center; background: #080a10; border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; color: #c5f04e; padding: 10px; margin-bottom: 20px; outline: none;" autofocus />
      <div id="pinError" style="color: #ff5e7e; font-size: 13px; margin-bottom: 16px; display: none;">Incorrect PIN</div>
      <div style="display: flex; gap: 12px;">
        <button id="cancelPinBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="submitPinBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #c5f04e; border: none; color: #06070a; font-weight: 700; cursor: pointer;">Verify</button>
      </div>
    </div>
  `,document.body.appendChild(n);const o=n.querySelector("#pinInput"),c=n.querySelector("#pinError"),p=n.querySelector("#cancelPinBtn"),d=n.querySelector("#submitPinBtn"),i=()=>{o.value===e?(n.remove(),r()):(c.style.display="block",o.value="",o.focus())};d.onclick=i,p.onclick=()=>n.remove(),o.onkeyup=l=>{l.key==="Enter"&&i(),o.value.length===4&&i()}}function z(e){const r=document.getElementById("profileSwitcherModal");r&&r.remove();const t=h(),n=_(),o=document.createElement("div");o.id="profileSwitcherModal",o.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 30px; color: #fff; font-family: 'Space Grotesk', sans-serif;
  `,o.innerHTML=`
    <div style="text-align: center; max-width: 700px; width: 100%;">
      <h1 style="font-size: clamp(2rem, 4vw, 3rem); font-weight: 800; margin: 0 0 12px; letter-spacing: -1px;">Who's Watching?</h1>
      <p style="color: #9aa5b5; font-size: 16px; margin: 0 0 40px;">Select your profile to load custom favorites, watch progress, and settings</p>
      
      <div style="display: flex; gap: 24px; justify-content: center; flex-wrap: wrap; margin-bottom: 40px;">
        ${t.map(i=>`
          <button class="profileAvatarBtn" data-id="${i.id}" style="
            background: none; border: none; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 14px; transition: transform 0.2s ease; outline: none;
          ">
            <div style="
              width: 100px; height: 100px; border-radius: 20px; background: ${i.avatar_color}; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 800; color: #06070a; box-shadow: ${i.id===n.id?"0 0 0 4px #c5f04e, 0 12px 30px rgba(197,240,78,0.4)":"0 8px 24px rgba(0,0,0,0.5)"}; position: relative;
            ">
              ${i.is_kids?'<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#06070a" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>':i.name.charAt(0).toUpperCase()}
              ${i.pin?'<span style="position: absolute; bottom: 6px; right: 6px; display: flex;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06070a" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>':""}
            </div>
            <span style="font-size: 16px; font-weight: 700; color: #fff;">${y(i.name)}</span>
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
  `,document.body.appendChild(o),o.querySelectorAll(".profileAvatarBtn").forEach(i=>{i.addEventListener("click",()=>{const l=i.dataset.id,s=t.find(x=>x.id===l);if(!s)return;const f=()=>{B(s),o.remove(),e&&e(s)};s.pin?I(s.pin,f):f()})});const p=o.querySelector("#addProfileBtn");p&&p.addEventListener("click",()=>{o.remove(),w()});const d=o.querySelector("#manageProfilesBtn");d&&d.addEventListener("click",()=>{o.remove(),w()})}function w(e){const r=document.getElementById("profileEditorModal");r&&r.remove();const t=document.createElement("div");t.id="profileEditorModal",t.style.cssText=`
    position: fixed; inset: 0; background: rgba(6,7,10,0.92);
    backdrop-filter: blur(20px); z-index: 10000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
    color: #fff; font-family: 'Space Grotesk', sans-serif;
  `;const n=!!e,o=e?e.name:"",c=e?e.avatar_color:"#c5f04e",p=e?e.is_kids:!1,d=e?e.max_rating:"TV-MA",i=e&&e.pin||"";t.innerHTML=`
    <div style="background: #10141e; border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; max-width: 460px; width: 100%; padding: 32px; box-shadow: 0 24px 60px rgba(0,0,0,0.9);">
      <h2 style="margin: 0 0 20px; font-size: 24px; font-weight: 800;">${n?"Edit Profile":"Create New Profile"}</h2>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">PROFILE NAME</label>
        <input type="text" id="editName" value="${y(o)}" placeholder="e.g. Kids Room, Sarah" style="width: 100%; padding: 12px 16px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 15px; outline: none;" />
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">AVATAR COLOR</label>
        <div style="display: flex; gap: 12px;" id="colorPickerRow">
          ${["#c5f04e","#ff5e7e","#06d6a0","#118ab2","#ffd166","#a78bfa"].map(a=>`
            <button class="colorChoiceBtn ${a===c?"selected":""}" data-color="${a}" style="
              width: 38px; height: 38px; border-radius: 10px; background: ${a}; border: ${a===c?"3px solid #fff":"none"}; cursor: pointer;
            "></button>
          `).join("")}
        </div>
      </div>

      <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; background: #080a10; padding: 14px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div>
          <div style="font-weight: 700; font-size: 15px;">🎈 Kids Mode (veedeeoh.kidz)</div>
          <div style="font-size: 12px; color: #9aa5b5;">Enforces PG rating limit & colorful kid UI</div>
        </div>
        <input type="checkbox" id="editKids" ${p?"checked":""} style="width: 20px; height: 20px; accent-color: #ff5e7e; cursor: pointer;" />
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">MAX MATURITY RATING</label>
        <select id="editRating" style="width: 100%; padding: 12px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #fff; font-size: 14px;">
          <option value="G" ${d==="G"?"selected":""}>G / TV-Y (Little Kids)</option>
          <option value="PG" ${d==="PG"?"selected":""}>PG / TV-Y7 (Older Kids)</option>
          <option value="PG-13" ${d==="PG-13"?"selected":""}>PG-13 / TV-14 (Teens)</option>
          <option value="TV-MA" ${d==="TV-MA"?"selected":""}>TV-MA / R (Unrestricted)</option>
        </select>
      </div>

      <div style="margin-bottom: 24px;">
        <label style="display: block; font-size: 13px; color: #9aa5b5; margin-bottom: 8px; font-weight: 700;">OPTIONAL 4-DIGIT PIN LOCK</label>
        <input type="password" id="editPin" maxlength="4" value="${y(i)}" placeholder="Leave blank for none" style="width: 100%; padding: 12px 16px; background: #080a10; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: #c5f04e; font-size: 16px; letter-spacing: 4px; outline: none;" />
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="cancelEditBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-weight: 700; cursor: pointer;">Cancel</button>
        <button id="saveProfileBtn" style="flex: 1; padding: 12px; border-radius: 10px; background: #c5f04e; border: none; color: #06070a; font-weight: 700; cursor: pointer;">Save Profile</button>
      </div>
    </div>
  `,document.body.appendChild(t);let l=c;const s=t.querySelectorAll(".colorChoiceBtn");s.forEach(a=>{a.addEventListener("click",()=>{s.forEach(u=>u.style.border="none"),a.style.border="3px solid #fff",l=a.dataset.color||"#c5f04e"})});const f=t.querySelector("#saveProfileBtn"),x=t.querySelector("#cancelEditBtn");x&&x.addEventListener("click",()=>t.remove()),f&&f.addEventListener("click",()=>{const a=t.querySelector("#editName").value.trim(),u=t.querySelector("#editKids").checked,v=t.querySelector("#editRating").value,k=t.querySelector("#editPin").value.trim();if(!a){alert("Please enter a profile name.");return}const g=h();if(n&&e){const b=g.findIndex(S=>S.id===e.id);b!==-1&&(g[b]={id:e.id,name:a,avatar_color:l,is_kids:u,max_rating:v,pin:k||null})}else{const b={id:"profile_"+Date.now(),name:a,avatar_color:l,is_kids:u,max_rating:v,pin:k||null};g.push(b)}P(g),t.remove(),z()})}function y(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}export{_ as getActiveProfile,h as getStoredProfiles,w as openProfileEditor,z as openProfileSwitcher,I as promptPinVerification,P as saveProfiles,B as setActiveProfile};
