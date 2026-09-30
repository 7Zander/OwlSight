// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "core.hpp"
#include "gpu_frame.hpp"
#include <QObject>
#include <QVariantMap>
#include <QQuickImageProvider>
#include <QImage>
#include <QMutex>
#include <QTimer>
#include <QUrl>
#include <QFile>
#include <future>
#include <OpenColorIO/OpenColorIO.h>
namespace ocio=OCIO_NAMESPACE;
struct ColorBundle {
    ocio::ConstCPUProcessorRcPtr input,display;
    bool data=false;
};
struct ColorResult { owl::Json catalog; std::shared_ptr<ColorBundle> bundle; owl::Json selection; };
class FrameStore final: public QQuickImageProvider {
public:
    FrameStore():QQuickImageProvider(Image){}
    QImage requestImage(const QString& id,QSize* size,const QSize& requested) override;
    void put(const QString& id,const QImage& image);
    void clear();
private:
    QMutex mutex;
    QHash<QString,QImage> images;
    qsizetype bytes=0;
};
class Viewer final:public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap state READ state NOTIFY changed)
    Q_PROPERTY(int frameIndex READ frameIndex NOTIFY changedFast)
    Q_PROPERTY(int frameNumber READ frameNumber NOTIFY changedFast)
    Q_PROPERTY(QString imageSource READ imageSource NOTIFY imageSourceChanged)
public:
    explicit Viewer(FrameStore*,QObject* parent=nullptr);
    ~Viewer() override;
    QVariantMap state() const;
    std::shared_ptr<const GpuFrame> gpuFrame() const { return gpuFrame_; }
    uint64_t gpuGeneration() const { return generation; }
    std::vector<GpuPrepared> gpuPrepared() const { return gpuPrepared_; }
    void gpuStatistics(const QVariantMap& data) { event("gpu.cache",data); }
    void gpuSubmitted(quint64 serial, quint64 generation, const QString& key, const QVariantMap& timing);
    void gpuUnavailable(const QString& reason);
    int frameIndex() const { return index; }
    int frameNumber() const { return sequence.files.empty() ? 0 : sequence.numbers[index]; }
    QString imageSource() const { return source; }
    Q_INVOKABLE void command(const QString& name,const QVariant& value=QVariant());
    Q_INVOKABLE void open(const QUrl& url);
    void tick();
signals:
    void changed();
    void changedFast();
    void imageSourceChanged();
    void gpuFrameChanged();
private:
    FrameStore* store;
    owl::desktop::Engine engine;
    owl::desktop::Sequence sequence;
    std::vector<owl::desktop::Layer> layers;
    uint64_t epoch=1,document=0,generation=0,revision=0;
    int index=0,selected=0,divisor=2,defaultDivisor=2,fps=24,mode=0;
    bool playing=false,loop=true,grid=false,opening=false,showHints=true,showInfo=true,logging=false;
    double exposure=0,cacheGiB=4.0;
    bool autoCache_=true;
    double manualCacheGiB_=4.0;
    owl::Clock::time_point nextMemoryCheck_=owl::Clock::now(),lastBudgetChange_=owl::Clock::now();
    QString error,status,title,shownInfo,source,shownKey;
    QString component="RGBA";
    QStringList thumbs;
    std::unordered_set<std::string> failed;
    owl::Clock::time_point nextFrame=owl::Clock::now();
    owl::Clock::time_point nextSchedule_=owl::Clock::now(),lastInput_=owl::Clock::now(),nextStats_=owl::Clock::now(),sessionStart_=owl::Clock::now();
    bool scheduleDirty_=true,handoff_=false;
    int shownIndex_=-1,shownLayer_=-1,continuousAhead_=0;
    size_t frameCost_=64*owl::MiB;
    uint64_t noOpInputs_=0,coalescedInputs_=0,operationId_=0,operationSequence_=0;
    QString operationKind_;
    owl::Clock::time_point operationStarted_=owl::Clock::now();
    std::shared_ptr<const owl::desktop::Frame> visiblePixels_;
    std::vector<GpuPrepared> gpuPrepared_;
    struct Rendered {std::shared_ptr<const owl::desktop::Frame> pixels;QImage image;QString info,key;int layer=0;bool thumb=false;uint64_t generation=0;double renderMs=0;};
    std::shared_ptr<const GpuFrame> gpuFrame_;
    uint64_t gpuSerial_=0;
    bool gpuEnabled_=true,gpuFailed_=false,gpuActive_=false;
    owl::Clock::time_point nextLogFlush_=owl::Clock::now();
    std::future<Rendered> renderFuture;
    std::future<ColorResult> colorFuture;
    bool rendering=false,colorBusy=false,colorPending=false,catalogPending=false;
    std::shared_ptr<ColorBundle> color;
    owl::Json colorCatalog,colorSelection={{"source","builtin"},{"input",""},{"display",""},{"view",""},{"look",""},{"lookMode","config"}};
    // 色彩选择/目录的 JSON→QVariant 转换代价不低，只在真正变化时做一次。
    mutable QVariant colorSelectionVariant_,colorCatalogVariant_;
    mutable bool selectionVariantDirty_=true;
    QString settingsPath;
    QFile log;
    QTimer timer;
    mutable QVariantMap stateCache_;
    mutable bool stateDirty_=true;
    bool fastDirty_=false;
    QString displayKey(int frame,int layer,bool thumb=false) const;
    void beginOperation(const QString& kind);
    void finishOperation(const QString& outcome);
    void accepted(const std::shared_ptr<const owl::desktop::Frame>& pixels);
    void schedule();
    void refresh();
    void softRefresh();
    void displayRefresh();
    bool gpuEligible() const;
    void requestColor(bool catalog=false);
    void saveSettings();
    void startRecording();
    void stopRecording(const QString& reason);
    uint64_t recordingSequence_=0;
    void updateCacheBudget(bool initial=false);
    void event(const QString&,const QVariantMap& data={});
    std::string key(int frame,int layer,bool thumb=false) const;
    void request(int frame,int layer,bool thumb=false,bool priority=true);
    void render(const std::shared_ptr<owl::desktop::Frame>&,int layer,bool thumb,const std::string& key);
};
