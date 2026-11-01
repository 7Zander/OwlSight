// SPDX-License-Identifier: GPL-3.0-or-later
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <bcrypt.h>
#include <wchar.h>

static int hex(wchar_t c){if(c>=L'0'&&c<=L'9')return c-L'0';if(c>=L'a'&&c<=L'f')return c-L'a'+10;if(c>=L'A'&&c<=L'F')return c-L'A'+10;return -1;}
static BOOL verify(const wchar_t* path,const wchar_t* expected){
    if(lstrlenW(expected)!=64)return FALSE;
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    if(file==INVALID_HANDLE_VALUE)return FALSE;
    BCRYPT_ALG_HANDLE algorithm=NULL;BCRYPT_HASH_HANDLE hash=NULL;BYTE digest[32],buffer[65536];DWORD count=0;BOOL ok=FALSE;
    if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,NULL,0)<0)goto done;
    if(BCryptCreateHash(algorithm,&hash,NULL,0,NULL,0,0)<0)goto done;
    if(!ReadFile(file,buffer,sizeof(buffer),&count,NULL)||count<2||buffer[0]!='M'||buffer[1]!='Z')goto done;
    do{if(BCryptHashData(hash,buffer,count,0)<0)goto done;if(!ReadFile(file,buffer,sizeof(buffer),&count,NULL))goto done;}while(count);
    if(BCryptFinishHash(hash,digest,sizeof(digest),0)<0)goto done;
    for(int i=0;i<32;++i){int a=hex(expected[i*2]),b=hex(expected[i*2+1]);if(a<0||b<0||digest[i]!=(BYTE)(a*16+b))goto done;}
    ok=TRUE;
 done:
    if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);CloseHandle(file);return ok;
}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR command,int show){
    (void)instance;(void)previous;(void)command;(void)show;
    int count=0;LPWSTR* args=CommandLineToArgvW(GetCommandLineW(),&count);
    if(!args||count!=5){if(args)LocalFree(args);return 2;}
    DWORD pid=0;for(const wchar_t* p=args[1];*p;++p){if(*p<L'0'||*p>L'9'||pid>429496729UL){LocalFree(args);return 2;}pid=pid*10+(*p-L'0');}
    HANDLE parent=OpenProcess(SYNCHRONIZE,FALSE,pid);
    if(parent){DWORD waited=WaitForSingleObject(parent,120000);CloseHandle(parent);if(waited!=WAIT_OBJECT_0){MessageBoxW(NULL,L"OwlSight 尚未退出，请关闭后重新安装。",L"OwlSight 更新",MB_OK|MB_ICONINFORMATION);LocalFree(args);return 3;}}
    else if(GetLastError()!=ERROR_INVALID_PARAMETER){MessageBoxW(NULL,L"无法确认 OwlSight 已退出，更新未开始。",L"OwlSight 更新",MB_OK|MB_ICONERROR);LocalFree(args);return 3;}
    if(wcschr(args[2],L'"')||wcschr(args[3],L'"')||!verify(args[2],args[4])){MessageBoxW(NULL,L"安装包校验失败，更新未执行。",L"OwlSight 更新",MB_OK|MB_ICONERROR);LocalFree(args);return 4;}
    const size_t capacity=(size_t)lstrlenW(args[3])+80;
    wchar_t* parameters=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,capacity*sizeof(wchar_t));
    if(!parameters){LocalFree(args);return 5;}
    wsprintfW(parameters,L"/UPDATE=1 /DIR=\"%s\"",args[3]);
    SHELLEXECUTEINFOW info={0};info.cbSize=sizeof(info);info.fMask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NOASYNC;info.lpVerb=L"open";info.lpFile=args[2];info.lpParameters=parameters;info.nShow=SW_SHOWNORMAL;
    BOOL launched=ShellExecuteExW(&info);
    if(info.hProcess)CloseHandle(info.hProcess);
    if(!launched)MessageBoxW(NULL,L"无法启动安装器，请手动运行已下载的 Setup 文件。",L"OwlSight 更新",MB_OK|MB_ICONERROR);
    HeapFree(GetProcessHeap(),0,parameters);LocalFree(args);return launched?0:6;
}
