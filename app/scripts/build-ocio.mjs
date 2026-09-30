// SPDX-License-Identifier: GPL-3.0-or-later
// Builds isolated static OCIO dependencies. No helper executable or test is run.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const build=path.resolve(process.env.OWLSIGHT_CPP_BUILD_DIR||path.join(root,'build/native-cpp'));
const deps=path.resolve(process.env.OWLSIGHT_CPP_DEPS||path.join(root,'build/cpp-sdk/sources'));
const prefix=build+'-ocio-prefix';
const cmake=process.env.OWLSIGHT_CMAKE||'cmake';
const bin=process.env.OWLSIGHT_CPP_TOOLCHAIN;
const env={...process.env};
if(bin){const key=Object.keys(env).find(k=>k.toLowerCase()==='path')||'PATH';env[key]=bin+path.delimiter+(env[key]||'');}
function run(args){const p=spawnSync(cmake,args.map(arg=>arg.replaceAll('\\','/')),{cwd:root,env,stdio:'inherit',windowsHide:true});if(p.error)throw p.error;if(p.status!==0)throw new Error('OCIO build failed: '+args.join(' '));}
const common=['-DCMAKE_BUILD_TYPE=Release','-DCMAKE_INSTALL_PREFIX='+prefix,'-DCMAKE_PREFIX_PATH='+prefix,'-DCMAKE_INSTALL_LIBDIR=lib','-DBUILD_SHARED_LIBS=OFF','-DBUILD_TESTING=OFF','-DCMAKE_POLICY_VERSION_MINIMUM=3.5'];
if(process.env.OWLSIGHT_NINJA)common.push('-G','Ninja','-DCMAKE_MAKE_PROGRAM='+process.env.OWLSIGHT_NINJA);
if(bin)common.push('-DCMAKE_C_COMPILER='+path.join(bin,'x86_64-w64-mingw32-clang.exe'),'-DCMAKE_CXX_COMPILER='+path.join(bin,'x86_64-w64-mingw32-clang++.exe'));
function install(name,source,args=[]){const dir=build+'-ocio-deps/'+name;run(['-S',source,'-B',dir,...common,...args]);run(['--build',dir,'--target','install','--config','Release','--parallel','8']);}
install('imath',path.join(deps,'Imath-3.2.2'),['-DIMATH_BUILD_TESTS=OFF','-DIMATH_BUILD_EXAMPLES=OFF','-DIMATH_INSTALL=ON']);
install('expat',path.join(deps,'expat-2.7.2'),['-DEXPAT_SHARED_LIBS=OFF','-DEXPAT_BUILD_TOOLS=OFF','-DEXPAT_BUILD_EXAMPLES=OFF','-DEXPAT_BUILD_TESTS=OFF','-DEXPAT_BUILD_DOCS=OFF']);
install('yaml',path.join(deps,'yaml-cpp-0.8.0'),['-DYAML_BUILD_SHARED_LIBS=OFF','-DYAML_CPP_BUILD_TESTS=OFF','-DYAML_CPP_BUILD_TOOLS=OFF']);
install('pystring',path.join(root,'native/cpp/pystring'),['-DPYSTRING_SOURCE='+path.join(deps,'pystring-1.1.4')]);
install('zlib',path.join(deps,'zlib-1.3.1'),['-DZLIB_BUILD_EXAMPLES=OFF']);
const zlibCandidates=['lib/libzlibstatic.a','lib/libz.a','lib/zlibstatic.lib'];
const zlib=zlibCandidates.map(p=>path.join(prefix,p)).find(existsSync);
if(!zlib)throw new Error('Installed static zlib library not found.');
const zopts=['-DZLIB_LIBRARY='+zlib,'-DZLIB_LIBRARY_RELEASE='+zlib,'-DZLIB_LIBRARY_DEBUG='+zlib,'-DZLIB_INCLUDE_DIR='+path.join(prefix,'include'),'-DZLIB_USE_STATIC_LIBS=ON'];
install('minizip',path.join(deps,'minizip-ng-4.0.10'),[...zopts,...['OPENSSL','LIBBSD','BUILD_TESTS','BUILD_UNIT_TESTS','BUILD_FUZZ_TESTS','COMPAT','BZIP2','LZMA','LIBCOMP','ZSTD','PKCRYPT','WZAES','SIGNING','ICONV','FETCH_LIBS','FORCE_FETCH_LIBS'].map(p=>'-DMZ_'+p+'=OFF'),'-DMZ_ZLIB=ON']);
const pystring=path.join(prefix,bin?'lib/libpystring.a':'lib/pystring.lib');
const ocioOpts=[...zopts,'-Dpystring_LIBRARY='+pystring,'-Dpystring_INCLUDE_DIR='+path.join(prefix,'include/pystring'),'-Dpystring_VERSION=1.1.4','-Dminizip-ng_STATIC_LIBRARY=ON'];
// Use the C++17 filesystem path overload for Windows Unicode with LLVM libc++.
const fileTransform=path.join(deps,'OpenColorIO-2.5.1/src/OpenColorIO/transforms/FileTransform.cpp');
let source=readFileSync(fileTransform,'utf8');
const original='Platform::filenameToUTF(filepath), mode));';
const patched='std::filesystem::path(Platform::filenameToUTF(filepath)), mode));';
if(source.includes(original)){
 source='#include <filesystem>\n'+source.replace(original,patched);
 writeFileSync(fileTransform,source);
}else if(!source.includes(patched))throw new Error('Unexpected OCIO source for Unicode patch.');
install('ocio',path.join(deps,'OpenColorIO-2.5.1'),[...ocioOpts,'-DOCIO_INSTALL_EXT_PACKAGES=NONE','-DOCIO_BUILD_APPS=OFF','-DOCIO_BUILD_TESTS=OFF','-DOCIO_BUILD_GPU_TESTS=OFF','-DOCIO_BUILD_DOCS=OFF','-DOCIO_BUILD_PYTHON=OFF','-DOCIO_BUILD_JAVA=OFF','-DOCIO_USE_WINDOWS_UNICODE=ON']);
if(!process.argv.includes('--dependencies-only')){
 run(['-S',path.join(root,'native/cpp/color'),'-B',build+'-color',...common,...ocioOpts]);
 run(['--build',build+'-color','--target','owlsight-ocio','--config','Release','--parallel','8']);
}