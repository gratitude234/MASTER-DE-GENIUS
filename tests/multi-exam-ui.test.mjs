import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';
registerAliasHook();registerTsxHook();
const stub=source=>({url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true});
registerHooks({resolve(specifier,context,next){
 if(specifier==='@/features/onboarding/actions') return stub('export async function saveExamPreparationsAction(){return {}}');
 if(specifier==='@/features/exam-context/actions')return stub('export async function switchActiveExam(){}');
 if(specifier==='next/navigation')return stub('export function usePathname(){return globalThis.__path??"/home"} export function useRouter(){return {push(){},refresh(){}}}');
 return next(specifier,context);
}});
const React=(await import('react')).default;
const {renderToStaticMarkup}=await import('react-dom/server');
const {OnboardingFlow}=await import('../components/onboarding/onboarding-flow.tsx');
const {ExamSwitcher}=await import('../components/app-shell/exam-switcher.tsx');
const exams=['jamb','waec'].map(code=>({code,name:code,shortName:code.toUpperCase(),available:true,subjects:[{id:'math',slug:'mathematics',name:'Mathematics',isCompulsory:false}]}));
const selection=code=>({examCode:code,examYear:2027,targetScore:code==='jamb'?280:70,subjectIds:code==='jamb'?['english','math','physics','chemistry']:['math']});
for(const codes of [['jamb'],['waec'],['jamb','waec']]) test('onboarding renders independent configuration for '+codes.join(' + '),()=>{
 const html=renderToStaticMarkup(React.createElement(OnboardingFlow,{exams,initialSelection:null,initialSelections:codes.map(selection)}));
 for(const code of codes)assert.match(html,new RegExp(code.toUpperCase()+' preparation'));
 if(codes.length===2){assert.match(html,/Which exam should open first/);assert.match(html,/Target percentage/);assert.match(html,/Target score \/ 400/);}
});
test('zero exams cannot submit and switcher is hidden in frozen sessions',()=>{
 const html=renderToStaticMarkup(React.createElement(OnboardingFlow,{exams,initialSelection:null}));
 assert.match(html,/<button[^>]*disabled=""[^>]*><span[^>]*>Save my preparation/);
 const props={active:'jamb',options:[{code:'jamb',label:'JAMB 2027'},{code:'waec',label:'WAEC 2027'}]};
 globalThis.__path='/home';assert.match(renderToStaticMarkup(React.createElement(ExamSwitcher,props)),/Active examination/);
 globalThis.__path='/practice/session/123';assert.equal(renderToStaticMarkup(React.createElement(ExamSwitcher,props)),'');
});
