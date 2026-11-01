// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <QObject>
#include <QVariantMap>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QPointer>
#include <QSettings>
#include <QSaveFile>
#include <QCryptographicHash>
#include <QTimer>
#include <QDateTime>
#include <QElapsedTimer>
#include <functional>

class UpdateManager final:public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap state READ state NOTIFY changed)
public:
    explicit UpdateManager(std::function<bool()> idle,QObject* parent=nullptr);
    QVariantMap state() const;
    Q_INVOKABLE void check(bool manual=true);
    Q_INVOKABLE void setAutomatic(bool enabled);
    Q_INVOKABLE void download();
    Q_INVOKABLE void install();
    Q_INVOKABLE void cancel();
signals:
    void changed();
    void showRequested();
private:
    std::function<bool()> idle_;
    QNetworkAccessManager network_;
    QSettings preferences_;
    QPointer<QNetworkReply> reply_;
    QTimer poll_,deadline_;
    QDateTime lastCheck_;
    QElapsedTimer progressClock_;
    QSaveFile* output_=nullptr;
    QCryptographicHash hash_{QCryptographicHash::Sha256};
    QByteArray metadata_;
    QUrl assetUrl_;
    QString phase_="idle",status_="尚未检查更新",version_,notes_,digest_,installer_,cacheDirectory_,failure_;
    qint64 expected_=0,received_=0;
    bool automatic_=true,manual_=false,notified_=false,cancelled_=false;
    void automaticCheck();
    void complete(QNetworkReply*);
    void requestDeadline(int milliseconds);
    void consumeDownload(QNetworkReply*);
    void finishDownload(QNetworkReply*);
};
