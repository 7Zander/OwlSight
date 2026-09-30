// SPDX-License-Identifier: GPL-3.0-or-later
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
void registryString(const std::wstring& path, const wchar_t* name, const std::wstring& value) {
    HKEY key = nullptr;
    const LSTATUS created = RegCreateKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, nullptr, &key, nullptr);
    if (created != ERROR_SUCCESS) throw std::runtime_error("Registry key creation failed: " + std::to_string(created));
    struct Key { HKEY value; ~Key() { RegCloseKey(value); } } owner{key};
    const auto status = RegSetValueExW(key, name, 0, REG_SZ,
        reinterpret_cast<const BYTE*>(value.c_str()), static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
    if (status != ERROR_SUCCESS) throw std::runtime_error("Registry value write failed: " + std::to_string(status));
}
void registerExr(const std::wstring& executable) {
    auto path = std::filesystem::absolute(executable);
    if (!std::filesystem::is_regular_file(path) || _wcsicmp(path.extension().c_str(), L".exe") != 0)
        throw std::runtime_error("OwlSight executable not found.");
    auto filename = path.wstring();
    if (filename.find(L'"') != std::wstring::npos) throw std::runtime_error("Invalid executable path.");
    const std::wstring progId = L"Software\\Classes\\OwlSight.EXR";
    const std::wstring capabilities = L"Software\\OwlSight\\Capabilities";
    const auto icon = L"\"" + filename + L"\",0";
    registryString(progId, nullptr, L"OpenEXR Image");
    registryString(progId + L"\\DefaultIcon", nullptr, icon);
    registryString(progId + L"\\shell\\open\\command", nullptr, L"\"" + filename + L"\" \"%1\"");
    registryString(progId + L"\\Application", L"ApplicationName", L"OwlSight");
    registryString(progId + L"\\Application", L"ApplicationIcon", icon);
    registryString(capabilities, L"ApplicationName", L"OwlSight");
    registryString(capabilities, L"ApplicationDescription", L"OwlSight EXR image and sequence viewer");
    registryString(capabilities, L"ApplicationIcon", icon);
    registryString(capabilities + L"\\FileAssociations", L".exr", L"OwlSight.EXR");
    registryString(L"Software\\Classes\\.exr\\OpenWithProgids", L"OwlSight.EXR", L"");
    registryString(L"Software\\RegisteredApplications", L"OwlSight", capabilities);
    // Only advertises an application. The user chooses the default in Windows Settings.
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
}
}
void DesktopRegisterExr(const wchar_t* executable) { registerExr(executable); }
#ifndef OWLSIGHT_PLATFORM_LIBRARY
int wmain(int argc, wchar_t** argv) {
    try {
        if (argc != 3 || std::wstring(argv[1]) != L"--register-exr")
            throw std::runtime_error("Usage: owlsight-platform --register-exr <OwlSight.exe>");
        registerExr(argv[2]);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
#endif
