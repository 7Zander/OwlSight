// SPDX-License-Identifier: GPL-3.0-or-later
#include "viewer.hpp"
#include "update_manager.hpp"
#include <QIcon>
#include <windows.h>
#include <shobjidl.h>
#include "gpu_canvas.hpp"
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QDebug>
#ifdef OWLSIGHT_ENABLE_SMOKE_DRIVER
#include "diagnostics/smoke_driver.hpp"
#endif

int main(int argc, char** argv) {
    CreateMutexW(nullptr,FALSE,L"Local\\OwlSight.Running");
    SetCurrentProcessExplicitAppUserModelID(L"7Zander.OwlSight");
    QGuiApplication application(argc, argv);
    QGuiApplication::setWindowIcon(QIcon(":/branding/owlsight.svg"));
    QCoreApplication::setApplicationName("OwlSight Qt Quick");
    QCoreApplication::setApplicationVersion(OWLSIGHT_VERSION);
    QCoreApplication::setOrganizationName("OwlSight");
    QQuickStyle::setStyle("Basic");
#ifdef OWLSIGHT_ENABLE_SMOKE_DRIVER
    const auto smokeDirectory = configureSmokeDriver(application.arguments());
#else
    for (const auto& argument : application.arguments()) {
        if (argument.startsWith("--smoke-")) {
            qCritical("Developer smoke driver is excluded from this production build.");
            return 64;
        }
    }
#endif
    qmlRegisterType<GpuCanvas>("OwlSight", 1, 0, "GpuCanvas");
    QQmlApplicationEngine qml;
    auto* store = new FrameStore;
    qml.addImageProvider("frames", store);
    Viewer viewer(store);
    UpdateManager updates([&viewer]{return !viewer.busyForUpdates();});
    qml.rootContext()->setContextProperty("viewer", &viewer);
    qml.rootContext()->setContextProperty("updates", &updates);
    qml.load(QUrl("qrc:/qml/Main.qml"));
#ifdef OWLSIGHT_ENABLE_SMOKE_DRIVER
    if (!smokeDirectory.isEmpty()) return runSmokeDriver(application, qml, viewer, smokeDirectory);
#endif
    if (qml.rootObjects().isEmpty()) return 2;
    auto* window = qobject_cast<QQuickWindow*>(qml.rootObjects().first());
    if (window && window->rendererInterface()->graphicsApi() == QSGRendererInterface::Software)
        viewer.gpuUnavailable("Qt 正在使用软件显示后端。");
    const auto arguments = application.arguments();
    for (int index = 1; index < arguments.size(); ++index) {
        if (!arguments[index].startsWith("--")) {
            viewer.open(QUrl::fromLocalFile(arguments[index]));
            break;
        }
    }
    const int result = application.exec();
    for (auto* root : qml.rootObjects()) delete root;
    return result;
}
