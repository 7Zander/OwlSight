// SPDX-License-Identifier: GPL-3.0-or-later
#include "update_manager.hpp"
#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QNetworkProxyFactory>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUuid>
#include <QVersionNumber>

namespace {
QString dataRoot(){return QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation)+"/OwlSight";}
QNetworkRequest requestFor(const QUrl& url){
    QNetworkRequest request(url);
    request.setRawHeader("User-Agent",("OwlSight/"+QCoreApplication::applicationVersion()).toUtf8());
    request.setRawHeader("Accept","application/vnd.github+json");
    request.setRawHeader("X-GitHub-Api-Version","2022-11-28");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setMaximumRedirectsAllowed(8);request.setTransferTimeout(30000);
    return request;
}
QVersionNumber versionNumber(QString tag){
    static const QRegularExpression syntax("^v?(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})$");
    const auto match=syntax.match(tag);
    return match.hasMatch()?QVersionNumber(match.captured(1).toInt(),match.captured(2).toInt(),match.captured(3).toInt()):QVersionNumber();
}
}
UpdateManager::UpdateManager(std::function<bool()> idle,QObject* parent):QObject(parent),idle_(std::move(idle)),network_(this),preferences_(dataRoot()+"/updates.ini",QSettings::IniFormat,this){
    automatic_=preferences_.value("automatic",true).toBool();
    lastCheck_=preferences_.value("lastCheck").toDateTime();
    QNetworkProxyFactory::setUseSystemConfiguration(true);
    deadline_.setSingleShot(true);
    connect(&deadline_,&QTimer::timeout,this,[this]{if(reply_){failure_="连接超时，请稍后重试。";reply_->abort();}});
    poll_.setInterval(10000);connect(&poll_,&QTimer::timeout,this,&UpdateManager::automaticCheck);poll_.start();
    QTimer::singleShot(5000,this,&UpdateManager::automaticCheck);
}
QVariantMap UpdateManager::state() const {
    return {{"currentVersion",QCoreApplication::applicationVersion()},{"automatic",automatic_},{"busy",!reply_.isNull()},
        {"phase",phase_},{"status",status_},{"available",!assetUrl_.isEmpty()},{"downloaded",!installer_.isEmpty()},
        {"version",version_},{"notes",notes_},{"progress",expected_?double(received_)/double(expected_):0.0}};
}
void UpdateManager::setAutomatic(bool enabled){automatic_=enabled;preferences_.setValue("automatic",enabled);emit changed();}
void UpdateManager::automaticCheck(){
    if(reply_||!idle_())return;
    if(!assetUrl_.isEmpty()&&!notified_){notified_=true;emit showRequested();return;}
    if(!automatic_||!assetUrl_.isEmpty())return;
    const qint64 ago=lastCheck_.msecsTo(QDateTime::currentDateTimeUtc());
    if(lastCheck_.isValid()&&ago>=0&&ago<24LL*60*60*1000)return;
    check(false);
}
void UpdateManager::requestDeadline(int milliseconds){deadline_.start(milliseconds);}
void UpdateManager::complete(QNetworkReply* reply){deadline_.stop();if(reply_==reply)reply_.clear();reply->deleteLater();}
void UpdateManager::check(bool manual){
    if(reply_){if(manual)emit showRequested();return;}
    if(!manual&&!idle_())return;
    if(!installer_.isEmpty()||!assetUrl_.isEmpty()){emit showRequested();return;}
    manual_=manual;cancelled_=false;failure_.clear();metadata_.clear();phase_="checking";status_="正在检查新版本…";
    lastCheck_=QDateTime::currentDateTimeUtc();preferences_.setValue("lastCheck",lastCheck_);
    auto* reply=network_.get(requestFor(QUrl("https://api.github.com/repos/7Zander/OwlSight/releases/latest")));
    reply_=reply;reply->setReadBufferSize(256*1024);requestDeadline(20000);
    connect(reply,&QIODevice::readyRead,this,[this,reply]{
        metadata_+=reply->readAll();if(metadata_.size()>1024*1024){failure_="更新信息超过大小限制。";reply->abort();}
    });
    connect(reply,&QNetworkReply::finished,this,[this,reply]{
        metadata_+=reply->readAll();const auto error=reply->error();complete(reply);phase_="idle";
        if(cancelled_){status_="已取消检查。";emit changed();return;}
        if(error!=QNetworkReply::NoError){status_=failure_.isEmpty()?"暂时无法连接 GitHub，请稍后重试。":failure_;emit changed();return;}
        const auto document=QJsonDocument::fromJson(metadata_);const auto release=document.object();
        const auto tag=release.value("tag_name").toString();const auto remote=versionNumber(tag);
        if(document.isNull()||!release.contains("draft")||!release.contains("prerelease")||release.value("draft").toBool()||release.value("prerelease").toBool()||remote.isNull()){
            status_="没有可用的正式版本信息。";emit changed();return;
        }
        if(QVersionNumber::compare(remote,versionNumber(QCoreApplication::applicationVersion()))<=0){status_="当前没有可用的新版本。";emit changed();return;}
        const QString name="OwlSight-"+remote.toString()+"-Setup-x64.exe";
        for(const auto& value:release.value("assets").toArray()){
            const auto asset=value.toObject();if(asset.value("name").toString()!=name)continue;
            const QUrl url(asset.value("browser_download_url").toString());
            const QString digest=asset.value("digest").toString();
            const qint64 size=qint64(asset.value("size").toDouble());
            static const QRegularExpression checksum("^sha256:[0-9a-fA-F]{64}$");
            if(url.scheme()!="https"||url.host()!="github.com"||url.path()!="/7Zander/OwlSight/releases/download/"+tag+"/"+name||!url.userInfo().isEmpty()||url.hasQuery()||url.hasFragment()||!checksum.match(digest).hasMatch()||size<=0||size>256LL*1024*1024)continue;
            assetUrl_=url;digest_=digest.mid(7).toLower();expected_=size;version_=remote.toString();notes_=release.value("body").toString().left(6000);
            status_="发现新版本 v"+version_;notified_=manual_||idle_();emit changed();if(notified_&&!manual_)emit showRequested();return;
        }
        status_="新版本尚未提供可验证的 Windows 安装包。";emit changed();
    });
    emit changed();if(manual)emit showRequested();
}
void UpdateManager::download(){
    if(reply_||assetUrl_.isEmpty())return;
    if(!idle_()){status_="请先暂停播放并等待素材打开完成，再安装更新。";emit changed();return;}
    if(!installer_.isEmpty()){install();return;}
    cacheDirectory_=dataRoot()+"/updates/"+QUuid::createUuid().toString(QUuid::WithoutBraces);
    if(!QDir().mkpath(cacheDirectory_)){status_="无法创建更新下载目录。";emit changed();return;}
    const QString target=cacheDirectory_+"/OwlSight-"+version_+"-Setup-x64.exe";
    output_=new QSaveFile(target,this);output_->setDirectWriteFallback(false);
    if(!output_->open(QIODevice::WriteOnly)){delete output_;output_=nullptr;status_="无法写入安装包。";emit changed();return;}
    received_=0;hash_.reset();cancelled_=false;failure_.clear();phase_="downloading";status_="正在下载安装包…";progressClock_.start();
    auto request=requestFor(assetUrl_);request.setRawHeader("Accept","application/octet-stream");
    auto* reply=network_.get(request);reply_=reply;reply->setReadBufferSize(256*1024);requestDeadline(30*60*1000);
    connect(reply,&QIODevice::readyRead,this,[this,reply]{consumeDownload(reply);});
    connect(reply,&QNetworkReply::finished,this,[this,reply]{finishDownload(reply);});emit changed();
}
void UpdateManager::consumeDownload(QNetworkReply* reply){
    if(!output_||cancelled_)return;
    while(reply->bytesAvailable()>0){
        const auto data=reply->read(256*1024);if(data.isEmpty())break;
        if(received_+data.size()>expected_){failure_="下载大小与发布记录不符。";if(!reply->isFinished())reply->abort();return;}
        if(output_->write(data)!=data.size()){failure_="无法继续写入安装包，请检查磁盘空间。";if(!reply->isFinished())reply->abort();return;}
        received_+=data.size();hash_.addData(data);
    }
    if(progressClock_.elapsed()>=100){progressClock_.restart();emit changed();}
}
void UpdateManager::finishDownload(QNetworkReply* reply){
    consumeDownload(reply);
    const auto error=reply->error();complete(reply);phase_="idle";
    if(error!=QNetworkReply::NoError||!failure_.isEmpty()||received_!=expected_||QString::fromLatin1(hash_.result().toHex())!=digest_){
        output_->cancelWriting();delete output_;output_=nullptr;
        status_=cancelled_?"已取消下载，当前版本未更改。":!failure_.isEmpty()?failure_:error!=QNetworkReply::NoError?"下载失败，请稍后重试。":"安装包完整性校验失败，未执行更新。";
        emit changed();return;
    }
    const auto name=output_->fileName();
    if(!output_->commit()){delete output_;output_=nullptr;status_="无法保存完整安装包。";emit changed();return;}
    delete output_;output_=nullptr;installer_=name;phase_="ready";status_="下载完成，可以退出并安装。";emit changed();
    if(idle_())install();
}
void UpdateManager::install(){
    if(installer_.isEmpty()||reply_)return;
    if(!idle_()){status_="下载已完成，请暂停播放后再点击安装。";emit changed();return;}
    const auto directory=QCoreApplication::applicationDirPath();const QString helper=cacheDirectory_+"/OwlSightUpdater.exe";
    if(!QFileInfo::exists(helper)&&!QFile::copy(directory+"/OwlSightUpdater.exe",helper)){
        status_="无法准备更新启动器，请手动运行已下载的安装包。";emit changed();return;
    }
    const QStringList arguments={QString::number(QCoreApplication::applicationPid()),QDir::toNativeSeparators(installer_),QDir::toNativeSeparators(directory),digest_};
    if(!QProcess::startDetached(helper,arguments,cacheDirectory_)){
        status_="无法启动更新安装，当前版本未更改。";emit changed();return;
    }
    phase_="installing";status_="正在退出并启动安装…";emit changed();QCoreApplication::quit();
}
void UpdateManager::cancel(){if(reply_){cancelled_=true;reply_->abort();}}
