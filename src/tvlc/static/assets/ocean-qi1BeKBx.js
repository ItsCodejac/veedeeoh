import{g as p,e as s,o as f}from"./main-BfIzA_wX.js";import"./auth-Dq18GEHP.js";async function h(){const r=document.getElementById("oceanRails");if(r){r.innerHTML=`
    <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5); font-weight: 600;">
      Loading Ocean TV streams...
    </div>
  `;try{const o=await p(),l=o.filter(e=>/ocean|marine|underwater|sea|shark|whale|tide|aquatic|nature|wildlife|planet/i.test(e.name)||e.items.some(n=>/shark|ocean|sea|whale|underwater|marine|tide pool/i.test(n.title||"")));if(r.innerHTML="",l.length===0){const e=new Map;o.forEach(i=>{i.items.forEach(t=>{/shark|ocean|sea|whale|underwater|marine|tide pool|dolphin|jellyfish|deep blue|oyster|aquatic/i.test(`${t.title} ${t.summary||""}`)&&(e.has(t.id)||e.set(t.id,t))})});const n=Array.from(e.values());n.length>0?c(r,"🌊 Ocean Animals TV",n):r.innerHTML=`
          <div style="padding: 40px; text-align: center; color: rgba(255,255,255,0.5);">
            No Ocean TV streams currently available.
          </div>
        `;return}l.forEach(e=>{const n=e.items.filter(i=>!/anime|naruto|dragon ball|sailor moon|bleach|one piece/i.test(`${i.title} ${i.summary||""}`));n.length>0&&c(r,`🌊 ${e.name}`,n)})}catch(o){console.error("Error loading Ocean TV streams:",o),r.innerHTML=`
      <div style="padding: 40px; text-align: center; color: #ff5e7e;">
        Failed to load Ocean TV streams. Please refresh to try again.
      </div>
    `}}}function c(r,o,l){const e=document.createElement("div");e.className="showcaseRail",e.style.marginBottom="36px";const n=document.createElement("h3");n.style.cssText="font-size: 20px; font-weight: 800; color: #38bdf8; margin: 0 0 18px; display: flex; align-items: center; gap: 8px;",n.innerHTML=`<span>${s(o)}</span>`,e.appendChild(n);const i=document.createElement("div");i.style.cssText="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px;",l.forEach(t=>{const a=document.createElement("div");a.style.cssText="background: #10141e; border: 1px solid rgba(56,189,248,0.2); border-radius: 16px; overflow: hidden; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; position: relative;",a.onmouseover=()=>{a.style.transform="translateY(-4px)",a.style.borderColor="#38bdf8"},a.onmouseout=()=>{a.style.transform="none",a.style.borderColor="rgba(56,189,248,0.2)"};const d=t.poster||t.banner||"";a.innerHTML=`
      <div style="height: 150px; position: relative; overflow: hidden;">
        ${d?`<img src="${s(d)}" alt="${s(t.title)}" style="width: 100%; height: 100%; object-fit: cover;" />`:'<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #161c2b; font-size: 32px;">🌊</div>'}
        <div style="position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(6,7,10,0.9) 100%);"></div>
        <div style="position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span style="background: rgba(56,189,248,0.3); backdrop-filter: blur(8px); border: 1px solid rgba(56,189,248,0.5); color: #fff; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">LIVE STREAM</span>
          <div style="width: 32px; height: 32px; border-radius: 50%; background: #38bdf8; color: #06070a; display: flex; align-items: center; justify-content: center; font-weight: bold;">▶</div>
        </div>
      </div>
      <div style="padding: 16px;">
        <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #fff;">${s(t.title)}</h4>
        <p style="margin: 0; font-size: 12px; color: #9aa5b5; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${s(t.summary||t.genre||"")}</p>
      </div>
    `,a.onclick=()=>{f(t)},i.appendChild(a)}),e.appendChild(i),r.appendChild(e)}export{h as renderOceanSanctuary};
