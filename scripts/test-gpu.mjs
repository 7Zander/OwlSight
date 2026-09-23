import {_electron as electron} from 'playwright';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
const app=await electron.launch({executablePath:process.env.OWLSIGHT_EXE||path.resolve('node_modules/electron/dist/electron.exe'),args:process.env.OWLSIGHT_EXE?[]:[path.resolve('.')],env:{...process.env,OWLSIGHT_PROFILE_DIR:path.resolve('build/gpu-profile')}});
try {
 const page=await app.firstWindow();await page.waitForLoadState('load');await page.waitForSelector('#demo');await page.click('#demo');await page.waitForSelector('#viewer:not([hidden])');
 const device=await app.evaluate(async({app})=>({features:app.getGPUFeatureStatus(),gpu:await app.getGPUInfo('complete')}));
 const canvas=await page.evaluate(()=>{const gl=document.querySelector('#viewer').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:!!gl,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR)};});
 const report={canvas,...device};await writeFile('build/verification/gpu.json',JSON.stringify(report,null,2));console.log(JSON.stringify({canvas,features:device.features,devices:device.gpu.gpuDevice}));
}finally{await app.close();}
