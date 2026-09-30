// SPDX-License-Identifier: GPL-3.0-or-later
#include "viewer.hpp"
#include "gpu_canvas.hpp"
#include <QSGRendererInterface>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QDir>
#include <QJsonDocument>
#include <QDateTime>
#include <QFileInfo>
#include <QTextStream>
#include <QElapsedTimer>
namespace { QStringList warnings; QString messagePath;
void messages(QtMsgType type,const QMessageLogContext&,const QString& message){
    if(type==QtWarningMsg||type==QtCriticalMsg||type==QtFatalMsg)warnings.push_back(message);
    if(!messagePath.isEmpty()){QFile f(messagePath);if(f.open(QIODevice::WriteOnly|QIODevice::Append|QIODevice::Text)){f.write(message.toUtf8()+"\n");}}
}
}
int main(int argc,char**argv){
    QGuiApplication application(argc,argv);
    QCoreApplication::setApplicationName("OwlSight Qt Quick");QCoreApplication::setApplicationVersion("0.2.0");QCoreApplication::setOrganizationName("OwlSight");
    QQuickStyle::setStyle("Basic");
    QString smokeDir,sequenceDir;
    for(const auto&arg:application.arguments()){
        if(arg.startsWith("--smoke-dir="))smokeDir=arg.mid(12);
        if(arg.startsWith("--smoke-sequence="))sequenceDir=arg.mid(17);
    }
    if(!smokeDir.isEmpty()){QDir().mkpath(smokeDir);messagePath=smokeDir+"/qml.log";qInstallMessageHandler(messages);}
    qmlRegisterType<GpuCanvas>("OwlSight",1,0,"GpuCanvas");
    QQmlApplicationEngine qml;
    auto* store=new FrameStore;qml.addImageProvider("frames",store);Viewer viewer(store);
    qml.rootContext()->setContextProperty("viewer",&viewer);
    qml.load(QUrl("qrc:/qml/Main.qml"));
    if(qml.rootObjects().isEmpty()){
        if(!smokeDir.isEmpty()){QFile f(smokeDir+"/result.json");if(f.open(QIODevice::WriteOnly))f.write(QJsonDocument::fromVariant(QVariantMap{{"ok",false},{"stage","qml-load"},{"warnings",warnings}}).toJson());}
        return 2;
    }
    auto* window=qobject_cast<QQuickWindow*>(qml.rootObjects().first());
    if(window&&window->rendererInterface()->graphicsApi()==QSGRendererInterface::Software)
        viewer.gpuUnavailable("Qt 正在使用软件显示后端。");
    if(smokeDir.isEmpty()){
        for(int i=1;i<application.arguments().size();++i){auto arg=application.arguments()[i];if(!arg.startsWith("--")){viewer.open(QUrl::fromLocalFile(arg));break;}}
        int result=application.exec();for(auto* root:qml.rootObjects())delete root;return result;
    }
    QTimer smoke;QElapsedTimer elapsed;elapsed.start();int stage=0,readyWait=0,presented=0;QString oldImage;QVariantList checks;
    auto finish=[&](bool ok,const QString& reason){
        smoke.stop();QFile f(smokeDir+"/result.json");
        if(f.open(QIODevice::WriteOnly))f.write(QJsonDocument::fromVariant(QVariantMap{{"ok",ok},{"reason",reason},{"stage",stage},{"checks",checks},{"warnings",warnings},{"state",viewer.state()},{"elapsedMs",elapsed.elapsed()}}).toJson());
        application.exit(ok?0:3);
    };
    auto shot=[&](const QString&name){return window->grabWindow().save(smokeDir+"/"+name+".png");};
    QObject::connect(&smoke,&QTimer::timeout,[&]{
        auto s=viewer.state();
        if(!s["error"].toString().isEmpty()){finish(false,s["error"].toString());return;}
        if(elapsed.elapsed()>90000){finish(false,"Timed out waiting for UI or frame");return;}
        bool ready=!s["image"].toString().isEmpty()&&!s["busy"].toBool();
        if(stage==0){if(++readyWait<6)return;if(!shot("01-empty")){finish(false,"Window capture failed");return;}checks.push_back("QML loaded and empty window rendered");
            if(sequenceDir.isEmpty()){finish(false,"Provide an external sequence fixture; no sample is bundled");return;}
            const auto fixtures=QDir(sequenceDir).entryList({"*.exr"},QDir::Files,QDir::Name);
            if(fixtures.isEmpty()){finish(false,"External sequence contains no EXR fixture");return;}
            viewer.open(QUrl::fromLocalFile(QDir(sequenceDir).filePath(fixtures.front())));stage=1;}
        else if(stage==1&&ready){
            if(!shot("02-image")){finish(false,"Image capture failed");return;}
            auto* image=window->findChild<QObject*>("frameImage");if(!image||image->property("status").toInt()!=1)return;
            checks.push_back("Public EXR decoded and QML Image ready");oldImage=s["image"].toString();viewer.command("nextLayer");stage=2;
        }else if(stage==2&&ready&&s["image"].toString()!=oldImage){
            checks.push_back("Layer selection produced a new displayed frame");oldImage=s["image"].toString();viewer.command("component","R");stage=21;
        }else if(stage==21&&ready&&s["image"].toString()!=oldImage){checks.push_back("R component produced a new displayed frame");viewer.command("component","RGBA");viewer.command("grid");stage=3;
        }else if(stage==3&&s["grid"].toBool()){
            bool all=true;for(const auto& row:s["layers"].toList())if(row.toMap()["image"].toString().isEmpty())all=false;
            if(all){shot("03-grid");checks.push_back("All layer thumbnails generated");viewer.command("layer",0);viewer.command("mode",1);stage=4;}
        }else if(stage==4&&ready&&!s["colorBusy"].toBool()&&s["mode"].toInt()==1&&!s["colorCatalog"].toMap().isEmpty()){
            shot("04-ocio");checks.push_back("Built-in OCIO catalog and display processor applied");oldImage=s["image"].toString();viewer.command("exposure",1.0);stage=5;
        }else if(stage==5&&ready&&s["image"].toString()!=oldImage){
            checks.push_back("Exposure updated displayed image");viewer.command("mode",0);viewer.command("exposure",0);
            QMetaObject::invokeMethod(window,"menuAt",Q_ARG(QVariant,800),Q_ARG(QVariant,100));readyWait=0;stage=6;
        }else if(stage==6){
            if(++readyWait<5)return;shot("05-menu");window->setProperty("menuPage",1);readyWait=0;stage=61;
        }else if(stage==61){if(++readyWait<5)return;shot("05-display");window->setProperty("menuPage",2);readyWait=0;stage=62;
        }else if(stage==62){if(++readyWait<5)return;shot("05-settings");auto* menu=window->findChild<QObject*>("previewMenu");if(menu)QMetaObject::invokeMethod(menu,"close");
            checks.push_back("Channel menu rendered");window->resize(800,600);readyWait=0;stage=7;
        }else if(stage==7){
            if(++readyWait<5)return;shot("06-compact");checks.push_back("Window resized to 800x600");
            if(sequenceDir.isEmpty()){finish(false,"Missing public sequence fixture");return;}
            viewer.open(QUrl::fromLocalFile(sequenceDir));stage=8;
        }else if(stage==8&&ready&&s["frameCount"].toInt()==3){viewer.command("play");stage=9;}
        else if(stage==9){
            if(s["image"].toString()!=oldImage){oldImage=s["image"].toString();++presented;}
            if(presented>=5){viewer.command("play");checks.push_back("Three-frame public sequence loop presented at least five images");shot("07-sequence");viewer.command("seek",2);stage=10;}
        }else if(stage==10&&ready&&s["frameIndex"].toInt()==2){checks.push_back("Seek reached last sequence frame");finish(warnings.isEmpty(),warnings.isEmpty()?"Smoke workflow passed":"QML/runtime warnings require attention");}
    });
    smoke.start(100);int result=application.exec();for(auto* root:qml.rootObjects())delete root;return result;
}
