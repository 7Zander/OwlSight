// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "core.hpp"
#include <QByteArray>
#include <QString>
#include <QVariantMap>
#include <map>

// No QRhi objects cross this boundary. Bytes become immutable before publication.
struct UploadRequest {
    QString key;
    std::shared_ptr<const owl::desktop::Frame> pixels;
    uint64_t generation=0;
    int storageChannels=4;
};
struct UploadTicket {
    QString key,error;
    uint64_t generation=0;
    int width=0,height=0,storageChannels=0;
    bool half=false;
    quint32 stride=0;
    QByteArray data;
    double prepareMs=0,layoutMs=0,queueMs=0;
    size_t layoutBytes=0;
};
class UploadPreparer {
public:
    static constexpr size_t Budget=256*owl::MiB;
    static constexpr size_t Limit=3;
    explicit UploadPreparer(std::function<void()> notify);
    ~UploadPreparer();
    void request(std::vector<UploadRequest> desired);
    std::shared_ptr<const UploadTicket> ready(const QString& key,uint64_t generation);
    QVariantMap statistics();
    static size_t cost(const UploadRequest& request);
    static std::shared_ptr<UploadTicket> prepare(const UploadRequest& request);
private:
    std::mutex mutex_;
    std::condition_variable wake_;
    std::vector<UploadRequest> desired_;
    std::map<QString,std::shared_ptr<const UploadTicket>> ready_;
    std::function<void()> notify_;
    bool stopping_=false;
    size_t activeBytes_=0,peakBytes_=0;
    uint64_t prepared_=0,cancelled_=0;
    std::thread worker_;
    void work();
    size_t readyBytes() const;
};
