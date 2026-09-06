// Runs against `npm run build && npm start`. Browser APIs and real UI; server saves are intercepted fixtures.
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
const base=process.env.TEST_BASE_URL || 'http://localhost:3000';
const server=process.env.TEST_START_SERVER==='1' ? spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'],{stdio:['ignore','pipe','pipe']}) : null;
if(server) await new Promise((resolve,reject)=>{server.stdout.on('data',d=>{if(d.toString().includes('Ready in'))resolve()});server.stderr.on('data',d=>process.stderr.write(d));server.on('exit',code=>reject(new Error('Server exited '+code)))});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
let page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const userId='11111111-1111-4111-8111-111111111111';
const id='22222222-2222-4222-8222-222222222222';
const key=`${userId}:exam:${id}`;
const makeRecord=(expired=false)=>{
 const now=Date.now();
 const qs=[1,2].map(n=>({id:'q'+n,revision:0,subjectId:'physics',subjectPosition:n,overallPosition:n,selectedOptionKey:null,isFlagged:false,
 question:{id:'q'+n,examBody:'jamb',source:{provider:'internal',providerQuestionId:'q'+n},subject:{id:'physics',slug:'physics',name:'Physics'},prompt:`Offline test question ${n}: choose an option.`,assets:[],options:['A','B','C','D'].map(k=>({id:k,key:k,text:`Option ${k}`}))}}));
 const view={id,userId,serverNow:now,examBody:'jamb',examName:'JAMB',blueprintName:'Fixture mock',examYear:2027,status:'in_progress',sourceProvider:'internal',durationSeconds:3600,totalQuestions:2,answeredCount:0,flaggedCount:0,startedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+(expired?-1000:3600000)).toISOString(),subjects:[{id:'subject1',subjectId:'physics',slug:'physics',name:'Physics',displayOrder:0,questionCount:2,answeredCount:0,flaggedCount:0,questions:qs}]};
 return {key,userId,kind:'exam',id,view,version:1,answers:{q1:{selectedOptionKey:null,isFlagged:false,revision:0},q2:{selectedOptionKey:null,isFlagged:false,revision:0}},pending:{},cursor:{subject:0,question:0},serverTime:now,wallTime:now,final:false};
};
const seed=async(record)=>page.evaluate(async record=>{
 await new Promise((resolve,reject)=>{const r=indexedDB.open('mdg-offline-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('sessions',{keyPath:'key'});r.result.createObjectStore('meta')};r.onsuccess=()=>{const db=r.result,tx=db.transaction(['sessions','meta'],'readwrite');tx.objectStore('sessions').clear();tx.objectStore('sessions').put(record);tx.objectStore('meta').put(record.userId,'owner');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}});
},record);
const local=async()=>page.evaluate(async key=>new Promise(resolve=>{const r=indexedDB.open('mdg-offline-v1',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('sessions').objectStore('sessions').get(key);q.onsuccess=()=>{resolve(q.result);db.close()}}}),key);
try {
 await context.route('**/api/exam/attempts/*/response',r=>r.fulfill({status:503,json:{error:'Fixture connection unavailable'}}));
 mkdirSync('../verification',{recursive:true});
 await page.goto(base+'/offline');
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
 await seed(makeRecord());await page.reload();
 await context.setOffline(true);
 await page.getByRole('button',{name:'Resume saved session'}).click();
 await page.getByRole('button',{name:'A Option A',exact:true}).click();
 await page.getByRole('button',{name:'Flag',exact:true}).click();
 await expect.poll(async()=>Object.keys((await local()).pending).length).toBe(1);
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'B Option B',exact:true}).click();
 await expect.poll(async()=>(await local()).cursor.question).toBe(1);
 await expect.poll(async()=>Object.keys((await local()).pending).length).toBe(2);
 await page.goto(base+'/exam/'+id);await page.getByRole('button',{name:'Resume saved session'}).click();
 await expect(page.getByText('Offline test question 2: choose an option.')).toBeVisible();
 await expect(page.getByRole('button',{name:'B Option B',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Previous',exact:true}).click();
 await expect(page.getByRole('button',{name:'Flagged',exact:true})).toBeVisible();
 await page.screenshot({path:'../verification/m6-exam-390.png',fullPage:true});
 for(const width of [360,430,1280]) {await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.setViewportSize({width:390,height:844});
 // A second tab cannot become a writer until the first closes.
 const second=await context.newPage();await second.goto(base+'/offline');await second.getByRole('button',{name:'Resume saved session'}).click();
 await expect(second.getByRole('button',{name:'A Option A',exact:true})).toBeDisabled();await second.close();
 // Actual browser page close/reopen preserves choices.
 await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/offline');await page.getByRole('button',{name:'Resume saved session'}).click();
 await expect(page.getByRole('button',{name:'A Option A',exact:true})).toHaveAttribute('aria-pressed','true');
 const saved={};let writes=0;let submissions=0;
 await context.route('**/api/exam/attempts/*/response',async route=>{
  const p=route.request().postDataJSON();writes++;
  await new Promise(r=>setTimeout(r,200));
  saved[p.attemptQuestionId]=p;
  await route.fulfill({json:{...p,revision:p.expectedRevision+1,serverNow:Date.now()}});
 });
 await context.route('**/api/exam/attempts/*/submit',async route=>{
  submissions++;expect(Object.keys(saved).length).toBe(2);
  await route.fulfill({json:{attemptId:id,status:'submitted',answeredCount:2,flaggedCount:1,totalQuestions:2,submittedAt:new Date().toISOString(),submissionReason:'manual'}});
 });
 await context.setOffline(false);
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.getByRole('button',{name:'Submit Exam',exact:true}).click();
 await expect(page.getByText('Your answers are locked in.')).toBeVisible();expect(writes).toBe(2);expect(submissions).toBe(1);expect((await local()).final).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 console.log('PASS: offline answers/flags, reload, close/reopen, cursor, one tab writer, sync-before-submit and 390px layout');
 // Expiry retries after a failed server submission.
 await context.unroute('**/api/exam/attempts/*/submit');let attempts=0;
 await context.route('**/api/exam/attempts/*/submit',async route=>{attempts++;if(attempts===1)return route.abort();await route.fulfill({json:{attemptId:id,status:'submitted',answeredCount:0,flaggedCount:0,totalQuestions:2,submittedAt:new Date().toISOString(),submissionReason:'time_expired'}})});
 await page.goto(base+'/offline');await seed(makeRecord(true));await page.reload();await page.getByRole('button',{name:'Resume saved session'}).click();
 await expect(page.getByText('Your answers are locked in.')).toBeVisible({timeout:18000});expect(attempts).toBe(2);
 console.log('PASS: failed expiry submission retries successfully');
 // Practice completion also waits for durable answer delivery; feedback remains locked offline.
 await page.goto(base+'/offline');const practice=makeRecord();practice.kind='practice';practice.key=`${userId}:practice:${id}`;
 const questions=practice.view.subjects[0].questions.map((q,n)=>({...q,position:n+1}));
 practice.view={id,userId,serverNow:Date.now(),mode:'practice',status:'in_progress',subjectName:'Physics',subjectSlug:'physics',requestedCount:2,questionCount:2,answeredCount:0,correctCount:0,sourceProvider:'internal',startedAt:new Date().toISOString(),expiresAt:null,questions};
 await seed(practice);await page.reload();await context.setOffline(true);await page.getByRole('button',{name:'Resume saved session'}).click();
 await page.getByRole('button',{name:'A Option A',exact:true}).click();await expect(page.getByRole('button',{name:'B Option B',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Next question'}).click();await page.getByRole('button',{name:'B Option B',exact:true}).click();
 await page.getByRole('button',{name:'Finish session'}).click();await expect(page.getByText('Reconnect to submit. Your saved changes remain on this device.')).toBeVisible();
 let practiceWrites=0;await context.route('**/api/practice/sessions/*/answers',async r=>{const p=r.request().postDataJSON();practiceWrites++;await new Promise(resolve=>setTimeout(resolve,150));await r.fulfill({json:{...p,revision:1,feedback:{isCorrect:p.selectedOptionKey==='A',correctOptionKey:'A',explanation:'Fixture explanation'}}})});
 await context.route('**/api/practice/sessions/*/complete',async r=>{expect(practiceWrites).toBe(2);await r.fulfill({json:{sessionId:id,status:'completed',answeredCount:2,correctCount:1,questionCount:2,completedAt:new Date().toISOString()}})});
 await context.setOffline(false);await page.getByRole('button',{name:'Finish session'}).click();await expect(page.getByText('Session complete',{exact:true})).toBeVisible();
 console.log('PASS: practice offline lock, pending preservation and completion after sync');
 // Installing an update while this tab is open does not activate it or reload the runner.
 const priorController=await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL);
 await page.evaluate(()=>navigator.serviceWorker.register('/sw.js?update-test=1',{scope:'/'}));
 await expect.poll(()=>page.evaluate(async()=>Boolean((await navigator.serviceWorker.getRegistration('/')).waiting))).toBe(true);
 expect(await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL)).toBe(priorController);
 console.log('PASS: service worker update waits without replacing the active tab');
 // No private HTTP responses should be in the shell cache.
 const urls=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.filter(k=>k.startsWith('mdg-shell')).map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat()});
 expect(urls.every(p=>p==='/offline'||p.startsWith('/_next/static/')||p.startsWith('/icons/'))).toBe(true);
 expect(errors).toEqual([]);
 mkdirSync('../verification',{recursive:true});await page.screenshot({path:'../verification/m6-mobile.png',fullPage:true});
 console.log('PASS: public-only shell cache; no browser runtime errors');
} finally {await browser.close();server?.kill()}
