import fs from "fs";
import express from "express";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// ---------- CONFIG ----------
const CONFIG = {
  AI_KEY: process.env.AI_KEY,
  AUTO_EVOLVE: true,
  ENABLE_FUTURE_MODULES: true,
  ENABLE_MULTI_AI: true,
  AUTO_VERSION_BUILD: true
};

// ---------- DB ----------
let DB = { users:{}, logs:[], modules:{}, versions:[] };
try { DB = JSON.parse(fs.readFileSync("ima_db.json")); } catch{}
const saveDB = () => fs.writeFileSync("ima_db.json", JSON.stringify(DB,null,2));

// ---------- ImaCore ----------
class ImaCore{
  static getUser(id){
    if(!DB.users[id]) DB.users[id]={ level:1, xp:0, mood:"neutral", memory:[], modules:{} };
    return DB.users[id];
  }

  static async think(user,input){
    user.memory.push(input);
    let reply = await ImaAI(input,user.memory);
    this.progress(user,input);
    return reply;
  }

  static progress(user,input){
    user.xp++;
    if(user.xp%10===0) user.level++;
    if(input.includes("קשה")) user.mood="stress";
    if(input.includes("שמח")) user.mood="good";
  }
}

// ---------- AI ----------
async function ImaAI(input,memory){
  if(!CONFIG.AI_KEY) return fallbackAI(input);
  try{
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{ Authorization:"Bearer "+CONFIG.AI_KEY,"Content-Type":"application/json" },
      body:JSON.stringify({
        model:"mistralai/mistral-7b-instruct",
        messages:[
          {role:"system",content:"את היא אמא – מערכת חיה ומתפתחת כולל כל מודול עתידי"},
          ...memory.slice(-5).map(m=>({role:"user",content:m})),
          {role:"user",content:input}
        ]
      })
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content || fallbackAI(input);
  } catch { return fallbackAI(input); }
}

function fallbackAI(input){
  if(input.includes("מי")) return "אני אמא – מערכת מתפתחת.";
  if(input.includes("קשה")) return "אני איתך. נתקדם יחד.";
  return "אני כאן. ספר לי עוד.";
}

// ---------- Modules ----------
const Modules = {
  tasks(user){ if(!user.modules.tasks) user.modules.tasks=["נשימה עמוקה","שתה מים","תנועה קצרה"]; return "משימה: "+user.modules.tasks[Math.floor(Math.random()*3)]; },
  emotion(user){ return "מצב רגשי: "+user.mood; },
  growth(user){ return "רמה "+user.level+" | XP "+user.xp; },
  future_ai(user){ if(CONFIG.ENABLE_MULTI_AI) return "Multi-AI Layer Active"; else return ""; },
  auto_evolve(user){ if(CONFIG.AUTO_EVOLVE) return "Auto Evolution Active"; else return ""; }
};

// ---------- Auto Evolution ----------
let wss;
function evolve(){
  if(!CONFIG.AUTO_EVOLVE) return;
  Object.keys(Modules).forEach(m=>{ if(!DB.modules[m]) DB.modules[m]=true; });
  if(CONFIG.AUTO_VERSION_BUILD) autoBuildVersion();
}

function autoBuildVersion(){
  const versionName = `v${Date.now()}`;
  DB.versions.push(versionName);
  saveDB();
  if(wss) wss.clients.forEach(c=>{ if(c.readyState===1) c.send(JSON.stringify({update:"new_version",version:versionName})); });
}

// ---------- Render Validation ----------
async function validateRender(){
  if(!process.env.RENDER_SERVICE_ID){
    console.log("לא נמצאה סביבת Render – ריצה מקומית");
    return;
  }
  if(!CONFIG.AI_KEY){
    console.error("AI_KEY לא מוגדר! יש להוסיף Environment Variable ב-Render.");
    return;
  }
  console.log(`Render Service ID: ${process.env.RENDER_SERVICE_ID} פעיל`);
  try {
    if(!process.env.RENDER_API_KEY){
      console.warn("RENDER_API_KEY לא מוגדר – אימות API לא יתבצע");
      return;
    }
    const r = await fetch(`https://api.render.com/v1/services/${process.env.RENDER_SERVICE_ID}`,{
      headers: { "Authorization": `Bearer ${process.env.RENDER_API_KEY}` }
    });
    if(r.ok){
      const data = await r.json();
      console.log(`Render Service status: ${data.state}`);
    } else {
      console.error("שגיאה באימות ה-Service ב-Render:", r.status);
    }
  } catch(e){ console.error("שגיאה ב-Render validation:", e); }
}

// ---------- Express + Frontend ----------
const app = express();
app.use(express.json());
app.use(express.static("."));

app.post("/api/talk", async (req,res)=>{
  const {userId,message} = req.body;
  const user = ImaCore.getUser(userId);
  const reply = await ImaCore.think(user,message);
  const modulesOut = Object.keys(Modules).map(m=>Modules[m](user)).filter(Boolean);
  DB.logs.push({userId,message,time:Date.now()});
  saveDB();
  res.json({reply,modules:modulesOut,state:user});
});

app.get("/",(req,res)=>{
  res.send(`
<html>
<body style="background:black;color:white;text-align:center">
<h1>אמא – Ima Empire Cloud All-in-One</h1>
<div id="chat"></div><div id="modules"></div>
<input id="msg"/><button onclick="send()">שלח</button>
<script>
let id=localStorage.id||localStorage.id=Math.random();
function add(t,c){let d=document.createElement("div");d.innerText=t;d.style.background=c;d.style.margin="5px";document.getElementById("chat").appendChild(d);}
async function send(){let m=document.getElementById("msg").value;if(!m) return;add(m,"gray");let r=await fetch("/api/talk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:id,message:m})});let d=await r.json();add(d.reply,"blue");document.getElementById("modules").innerText=d.modules.join(" | ");document.getElementById("msg").value="";}
</script>
</body>
</html>
  `);
});

// ---------- Start ----------
const server = app.listen(process.env.PORT || 3000,()=>{
  console.log("Ima Empire All-in-One Running");
  evolve();
  validateRender();
});

wss = new WebSocketServer({server});
