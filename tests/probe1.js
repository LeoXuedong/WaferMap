const path=require('path');
const {launch,openApp}=require('./helpers/launch');
(async()=>{
 const {browser}=await launch();
 const {page,errors}=await openApp(browser,path.resolve(__dirname,'..','index.html'));
 await page.waitForTimeout(500);
 const r = await page.evaluate(()=>{
   const S=window.WM.state;
   const cv=document.querySelector('#viewRoot .wafer-canvas');
   const inst = window.__probeInst;
   return {signs:S.wafer.signs, size:S.wafer.size, marker:S.wafer.marker, unit:S.unit,
     cvSize:[cv.width,cv.height,cv.clientWidth,cv.clientHeight],
     hasCanvas:!!cv};
 });
 console.log(JSON.stringify(r));
 // 直接改用真实流程：临时打开数值标签，看是否出现文本
 await page.evaluate(()=>window.WM.api.setWafer({labels:true, signs:true, size:20}));
 await page.waitForTimeout(400);
 await page.screenshot({path:path.join(__dirname,'shots','probe-signs.png')});
 console.log('errors', errors);
 await browser.close();
})();
