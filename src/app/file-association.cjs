// SPDX-License-Identifier: GPL-3.0-or-later
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);

// Called only from the user's settings button, never at startup or during packaging.
async function openExrDefaults({app,shell,root}){
  if(process.platform!=='win32')throw new Error('此功能目前仅支持 Windows。');
  if(!app.isPackaged)throw new Error('请在打包后的 OwlSight.exe 中设置默认程序。');
  const decoder=path.join(root,'resources','decoder');
  try{
    await run(path.join(decoder,'owlsight-decoder.exe'),[
      '-I',path.join(decoder,'register_exr.py'),process.execPath
    ],{windowsHide:true,timeout:15000,maxBuffer:64*1024});
  }catch{
    throw new Error('无法添加 EXR 打开方式，请确认程序文件夹完整且允许写入当前用户设置。');
  }
  try{
    await shell.openExternal('ms-settings:defaultapps?registeredAppUser=OwlSight');
  }catch{
    try{await shell.openExternal('ms-settings:defaultapps');}
    catch{throw new Error('已添加 OwlSight 打开方式，请手动打开 Windows 设置 → 应用 → 默认应用，搜索 .exr 并选择 OwlSight。');}
  }
  return {ok:true,message:'请在 Windows 默认应用设置中，将 .exr 选择为 OwlSight。'};
}
module.exports={openExrDefaults};
